import type { PrismaClient, Prisma, TicketDraft } from "@prisma/client";
import { createDraftService } from "./tickets/drafts";
import { createTicketService } from "./tickets/service";
import type { TicketService } from "./tickets/types";
import { TicketError, TicketUnavailableError } from "./tickets/errors";
import { buildDecisionRecord } from "@/agent/decisions";
import { ticketCard, type ChatPayload } from "./chat-payload";

async function refreshCards(tx: Prisma.TransactionClient, draft: TicketDraft) {
  const messages = await tx.message.findMany({
    where: { conversationId: draft.conversationId, role: "AGENT" },
  });
  for (const message of messages) {
    const payload = message.payload as ChatPayload | null;
    if (payload?.draft?.id === draft.id)
      await tx.message.update({
        where: { id: message.id },
        data: {
          payload: {
            ...payload,
            draft: { ...payload.draft, status: draft.status },
          },
        },
      });
  }
}

export function createChatDraftService(
  database: PrismaClient,
  ticketFactory: (
    tx: Prisma.TransactionClient,
  ) => TicketService = createTicketService,
) {
  return async (
    employeeId: string,
    conversationId: string,
    draftId: string,
    action: "confirm" | "cancel",
  ) => {
    if (!["confirm", "cancel"].includes(action))
      throw new Error("Ação inválida.");
    const draft = await database.ticketDraft.findFirst({
      where: {
        id: draftId,
        employeeId,
        conversationId,
        conversation: { employeeId },
      },
    });
    if (!draft) throw new Error("Rascunho não encontrado.");
    const messageId = `draft-${draft.id}-${action}`;
    const record = buildDecisionRecord(
      {
        understanding: {
          intent: "ti",
          summary: `${action === "confirm" ? "Confirmação" : "Cancelamento"}: ${draft.title}`,
        },
        confidence: "alta",
        reason:
          "Ação explícita do funcionário autenticado, validada pelo servidor sem LLM.",
      },
      [],
    );
    record.confidence = "alta";
    record.appliedRules = [
      "Identidade da sessão e propriedade da conversa, rascunho e chamado revalidadas.",
      "Confirmação determinística; chave de idempotência igual ao id do rascunho.",
    ];
    try {
      return await database.$transaction(async (tx) => {
        const previous = await tx.message.findFirst({
          where: {
            id: messageId,
            conversationId,
            conversation: { employeeId },
          },
        });
        if (previous) return previous;
        const c = await tx.conversation.findFirst({
          where: { id: conversationId, employeeId, status: "AGENT" },
        });
        if (!c)
          throw new TicketError(
            "INVALID_STATE",
            "A conversa não está com o assistente.",
          );
        const drafts = createDraftService(tx, undefined, ticketFactory);
        let payload: ChatPayload = {};
        let content: string;
        let changed: TicketDraft;
        if (action === "confirm") {
          const result = await drafts.confirm(employeeId, draftId);
          changed = result.draft;
          const verb =
            changed.kind === "CREATE"
              ? "Criou"
              : changed.kind === "UPDATE"
                ? "Atualizou"
                : "Reabriu";
          record.decision = "confirmar_alteracao";
          record.executedActions.push(`${verb} ${result.ticket.number}.`);
          record.appliedRules.push(
            `Prazo real: ${result.ticket.dueAt?.toISOString() ?? "sem prazo pendente"}; calculado pelo serviço após a escrita.`,
          );
          content = `${verb} o chamado ${result.ticket.number}. Confira os dados e o prazo abaixo.`;
          payload = { tickets: [ticketCard(result.ticket)] };
        } else {
          changed = await drafts.cancel(employeeId, draftId);
          record.decision = "cancelar_rascunho";
          record.executedActions.push(
            `Cancelou o rascunho ${draftId}; nenhum chamado alterado.`,
          );
          content = "Rascunho cancelado. Nenhum chamado foi alterado.";
        }
        await refreshCards(tx, changed);
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
        return tx.message.create({
          data: {
            id: messageId,
            conversationId,
            role: "AGENT",
            content,
            payload,
            decisionRecord: record,
          },
        });
      });
    } catch (error) {
      // A transação anterior foi desfeita, inclusive a mutação do chamado.
      const unavailable = error instanceof TicketUnavailableError;
      const failureCode =
        error instanceof TicketError ? error.code : "INTERNAL_ERROR";
      return database.$transaction(async (tx) => {
        // Uma confirmação concorrente pode já ter concluído enquanto esta falhou.
        const previous = await tx.message.findFirst({
          where: {
            id: messageId,
            conversationId,
            conversation: { employeeId },
          },
        });
        if (previous) return previous;
        await tx.ticketDraft.updateMany({
          where: { id: draftId, employeeId, status: "PENDING" },
          data: { status: unavailable ? "PENDING" : "FAILED", failureCode },
        });
        const current = await tx.ticketDraft.findFirstOrThrow({
          where: { id: draftId, employeeId },
        });
        await refreshCards(tx, current);
        record.decision = unavailable ? "indisponivel" : "pedir_detalhes";
        record.executedActions = [];
        record.reason = unavailable
          ? "O serviço permaneceu indisponível após três tentativas; a transação foi desfeita."
          : `A confirmação não foi concluída: ${failureCode}.`;
        record.appliedRules.push(
          unavailable
            ? "Rascunho permanece pendente para nova tentativa."
            : "Erro definitivo: é necessário revisar ou criar outro rascunho.",
        );
        return tx.message.create({
          data: {
            conversationId,
            role: "AGENT",
            content: unavailable
              ? "O serviço de chamados está indisponível. Nenhuma alteração foi confirmada nesta tentativa. O rascunho continua pendente; use Tentar novamente no card."
              : "Não foi possível concluir esta alteração. Revise os dados ou peça um novo rascunho.",
            decisionRecord: record,
          },
        });
      });
    }
  };
}
