import type { Message } from "@prisma/client";
import type { DecisionRecord } from "@/agent/decisions";
import { respondToConversation } from "@/agent/help-center";
import { addMessage, getConversation } from "./conversations";
import type { ChatPayload } from "./chat-payload";

export type ChatMessage = {
  id: string;
  role: Message["role"];
  content: string;
  createdAt: string;
  decisionRecord: DecisionRecord | null;
  payload?: ChatPayload | null;
};

export function serializeChatMessage(message: Message): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    decisionRecord: message.decisionRecord as DecisionRecord | null,
    payload: message.payload as ChatPayload | null,
  };
}

export async function saveChatMessage(
  employeeId: string,
  conversationId: string,
  content: string,
) {
  if (typeof content !== "string" || content.trim().length > 4_000) {
    throw new Error("Envie uma mensagem com até 4.000 caracteres.");
  }
  const conversation = await getConversation(employeeId, conversationId);
  if (!conversation || conversation.status === "CLOSED") {
    throw new Error("Esta conversa não está disponível para o assistente.");
  }
  return serializeChatMessage(
    await addMessage(employeeId, conversationId, content),
  );
}

export async function generateChatReply(
  employeeId: string,
  conversationId: string,
  employeeMessageId: string,
) {
  const conversation = await getConversation(employeeId, conversationId);
  if (!conversation || conversation.status !== "AGENT") {
    throw new Error("Esta conversa não está disponível para o assistente.");
  }
  const last = conversation.messages.at(-1);
  const latestEmployee = conversation.messages.findLast(
    (message) => message.role === "EMPLOYEE",
  );
  const failed =
    last?.role === "AGENT" &&
    !!(last.decisionRecord as DecisionRecord | null)?.modelFailure;
  if (
    last?.role === "AGENT" &&
    latestEmployee?.id === employeeMessageId &&
    !failed
  ) {
    return serializeChatMessage(last);
  }
  if (
    latestEmployee?.id !== employeeMessageId ||
    (last?.role !== "EMPLOYEE" && !failed)
  ) {
    throw new Error("A conversa foi atualizada. Recarregue para continuar.");
  }
  return serializeChatMessage(
    await respondToConversation(employeeId, conversationId),
  );
}
