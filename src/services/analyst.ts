import { ConversationStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { TicketService } from "./tickets/types";
import { transitionConversation } from "./conversation-state";

export function createAnalystService(
  database: PrismaClient,
  tickets: TicketService,
) {
  async function authorize(analystId: string) {
    if (
      !(await database.user.findFirst({
        where: { id: analystId, role: "ANALYST" },
      }))
    )
      throw new Error("Acesso restrito a analistas.");
  }
  return {
    async list(analystId: string, status?: ConversationStatus) {
      await authorize(analystId);
      if (status) z.enum(ConversationStatus).parse(status);
      return database.conversation.findMany({
        where: { status },
        include: {
          employee: { select: { id: true, name: true, email: true } },
          analyst: { select: { id: true, name: true } },
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      });
    },
    async detail(analystId: string, id: string) {
      await authorize(analystId);
      const conversation = await database.conversation.findUnique({
        where: { id },
        include: {
          employee: { select: { id: true, name: true, email: true } },
          messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      });
      if (!conversation) throw new Error("Conversa não encontrada.");
      return {
        ...conversation,
        tickets: await tickets.list(conversation.employeeId),
      };
    },
    async act(
      analystId: string,
      id: string,
      action: "assume" | "reply" | "return" | "close",
      content?: string,
    ) {
      await authorize(analystId);
      z.enum(["assume", "reply", "return", "close"]).parse(action);
      const text =
        action === "reply"
          ? z.string().trim().min(1).max(4000).parse(content)
          : "";
      return database.$transaction(async (tx) => {
        const c = await tx.conversation.findUnique({ where: { id } });
        if (!c) throw new Error("Conversa não encontrada.");
        if (action === "assume") {
          if (c.status !== "WAITING_FOR_ANALYST" || c.analystId)
            throw new Error("Conversa não disponível para assumir.");
          await transitionConversation(
            tx,
            id,
            c.employeeId,
            c.status,
            "ANALYST",
          );
          await tx.conversation.update({ where: { id }, data: { analystId } });
        } else {
          if (c.status !== "ANALYST" || c.analystId !== analystId)
            throw new Error(
              "Assuma este atendimento antes de executar a ação.",
            );
          if (action === "reply")
            await tx.conversation.update({
              where: { id },
              data: { updatedAt: new Date() },
            });
          else {
            await transitionConversation(
              tx,
              id,
              c.employeeId,
              "ANALYST",
              action === "return" ? "AGENT" : "CLOSED",
            );
            if (action === "return")
              await tx.conversation.update({
                where: { id },
                data: { analystId: null },
              });
          }
        }
        return tx.message.create({
          data: {
            conversationId: id,
            authorId: analystId,
            role: action === "reply" ? "ANALYST" : "SYSTEM",
            content:
              action === "reply"
                ? text
                : action === "assume"
                  ? "Um analista assumiu o atendimento. Assistente pausado."
                  : action === "return"
                    ? "Atendimento devolvido ao assistente."
                    : "Atendimento encerrado pelo analista.",
          },
        });
      });
    },
  };
}
