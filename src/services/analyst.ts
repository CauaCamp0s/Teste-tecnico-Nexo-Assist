import {
  ConversationStatus,
  type PrismaClient,
  type Prisma,
  type Conversation,
} from "@prisma/client";
import { z } from "zod";
import type { TicketService } from "./tickets/types";
import { transitionConversation } from "./conversation-state";
import { TicketUnavailableError } from "./tickets/errors";

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
  async function withAssignedConversation<Result>(
    analystId: string,
    conversationId: string,
    execute: (
      tx: Prisma.TransactionClient,
      conversation: Conversation,
    ) => Promise<Result>,
  ) {
    await authorize(analystId);
    return database.$transaction(async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!conversation) throw new Error("Conversa não encontrada.");
      if (
        conversation.status !== "ANALYST" ||
        conversation.analystId !== analystId
      )
        throw new Error("Assuma este atendimento antes de executar a ação.");
      return execute(tx, conversation);
    });
  }
  function recordEvent(
    tx: Prisma.TransactionClient,
    conversationId: string,
    analystId: string,
    content: string,
    role: "SYSTEM" | "ANALYST" = "SYSTEM",
  ) {
    return tx.message.create({
      data: { conversationId, authorId: analystId, role, content },
    });
  }
  async function assume(analystId: string, conversationId: string) {
    await authorize(analystId);
    return database.$transaction(async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!conversation) throw new Error("Conversa não encontrada.");
      if (
        conversation.status !== "WAITING_FOR_ANALYST" ||
        conversation.analystId
      )
        throw new Error("Conversa não disponível para assumir.");
      await transitionConversation(
        tx,
        conversationId,
        conversation.employeeId,
        conversation.status,
        "ANALYST",
      );
      await tx.conversation.update({
        where: { id: conversationId },
        data: { analystId },
      });
      return recordEvent(
        tx,
        conversationId,
        analystId,
        "Um analista assumiu o atendimento. Assistente pausado.",
      );
    });
  }
  async function reply(
    analystId: string,
    conversationId: string,
    content: string,
  ) {
    return withAssignedConversation(analystId, conversationId, async (tx) => {
      const text = z.string().trim().min(1).max(4000).parse(content);
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return recordEvent(tx, conversationId, analystId, text, "ANALYST");
    });
  }
  async function returnToAgent(analystId: string, conversationId: string) {
    return withAssignedConversation(
      analystId,
      conversationId,
      async (tx, conversation) => {
        await transitionConversation(
          tx,
          conversationId,
          conversation.employeeId,
          "ANALYST",
          "AGENT",
        );
        await tx.conversation.update({
          where: { id: conversationId },
          data: { analystId: null },
        });
        return recordEvent(
          tx,
          conversationId,
          analystId,
          "Atendimento devolvido ao assistente.",
        );
      },
    );
  }
  async function close(analystId: string, conversationId: string) {
    return withAssignedConversation(
      analystId,
      conversationId,
      async (tx, conversation) => {
        await transitionConversation(
          tx,
          conversationId,
          conversation.employeeId,
          "ANALYST",
          "CLOSED",
        );
        return recordEvent(
          tx,
          conversationId,
          analystId,
          "Atendimento encerrado pelo analista.",
        );
      },
    );
  }
  return {
    assume,
    reply,
    returnToAgent,
    close,
    async counts(analystId: string) {
      await authorize(analystId);
      const grouped = await database.conversation.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      const counts = {
        ALL: 0,
        AGENT: 0,
        WAITING_FOR_ANALYST: 0,
        ANALYST: 0,
        CLOSED: 0,
      };
      for (const group of grouped) {
        counts[group.status] = group._count._all;
        counts.ALL += group._count._all;
      }
      return counts;
    },
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
      try {
        return {
          ...conversation,
          tickets: await tickets.list(conversation.employeeId),
          ticketsUnavailable: false,
        };
      } catch (error) {
        if (!(error instanceof TicketUnavailableError)) throw error;
        return { ...conversation, tickets: [], ticketsUnavailable: true };
      }
    },
    async act(
      analystId: string,
      id: string,
      action: "assume" | "reply" | "return" | "close",
      content?: string,
    ) {
      z.enum(["assume", "reply", "return", "close"]).parse(action);
      switch (action) {
        case "assume":
          return assume(analystId, id);
        case "reply":
          return reply(analystId, id, content ?? "");
        case "return":
          return returnToAgent(analystId, id);
        case "close":
          return close(analystId, id);
      }
    },
  };
}
