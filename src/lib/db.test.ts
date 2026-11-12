import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedDatabase } from "../../prisma/seed-data";

let directory: string;
let db: PrismaClient;
let databaseUrl: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-db-test-"));
  databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
}, 30_000);

afterAll(async () => {
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("o seed pode ser repetido sem duplicar nem sobrescrever dados", async () => {
  const before = new Date();
  await seedDatabase(db);
  const original = await db.user.findUniqueOrThrow({
    where: { email: "ana.souza@nexo.com.br" },
  });
  await db.user.update({
    where: { id: original.id },
    data: { name: "Ana Souza Silva" },
  });
  await seedDatabase(db);

  expect(await db.user.count()).toBe(4);
  expect(await db.user.count({ where: { role: "ANALYST" } })).toBe(1);
  expect(await db.article.count()).toBe(6);
  expect(await db.conversation.count()).toBe(0);
  expect(await db.message.count()).toBe(0);
  const user = await db.user.findUniqueOrThrow({ where: { id: original.id } });
  expect(user.name).toBe("Ana Souza Silva");
  expect(user.createdAt).toEqual(original.createdAt);
  expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());

  const vpn = await db.article.findUniqueOrThrow({
    where: { slug: "vpn-erro-809" },
  });
  expect(vpn.content).toContain("Windows 10");
  expect(vpn.content).toContain("no Windows 11, abra um chamado");
  const hours = await db.article.findUniqueOrThrow({
    where: { slug: "horario-service-desk" },
  });
  expect(hours.content).toContain("das 8h às 18h");
  expect(hours.content).toContain("plantão 24 horas");
});

test("conversa, mensagem e estado sobrevivem à reconexão ao banco", async () => {
  const employee = await db.user.create({
    data: { name: "Funcionário de teste", email: "persistencia@nexo.com.br" },
  });
  const conversation = await db.conversation.create({
    data: {
      employeeId: employee.id,
      status: "WAITING_FOR_ANALYST",
      messages: {
        create: {
          role: "EMPLOYEE",
          authorId: employee.id,
          content: "Preciso de ajuda com a VPN.",
        },
      },
    },
  });

  await db.$disconnect();
  const reconnected = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const saved = await reconnected.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { messages: true },
    });
    expect(saved.employeeId).toBe(employee.id);
    expect(saved.status).toBe("WAITING_FOR_ANALYST");
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0].content).toBe("Preciso de ajuda com a VPN.");
  } finally {
    await reconnected.$disconnect();
  }
});

test("o banco rejeita mensagens sem conversa e conversas sem proprietário", async () => {
  await expect(
    db.message.create({
      data: { conversationId: "inexistente", role: "AGENT", content: "Olá" },
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  await expect(
    db.conversation.create({ data: { employeeId: "inexistente" } }),
  ).rejects.toMatchObject({ code: "P2003" });
});
