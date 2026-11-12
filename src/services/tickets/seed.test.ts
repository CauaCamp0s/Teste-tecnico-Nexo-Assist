import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { seedDatabase } from "../../../prisma/seed-data";
import { getTicketSla } from "./sla";

let directory: string;
let db: PrismaClient;
const now = new Date("2026-11-12T14:00:00-03:00");
const dayMs = 86_400_000;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-ticket-seed-"));
  const databaseUrl = `file:${join(directory, "seed.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
}, 30_000);

beforeEach(async () => {
  await db.ticket.deleteMany();
});
afterAll(async () => {
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("inclui os três chamados do Anexo B para Ana com datas relativas", async () => {
  await seedDatabase(db, now);
  const tickets = await db.ticket.findMany({ include: { employee: true } });
  expect(tickets).toHaveLength(9);
  const examples = [
    {
      number: "INC-20311",
      title: "Notebook lento após atualização do Windows",
      category: "HARDWARE",
      priority: "MEDIUM",
      status: "WAITING_FOR_ANALYST",
      days: 6,
    },
    {
      number: "REQ-10442",
      title: "Segundo monitor para home office",
      category: "HARDWARE",
      priority: "LOW",
      status: "APPROVED",
      days: 7,
    },
    {
      number: "INC-20150",
      title: "Senha do SAP bloqueada",
      category: "ACCESS",
      priority: "MEDIUM",
      status: "RESOLVED",
      days: 4,
    },
  ];
  for (const { days, ...example } of examples) {
    expect(
      tickets.find(({ number }) => number === example.number),
    ).toMatchObject({
      ...example,
      lastUpdatedAt: new Date(now.getTime() - days * dayMs),
      employee: { email: "ana.souza@nexo.com.br" },
    });
  }
  expect(new Set(tickets.map(({ employeeId }) => employeeId)).size).toBe(3);
  expect(new Set(tickets.map(({ priority }) => priority)).size).toBe(4);
});

test.each([
  now,
  new Date("2026-11-14T23:00:00-03:00"),
  new Date("2026-11-16T00:01:00-03:00"),
])("mantém cenários vencido, vigente e resolvidos em %s", async (reference) => {
  await seedDatabase(db, reference);
  const find = (number: string) =>
    db.ticket.findUniqueOrThrow({ where: { number } });
  expect(getTicketSla(await find("INC-20312"), reference).isOverdue).toBe(true);
  expect(getTicketSla(await find("REQ-10443"), reference).isOverdue).toBe(
    false,
  );
  expect(getTicketSla(await find("INC-20315"), reference).isOverdue).toBe(true);
  const recent = await find("INC-20313");
  const old = await find("INC-20314");
  expect(reference.getTime() - recent.resolvedAt!.getTime()).toBe(2 * dayMs);
  expect(reference.getTime() - old.resolvedAt!.getTime()).toBe(12 * dayMs);
  expect(getTicketSla(recent, reference).isOverdue).toBe(false);
  for (const ticket of await db.ticket.findMany()) {
    expect(ticket.createdAt.getTime()).toBeLessThanOrEqual(reference.getTime());
    if (ticket.lastUpdatedAt)
      expect(ticket.lastUpdatedAt.getTime()).toBeGreaterThanOrEqual(
        ticket.createdAt.getTime(),
      );
  }
});

test("reexecutar não duplica nem sobrescreve os chamados ou suas datas", async () => {
  await seedDatabase(db, now);
  const original = await db.ticket.findUniqueOrThrow({
    where: { number: "INC-20311" },
  });
  await db.ticket.update({
    where: { id: original.id },
    data: { title: "Título editado", status: "IN_PROGRESS" },
  });
  await seedDatabase(db, new Date(now.getTime() + 10 * dayMs));
  expect(await db.ticket.count()).toBe(9);
  expect(
    await db.ticket.findUnique({ where: { id: original.id } }),
  ).toMatchObject({
    title: "Título editado",
    status: "IN_PROGRESS",
    createdAt: original.createdAt,
    lastUpdatedAt: original.lastUpdatedAt,
  });
});
