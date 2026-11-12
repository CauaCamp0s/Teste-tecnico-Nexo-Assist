import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed-data";

let directory: string;
let db: PrismaClient;
let auth: typeof import("./auth");

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-auth-test-"));
  const databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  await seedDatabase(db);
  vi.doMock("@/lib/db", () => ({ db }));
  auth = await import("./auth");
}, 30_000);

afterAll(async () => {
  await db?.$disconnect();
  vi.doUnmock("@/lib/db");
  if (directory) await rm(directory, { recursive: true, force: true });
});

test.each([
  [" ANA.SOUZA@nexo.com.br ", "qualquer senha", "EMPLOYEE"],
  ["rafael.lima@nexo.com.br", "outra senha", "ANALYST"],
])(
  "aceita o usuário cadastrado %s e mantém seu papel",
  async (email, password, role) => {
    const session = await auth.createSession(email, password);
    expect(session).not.toBeNull();
    expect(session?.user.role).toBe(role);
    expect(await auth.getSessionUser(session?.token)).toEqual(session?.user);
  },
);

test.each([
  ["desconhecido@nexo.com.br", "senha"],
  ["ana.souza@nexo.com.br", ""],
  ["", "senha"],
])(
  "rejeita credenciais inválidas sem criar sessão: %s",
  async (email, password) => {
    const count = await db.session.count();
    expect(await auth.createSession(email, password)).toBeNull();
    expect(await db.session.count()).toBe(count);
  },
);

test("gera tokens distintos e persiste apenas o hash com validade de sete dias", async () => {
  const first = await auth.createSession("ana.souza@nexo.com.br", "senha");
  const second = await auth.createSession("ana.souza@nexo.com.br", "senha");
  expect(first?.token).toMatch(/^[a-f0-9]{64}$/);
  expect(first?.token).not.toBe(second?.token);
  const stored = await db.session.findMany();
  expect(stored.every((session) => session.tokenHash !== first?.token)).toBe(
    true,
  );
  expect(first!.expiresAt.getTime() - Date.now()).toBeGreaterThan(
    6.99 * 24 * 60 * 60 * 1000,
  );
  expect(first!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
    7 * 24 * 60 * 60 * 1000,
  );
});

test("rejeita sessão expirada mesmo quando o cookie ainda existe", async () => {
  const session = await auth.createSession(
    "bruno.tavares@nexo.com.br",
    "senha",
  );
  await db.session.updateMany({
    where: { userId: session!.user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(await auth.getSessionUser(session?.token)).toBeNull();
});

test("revoga somente a sessão encerrada e rejeita sua reutilização", async () => {
  const first = await auth.createSession("ana.souza@nexo.com.br", "senha");
  const second = await auth.createSession("ana.souza@nexo.com.br", "senha");
  await auth.revokeSession(first?.token);
  await auth.revokeSession(first?.token);
  expect(await auth.getSessionUser(first?.token)).toBeNull();
  expect(await auth.getSessionUser(second?.token)).toEqual(second?.user);
});

test.each([undefined, "token-adulterado", "0".repeat(64)])(
  "não autentica token ausente, malformado ou desconhecido: %s",
  async (token) => {
    expect(await auth.getSessionUser(token)).toBeNull();
  },
);
