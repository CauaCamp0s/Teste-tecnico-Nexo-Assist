import { db } from "@/lib/db";

export async function startConversation(employeeId: string) {
  return db.conversation.create({ data: { employeeId } });
}

export async function getOrCreateConversation(employeeId: string) {
  return db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { employeeId, status: { not: "CLOSED" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return conversation ?? tx.conversation.create({ data: { employeeId } });
  });
}

export async function listConversations(employeeId: string) {
  return db.conversation.findMany({
    where: { employeeId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
}

export async function getConversation(
  employeeId: string,
  conversationId: string,
) {
  return db.conversation.findFirst({
    where: { id: conversationId, employeeId },
    include: {
      messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
}

export async function addMessage(
  employeeId: string,
  conversationId: string,
  content: string,
) {
  const text = content.trim();
  if (!text) throw new Error("A mensagem não pode estar vazia.");

  return db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, employeeId },
    });
    if (!conversation) throw new Error("Conversa não encontrada.");
    if (conversation.status === "CLOSED")
      throw new Error("Esta conversa foi encerrada.");
    const count = await tx.message.count({
      where: { conversationId, role: "EMPLOYEE" },
    });
    if (count >= 30)
      throw new Error(
        "Limite de 30 mensagens atingido. Inicie uma nova conversa.",
      );
    const updated = await tx.conversation.updateMany({
      where: { id: conversationId, employeeId },
      data: { updatedAt: new Date() },
    });
    if (updated.count === 0) throw new Error("Conversa não encontrada.");

    return tx.message.create({
      data: {
        conversation: { connect: { id: conversationId, employeeId } },
        author: { connect: { id: employeeId } },
        role: "EMPLOYEE",
        content: text,
      },
    });
  });
}
