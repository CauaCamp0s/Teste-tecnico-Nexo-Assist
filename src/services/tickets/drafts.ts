import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { TicketError } from "./errors";
import { createTicketService } from "./service";
import type { TicketService } from "./types";
import { requireEmployeeId, ticketContentSchema } from "./validation";
import { assertCanReopen } from "./reopening";

const draftInputSchema = z
  .object({
    conversationId: z.string().min(1),
    kind: z.enum(["CREATE", "UPDATE", "REOPEN"]),
    targetNumber: z.string().trim().min(1).optional(),
    content: ticketContentSchema,
  })
  .refine((input) =>
    input.kind === "CREATE" ? !input.targetNumber : !!input.targetNumber,
  );

export type TicketDraftInput = z.infer<typeof draftInputSchema>;

async function readDraft(
  tx: Prisma.TransactionClient,
  employeeId: string,
  id: string,
) {
  requireEmployeeId(employeeId);
  if (typeof id !== "string" || !id.trim())
    throw new TicketError("NOT_FOUND", "Rascunho não encontrado.");
  const draft = await tx.ticketDraft.findFirst({
    where: { id, employeeId, conversation: { employeeId } },
  });
  if (!draft) throw new TicketError("NOT_FOUND", "Rascunho não encontrado.");
  return draft;
}

export function createDraftService(
  database: PrismaClient,
  clock: () => Date = () => new Date(),
  ticketFactory: (tx: Prisma.TransactionClient) => TicketService = (tx) =>
    createTicketService(tx, clock),
) {
  return {
    async create(employeeId: string, input: TicketDraftInput) {
      requireEmployeeId(employeeId);
      const parsed = draftInputSchema.safeParse(input);
      if (!parsed.success)
        throw new TicketError(
          "INVALID_INPUT",
          "Informe a operação, a conversa, o alvo quando necessário e o conteúdo completo do rascunho.",
        );
      const { conversationId, kind, targetNumber, content } = parsed.data;
      return database.$transaction(async (tx) => {
        const conversation = await tx.conversation.findFirst({
          where: { id: conversationId, employeeId, status: "AGENT" },
        });
        if (!conversation)
          throw new TicketError(
            "NOT_FOUND",
            "Conversa não disponível para este funcionário.",
          );
        const target = targetNumber
          ? await tx.ticket.findFirst({
              where: { employeeId, number: targetNumber.toUpperCase() },
            })
          : null;
        if (kind !== "CREATE" && !target)
          throw new TicketError("NOT_FOUND", "Chamado não encontrado.");
        return tx.ticketDraft.create({
          data: {
            employeeId,
            conversationId,
            kind,
            targetTicketId: target?.id,
            ...content,
            createdAt: clock(),
          },
        });
      });
    },
    get: (employeeId: string, id: string) =>
      readDraft(database, employeeId, id),
    async cancel(employeeId: string, id: string) {
      return database.$transaction(async (tx) => {
        const draft = await readDraft(tx, employeeId, id);
        if (draft.status === "CANCELED") return draft;
        if (draft.status !== "PENDING")
          throw new TicketError(
            "INVALID_STATE",
            "Somente rascunhos pendentes podem ser cancelados.",
          );
        await tx.ticketDraft.updateMany({
          where: { id, employeeId, status: "PENDING" },
          data: { status: "CANCELED" },
        });
        return readDraft(tx, employeeId, id);
      });
    },
    async confirm(employeeId: string, id: string) {
      let pending = false;
      try {
        return await database.$transaction(async (tx) => {
          const draft = await readDraft(tx, employeeId, id);
          if (draft.status === "CONFIRMED") {
            const ticket = await tx.ticket.findFirst({
              where: { id: draft.resultTicketId ?? "", employeeId },
            });
            if (!ticket)
              throw new TicketError(
                "NOT_FOUND",
                "Chamado confirmado não encontrado.",
              );
            return {
              draft,
              ticket: (await ticketFactory(tx).get(employeeId, ticket.number))!,
            };
          }
          if (draft.status !== "PENDING")
            throw new TicketError(
              "INVALID_STATE",
              "Somente rascunhos pendentes podem ser confirmados.",
            );
          pending = true;
          const conversation = await tx.conversation.findFirst({
            where: { id: draft.conversationId, employeeId, status: "AGENT" },
          });
          if (!conversation)
            throw new TicketError(
              "INVALID_STATE",
              "A conversa não está mais com o assistente.",
            );
          const content = ticketContentSchema.parse(draft);
          const tickets = ticketFactory(tx);
          const target = draft.targetTicketId
            ? await tx.ticket.findFirst({
                where: { id: draft.targetTicketId, employeeId },
              })
            : null;
          if (draft.kind !== "CREATE" && !target)
            throw new TicketError("NOT_FOUND", "Chamado não encontrado.");
          if (draft.kind === "REOPEN") assertCanReopen(target!, clock());
          const ticket =
            draft.kind === "CREATE"
              ? await tickets.create(employeeId, content, draft.id)
              : draft.kind === "UPDATE"
                ? await tickets.addUpdate(
                    employeeId,
                    target!.number,
                    content,
                    draft.id,
                  )
                : await tickets.reopen(
                    employeeId,
                    target!.number,
                    content,
                    draft.id,
                  );
          const changed = await tx.ticketDraft.updateMany({
            where: { id, employeeId, status: "PENDING" },
            data: {
              status: "CONFIRMED",
              resultTicketId: ticket.id,
              failureCode: null,
            },
          });
          if (!changed.count)
            throw new TicketError(
              "INVALID_STATE",
              "O rascunho não está mais pendente.",
            );
          return { draft: await readDraft(tx, employeeId, id), ticket };
        });
      } catch (error) {
        if (pending)
          await database.ticketDraft.updateMany({
            where: { id, employeeId, status: "PENDING" },
            data: {
              status: "FAILED",
              failureCode:
                error instanceof TicketError ? error.code : "INTERNAL_ERROR",
            },
          });
        throw error;
      }
    },
  };
}
