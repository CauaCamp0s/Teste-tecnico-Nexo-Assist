"use server";

import { requireRole } from "@/lib/session";
import {
  saveChatMessage,
  generateChatReply,
  type ChatMessage,
} from "@/services/chat";

type ChatResult =
  { message: ChatMessage; error?: never } | { message?: never; error: string };

export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<ChatResult> {
  const user = await requireRole("EMPLOYEE");
  try {
    return { message: await saveChatMessage(user.id, conversationId, content) };
  } catch {
    return {
      error:
        "Não foi possível confirmar o envio. Seu texto foi mantido. Atualize a conversa para verificar se a mensagem foi salva.",
    };
  }
}

export async function requestReply(
  conversationId: string,
  employeeMessageId: string,
): Promise<ChatResult> {
  const user = await requireRole("EMPLOYEE");
  try {
    return {
      message: await generateChatReply(
        user.id,
        conversationId,
        employeeMessageId,
      ),
    };
  } catch {
    return {
      error:
        "Sua mensagem está salva. Não foi possível obter a resposta. Tente novamente ou atualize a conversa.",
    };
  }
}
