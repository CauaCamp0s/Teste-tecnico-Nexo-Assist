"use server";

import type { ConversationStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { db } from "@/lib/db";
import { ticketService } from "@/services/tickets";
import { createAnalystService } from "@/services/analyst";

const service = createAnalystService(db, ticketService);

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
