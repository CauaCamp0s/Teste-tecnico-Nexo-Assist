import type { ConversationStatus, Prisma } from "@prisma/client";

const transitions: Record<ConversationStatus, readonly ConversationStatus[]> = {
  AGENT: ["WAITING_FOR_ANALYST", "CLOSED"],
  WAITING_FOR_ANALYST: ["ANALYST", "CLOSED"],
  ANALYST: ["AGENT", "CLOSED"],
  CLOSED: [],
};

export async function transitionConversation(
  tx: Prisma.TransactionClient,
  id: string,
  employeeId: string,
  from: ConversationStatus,
  to: ConversationStatus,
) {
  if (!transitions[from].includes(to))
    throw new Error("Transição de atendimento inválida.");
  const changed = await tx.conversation.updateMany({
    where: { id, employeeId, status: from },
    data: { status: to, updatedAt: new Date() },
  });
  if (!changed.count)
    throw new Error("O estado da conversa mudou. Atualize o atendimento.");
}
