import type { Message, Prisma } from "@prisma/client";
import type { DecisionRecord } from "@/agent/decisions";
import type { TicketService } from "./tickets/types";
import type { ChatPayload } from "./chat-payload";
import { transitionConversation } from "./conversation-state";

export async function handoffConversation(
  tx: Prisma.TransactionClient,
  employeeId: string,
  conversationId: string,
  sourceMessageId: string,
  messages: Message[],
  record: DecisionRecord,
  tickets: TicketService,
  relatedNumber?: string | null,
  legacyUnavailable = false,
) {
  const previousCards = messages.flatMap((m) => {
    const cards = (m.payload as ChatPayload | null)?.tickets;
    return cards?.length === 1 ? cards : [];
  });
  const number = relatedNumber ?? previousCards.at(-1)?.number;
  const related = number
    ? await tx.ticket.findFirst({ where: { employeeId, number } })
    : null;
  const previousDecisions = messages.flatMap((m) =>
    m.decisionRecord ? [m.decisionRecord as unknown as DecisionRecord] : [],
  );
  const summary = [
    `Motivo: ${record.reason}`,
    `Relato: ${messages
      .filter((m) => m.role === "EMPLOYEE")
      .map((m) => m.content)
      .join(" | ")}`,
    `Consultas: ${[...previousDecisions, record].flatMap((r) => r.consultations.map((c) => `${c.tool}: ${c.result.summary}`)).join(" | ")}`,
    `Decisões: ${[...previousDecisions, record].map((r) => `${r.decision}: ${r.reason}`).join(" | ")}`,
    `Chamado relacionado: ${related?.number ?? "nenhum chamado próprio identificado"}`,
    legacyUnavailable
      ? "Legado indisponível: transferência do chamado não concluída."
      : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 10000);
  if (related && !["RESOLVED", "CLOSED"].includes(related.status)) {
    if (!legacyUnavailable) {
      await tickets.transfer(
        employeeId,
        related.number,
        summary,
        `handoff-${sourceMessageId}`,
      );
      record.executedActions.push(
        `Transferiu ${related.number} para aguardar analista com resumo.`,
      );
    } else
      record.appliedRules.push(
        "Legado indisponível: chamado não transferido; encaminhamento da conversa preservado para atendimento humano.",
      );
  } else if (related)
    record.appliedRules.push(
      "Chamado terminal não alterado; somente a conversa foi encaminhada.",
    );
  await transitionConversation(
    tx,
    conversationId,
    employeeId,
    "AGENT",
    "WAITING_FOR_ANALYST",
  );
  await tx.conversation.update({
    where: { id: conversationId },
    data: { transferSummary: summary, analystId: null },
  });
  record.decision = "transferir";
  record.executedActions.push(
    "Encaminhou a conversa para a fila de analistas e pausou o agent.",
  );
  return `Encaminhei sua conversa para um analista, com o resumo do caso. O assistente está pausado enquanto você aguarda atendimento.${legacyUnavailable ? " O serviço de chamados está indisponível; não consegui transferir o chamado relacionado nesta tentativa." : ""}`;
}
