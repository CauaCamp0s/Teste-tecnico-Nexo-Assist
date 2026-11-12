import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

let directory: string;
let db: PrismaClient;
let chat: typeof import("./chat");
const respond = vi.fn();

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-chat-test-"));
  const databaseUrl = `file:${join(directory, "chat.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  await db.user.createMany({
    data: [
      { id: "ana", name: "Ana", email: "ana@nexo.com.br" },
      { id: "bruno", name: "Bruno", email: "bruno@nexo.com.br" },
    ],
  });
  vi.doMock("@/lib/db", () => ({ db }));
  vi.doMock("@/agent/help-center", () => ({ respondToConversation: respond }));
  chat = await import("./chat");
}, 30_000);

beforeEach(async () => {
  respond.mockReset();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.conversation.create({ data: { id: "chat-ana", employeeId: "ana" } });
});

afterAll(async () => {
  await db?.$disconnect();
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/agent/help-center");
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("persiste mensagem antes de chamar o modelo e mantém histórico quando ele falha", async () => {
  const message = await chat.saveChatMessage("ana", "chat-ana", "VPN erro 809");
  expect(respond).not.toHaveBeenCalled();
  respond.mockRejectedValue(new Error("Modelo indisponível"));
  await expect(
    chat.generateChatReply("ana", "chat-ana", message.id),
  ).rejects.toThrow("Modelo indisponível");
  await db.$disconnect();
  expect(
    await db.message.findUnique({ where: { id: message.id } }),
  ).toMatchObject({
    content: "VPN erro 809",
    role: "EMPLOYEE",
    authorId: "ana",
  });
});

test("outro funcionário não envia nem solicita resposta na conversa alheia", async () => {
  const saved = await chat.saveChatMessage("ana", "chat-ana", "Minha mensagem");
  await expect(
    chat.saveChatMessage("bruno", "chat-ana", "Tentativa"),
  ).rejects.toThrow();
  await expect(
    chat.generateChatReply("bruno", "chat-ana", saved.id),
  ).rejects.toThrow();
  expect(respond).not.toHaveBeenCalled();
  expect(await db.message.count()).toBe(1);
});

test("resposta já persistida é devolvida sem gerar novamente ou duplicar mensagem", async () => {
  const message = await chat.saveChatMessage("ana", "chat-ana", "Olá");
  const reply = await db.message.create({
    data: {
      conversationId: "chat-ana",
      role: "AGENT",
      content: "Como posso ajudar?",
      createdAt: new Date(Date.now() + 1_000),
    },
  });
  expect((await chat.generateChatReply("ana", "chat-ana", message.id)).id).toBe(
    reply.id,
  );
  expect(respond).not.toHaveBeenCalled();
});

test.each(["ANALYST", "CLOSED", "WAITING_FOR_ANALYST"] as const)(
  "agent pausado em %s; funcionário só é bloqueado quando encerrada",
  async (status) => {
    const saved = await chat.saveChatMessage("ana", "chat-ana", "Olá");
    await db.conversation.update({
      where: { id: "chat-ana" },
      data: { status },
    });
    if (status === "CLOSED")
      await expect(
        chat.saveChatMessage("ana", "chat-ana", "Mais dados"),
      ).rejects.toThrow();
    else
      await expect(
        chat.saveChatMessage("ana", "chat-ana", "Mais dados"),
      ).resolves.toMatchObject({ role: "EMPLOYEE" });
    await expect(
      chat.generateChatReply("ana", "chat-ana", saved.id),
    ).rejects.toThrow();
    expect(respond).not.toHaveBeenCalled();
  },
);

test("rejeita referência obsoleta e texto inválido sem invocar o agent", async () => {
  await chat.saveChatMessage("ana", "chat-ana", "Olá");
  await expect(
    chat.generateChatReply("ana", "chat-ana", "outra-mensagem"),
  ).rejects.toThrow();
  await expect(chat.saveChatMessage("ana", "chat-ana", " ")).rejects.toThrow();
  await expect(
    chat.saveChatMessage("ana", "chat-ana", "a".repeat(4_001)),
  ).rejects.toThrow();
  expect(respond).not.toHaveBeenCalled();
});
