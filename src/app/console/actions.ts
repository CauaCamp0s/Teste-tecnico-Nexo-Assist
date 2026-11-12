"use server";

import type { ConversationStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { db } from "@/lib/db";
import { ticketService } from "@/services/tickets";
import { createAnalystService } from "@/services/analyst";
import { serializeChatMessage } from "@/services/chat";
import { ticketCard } from "@/services/chat-payload";

const service = createAnalystService(db, ticketService);

export async function getConsoleSnapshot(
  status?: ConversationStatus,
  conversationId?: string,
) {
  const analyst = await requireRole("ANALYST");
  const [conversations, counts] = await Promise.all([
    service.list(analyst.id, status),
    service.counts(analyst.id),
  ]);
  const selectedId = conversationId ?? conversations[0]?.id;
  const detail = selectedId
    ? await service.detail(analyst.id, selectedId)
    : null;
  return {
    conversations,
    counts,
    detail: detail
      ? {
          ...detail,
          messages: detail.messages.map(serializeChatMessage),
          tickets: detail.tickets.map(ticketCard),
        }
      : null,
  };
}

export async function listAnalystConversations(status?: ConversationStatus) {
  const analyst = await requireRole("ANALYST");
  return service.list(analyst.id, status);
}
export async function getAnalystConversation(conversationId: string) {
  const analyst = await requireRole("ANALYST");
  return service.detail(analyst.id, conversationId);
}
export async function manageAnalystConversation(
  conversationId: string,
  action: "assume" | "reply" | "return" | "close",
  content?: string,
) {
  const analyst = await requireRole("ANALYST");
  return service.act(analyst.id, conversationId, action, content);
}
