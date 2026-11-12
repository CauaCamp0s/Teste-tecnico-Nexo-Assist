import type { Message, Prisma } from "@prisma/client";
import type { DecisionRecord } from "@/agent/decisions";
import type { TicketService } from "./tickets/types";
import type { ChatPayload } from "./chat-payload";
import { transitionConversation } from "./conversation-state";
import { statusLabels, priorityLabels } from "./chat-payload";
import { formatDate, readableDecisionText } from "@/lib/presentation";
import { getTicketSla } from "./tickets/sla";

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
  const previousCards = messages.flatMap((message) => {
    const cards = (message.payload as ChatPayload | null)?.tickets;
    return cards?.length === 1 ? cards : [];
  });
  const number = relatedNumber ?? previousCards.at(-1)?.number;
  const related = number
    ? await tx.ticket.findFirst({ where: { employeeId, number } })
    : null;
  const previousDecisions = messages.flatMap((message) =>
    message.decisionRecord
      ? [message.decisionRecord as unknown as DecisionRecord]
      : [],
  );
  const consultationLabels = {
    search_help_center: "Consultou a central de ajuda",
    list_tickets: "Consultou os chamados do funcionário",
    get_ticket: "Verificou o chamado",
    find_duplicate_candidates: "Verificou possíveis chamados do mesmo problema",
  };
  const verified = [
    ...new Set(
      [...previousDecisions, record].flatMap((decision) =>
        decision.consultations.map(
          (consultation) =>
            `- ${consultationLabels[consultation.tool]}: ${readableDecisionText(consultation.result.summary).slice(0, 700)}`,
        ),
      ),
    ),
  ].slice(-6);
  const sla = related ? getTicketSla(related, new Date()) : null;
  const summary = [
    `Motivo da transferência\n${readableDecisionText(record.reason).slice(0, 700)}`,
    `O que o funcionário relatou\n${
      messages
        .filter((message) => message.role === "EMPLOYEE")
        .slice(-8)
        .map((message) => `- ${message.content.slice(0, 400)}`)
        .join("\n") || "Nenhum relato registrado."
    }`,
    `O que o assistente verificou\n${verified.join("\n") || "Nenhuma consulta concluída antes do encaminhamento."}`,
    `Chamado relacionado\n${related ? `${related.number} · ${related.title}\nStatus na transferência: ${statusLabels[related.status]} · Prioridade ${priorityLabels[related.priority].toLocaleLowerCase("pt-BR")}\nPrazo: ${sla?.dueAt ? `${formatDate(sla.dueAt)} · ${sla.isOverdue ? "vencido" : "dentro do prazo"}` : "sem prazo pendente"}` : "nenhum chamado próprio identificado"}`,
    legacyUnavailable
      ? "Legado indisponível: transferência do chamado não concluída."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
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
