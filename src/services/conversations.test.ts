import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { transitionConversation } from "./conversation-state";

let directory: string;
let db: PrismaClient;
let conversations: typeof import("./conversations");

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-conversations-test-"));
  const databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
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
  conversations = await import("./conversations");
}, 30_000);

beforeEach(async () => {
  await db.message.deleteMany();
  await db.conversation.deleteMany();
});

afterAll(async () => {
  await db?.$disconnect();
  vi.doUnmock("@/lib/db");
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("cria a primeira conversa e a retoma sem duplicar", async () => {
  const first = await conversations.getOrCreateConversation("ana");
  const resumed = await conversations.getOrCreateConversation("ana");

  expect(first.employeeId).toBe("ana");
  expect(first.status).toBe("AGENT");
  expect(resumed.id).toBe(first.id);
  expect(await conversations.listConversations("ana")).toHaveLength(1);
  expect(await conversations.listConversations("bruno")).toEqual([]);
});

test("retoma pela atividade mais recente, excluindo encerradas e de outro funcionário", async () => {
  await db.conversation.createMany({
    data: [
      {
        id: "antiga",
        employeeId: "ana",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-04"),
        status: "WAITING_FOR_ANALYST",
      },
      {
        id: "nova",
        employeeId: "ana",
        createdAt: new Date("2026-01-02"),
        updatedAt: new Date("2026-01-03"),
        status: "AGENT",
      },
      {
        id: "encerrada",
        employeeId: "ana",
        updatedAt: new Date("2026-01-05"),
        status: "CLOSED",
      },
      {
        id: "de-bruno",
        employeeId: "bruno",
        updatedAt: new Date("2026-01-06"),
        status: "AGENT",
      },
    ],
  });

  const resumed = await conversations.getOrCreateConversation("ana");
  expect(resumed.id).toBe("antiga");
  expect(resumed.status).toBe("WAITING_FOR_ANALYST");
  expect(
    (await conversations.listConversations("ana")).map(({ id }) => id),
  ).toEqual(["encerrada", "antiga", "nova"]);
});

test("cria uma nova conversa quando só existem encerradas e preserva o histórico", async () => {
  await db.conversation.create({
    data: {
      id: "encerrada",
      employeeId: "ana",
      status: "CLOSED",
      messages: {
        create: {
          role: "EMPLOYEE",
          authorId: "ana",
          content: "Problema anterior",
        },
      },
    },
  });
  const created = await conversations.getOrCreateConversation("ana");

  expect(created.id).not.toBe("encerrada");
  expect(created.status).toBe("AGENT");
  expect(await conversations.listConversations("ana")).toHaveLength(2);
  const previous = await conversations.getConversation("ana", "encerrada");
  expect(previous?.status).toBe("CLOSED");
  expect(previous?.messages[0].content).toBe("Problema anterior");
});

test("funcionário não lê nem escreve na conversa de outro funcionário", async () => {
  const owned = await conversations.getOrCreateConversation("bruno");
  await conversations.addMessage("bruno", owned.id, "Informação de Bruno");
  const before = await conversations.getConversation("bruno", owned.id);

  expect(await conversations.getConversation("ana", owned.id)).toBeNull();
  expect(await conversations.listConversations("ana")).toEqual([]);
  await expect(
    conversations.addMessage("ana", owned.id, "Tentativa de alteração"),
  ).rejects.toThrow("Conversa não encontrada.");
  expect(await conversations.getConversation("bruno", owned.id)).toEqual(
    before,
  );
  const own = await conversations.getOrCreateConversation("ana");
  expect(own.id).not.toBe(owned.id);
});

test("conversa inexistente e conversa alheia produzem o mesmo resultado", async () => {
  const other = await conversations.getOrCreateConversation("bruno");
  for (const id of [other.id, "inexistente"]) {
    expect(await conversations.getConversation("ana", id)).toBeNull();
    await expect(conversations.addMessage("ana", id, "Olá")).rejects.toThrow(
      "Conversa não encontrada.",
    );
  }
});

test("adicionar mensagem vincula o autor e atualiza a atividade sem alterar o estado", async () => {
  await db.conversation.createMany({
    data: [
      {
        id: "em-atendimento",
        employeeId: "ana",
        status: "ANALYST",
        updatedAt: new Date("2026-01-01"),
      },
      { id: "outra", employeeId: "ana", updatedAt: new Date("2026-01-02") },
    ],
  });

  const message = await conversations.addMessage(
    "ana",
    "em-atendimento",
    "  Mais informações  ",
  );
  expect(message.authorId).toBe("ana");
  expect(message.role).toBe("EMPLOYEE");
  expect(message.content).toBe("Mais informações");
  const resumed = await conversations.getOrCreateConversation("ana");
  expect(resumed.id).toBe("em-atendimento");
  expect(resumed.status).toBe("ANALYST");
  expect((await conversations.listConversations("ana"))[0].id).toBe(
    "em-atendimento",
  );
});

test("carrega o histórico em ordem cronológica, inclusive após reconexão", async () => {
  const conversation = await conversations.getOrCreateConversation("ana");
  await db.message.createMany({
    data: [
      {
        id: "terceira",
        conversationId: conversation.id,
        role: "AGENT",
        content: "Resposta",
        createdAt: new Date("2026-01-02"),
      },
      {
        id: "segunda",
        conversationId: conversation.id,
        role: "EMPLOYEE",
        authorId: "ana",
        content: "Detalhes",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "primeira",
        conversationId: conversation.id,
        role: "EMPLOYEE",
        authorId: "ana",
        content: "Olá",
        createdAt: new Date("2026-01-01"),
      },
    ],
  });
  await db.$disconnect();
  const history = await conversations.getConversation("ana", conversation.id);
  expect(history?.messages.map(({ content }) => content)).toEqual([
    "Olá",
    "Detalhes",
    "Resposta",
  ]);
  expect((await conversations.getOrCreateConversation("ana")).id).toBe(
    conversation.id,
  );
});

test("rejeita mensagem vazia sem alterar a conversa", async () => {
  const conversation = await conversations.getOrCreateConversation("ana");
  const before = await conversations.getConversation("ana", conversation.id);
  await expect(
    conversations.addMessage("ana", conversation.id, " \n "),
  ).rejects.toThrow("A mensagem não pode estar vazia.");
  expect(await conversations.getConversation("ana", conversation.id)).toEqual(
    before,
  );
});

test("limite é atômico, preserva atendimento pendente e permite nova conversa", async () => {
  const c = await conversations.getOrCreateConversation("ana");
  for (let i = 0; i < 29; i++)
    await conversations.addMessage("ana", c.id, `Mensagem ${i}`);
  const result = await Promise.allSettled([
    conversations.addMessage("ana", c.id, "30"),
    conversations.addMessage("ana", c.id, "31"),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await db.$transaction((tx) =>
    transitionConversation(tx, c.id, "ana", "AGENT", "WAITING_FOR_ANALYST"),
  );
  const next = await conversations.startConversation("ana");
  expect(next.id).not.toBe(c.id);
  expect((await conversations.getConversation("ana", c.id))?.status).toBe(
    "WAITING_FOR_ANALYST",
  );
  expect(
    (await conversations.getConversation("ana", c.id))?.messages,
  ).toHaveLength(30);
});

test("transições validam origem e encerramento bloqueia novas mensagens", async () => {
  const c = await conversations.getOrCreateConversation("ana");
  await expect(
    db.$transaction((tx) =>
      transitionConversation(tx, c.id, "ana", "AGENT", "ANALYST"),
    ),
  ).rejects.toThrow("inválida");
  await expect(
    db.$transaction((tx) =>
      transitionConversation(tx, c.id, "bruno", "AGENT", "CLOSED"),
    ),
  ).rejects.toThrow("estado");
  for (const [from, to] of [
    ["AGENT", "WAITING_FOR_ANALYST"],
    ["WAITING_FOR_ANALYST", "ANALYST"],
    ["ANALYST", "AGENT"],
    ["AGENT", "CLOSED"],
  ] as const) {
    await db.$transaction((tx) =>
      transitionConversation(tx, c.id, "ana", from, to),
    );
  }
  await expect(conversations.addMessage("ana", c.id, "Olá")).rejects.toThrow(
    "encerrada",
  );
  await expect(
    db.$transaction((tx) =>
      transitionConversation(tx, c.id, "ana", "CLOSED", "AGENT"),
    ),
  ).rejects.toThrow("inválida");
});
