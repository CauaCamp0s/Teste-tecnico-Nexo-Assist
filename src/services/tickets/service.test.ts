import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { seedDatabase } from "../../../prisma/seed-data";
import { createTicketService } from "./service";
import type { TicketListOptions, TicketService } from "./types";

let directory: string;
let db: PrismaClient;
let service: TicketService;
let ana: string;
let bruno: string;
let carla: string;
const seededAt = new Date("2026-11-12T14:00:00-03:00");
let currentTime: Date;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-ticket-service-"));
  const databaseUrl = `file:${join(directory, "tickets.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  await seedDatabase(db, seededAt);
  const users = await db.user.findMany();
  ana = users.find(({ email }) => email === "ana.souza@nexo.com.br")!.id;
  bruno = users.find(({ email }) => email === "bruno.tavares@nexo.com.br")!.id;
  carla = users.find(({ email }) => email === "carla.mendes@nexo.com.br")!.id;
  service = createTicketService(db, () => currentTime);
}, 30_000);

beforeEach(async () => {
  currentTime = new Date(seededAt);
  await db.ticket.deleteMany();
  await seedDatabase(db, seededAt);
});

afterAll(async () => {
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("lista somente chamados do funcionário, inclusive resolvidos", async () => {
  const tickets = await service.list(ana);
  expect(tickets).toHaveLength(7);
  expect(tickets.every(({ employeeId }) => employeeId === ana)).toBe(true);
  expect(tickets.map(({ number }) => number)).not.toContain("INC-20315");
  expect(tickets.map(({ number }) => number)).not.toContain("REQ-10444");
  expect(
    tickets.some(
      ({ number, status }) => number === "INC-20150" && status === "RESOLVED",
    ),
  ).toBe(true);
  expect((await service.list(bruno)).map(({ number }) => number)).toEqual([
    "INC-20315",
  ]);
  expect((await service.list(carla)).map(({ number }) => number)).toEqual([
    "REQ-10444",
  ]);
});

test("filtro por status mantém o isolamento e lista vazia não amplia a busca", async () => {
  const options = { statuses: ["OPEN", "IN_PROGRESS"] as const };
  expect(
    (await service.list(ana, options)).map(({ number }) => number),
  ).toEqual(["REQ-10443", "INC-20312"]);
  expect(
    (await service.list(bruno, options)).map(({ number }) => number),
  ).toEqual(["INC-20315"]);
  expect(
    (await service.list(carla, options)).map(({ number }) => number),
  ).toEqual(["REQ-10444"]);
  expect(await service.list(ana, { statuses: [] })).toEqual([]);
  const untrusted = { employeeId: bruno } as TicketListOptions;
  expect(
    (await service.list(ana, untrusted)).every(
      ({ employeeId }) => employeeId === ana,
    ),
  ).toBe(true);
});

test("consulta por número exige propriedade e não distingue alheio de inexistente", async () => {
  const own = await service.get(ana, " inc-20311 ");
  expect(own).toMatchObject({
    employeeId: ana,
    number: "INC-20311",
    category: "HARDWARE",
    priority: "MEDIUM",
    status: "WAITING_FOR_ANALYST",
  });
  expect(own?.description).toContain("Lentidão");
  for (const number of [
    "INC-20315",
    "REQ-10444",
    "INC-999999",
    "INC-20315' OR 1=1",
  ]) {
    expect(await service.get(ana, number)).toBeNull();
  }
  expect(await service.get(bruno, "INC-20311")).toBeNull();
  expect(await service.get(carla, "INC-20150")).toBeNull();
});

test("funcionário sem chamados recebe lista vazia e nenhuma informação de outro", async () => {
  const user = await db.user.upsert({
    where: { email: "sem-chamados@nexo.com.br" },
    create: { name: "Sem chamados", email: "sem-chamados@nexo.com.br" },
    update: {},
  });
  expect(await service.list(user.id)).toEqual([]);
  expect(await service.get(user.id, "INC-20311")).toBeNull();
});

test.each(["", " ", undefined, null])(
  "não permite consulta sem employeeId: %s",
  async (id) => {
    await expect(service.list(id as string)).rejects.toThrow(
      "funcionário é obrigatório",
    );
    await expect(service.get(id as string, "INC-20311")).rejects.toThrow(
      "funcionário é obrigatório",
    );
  },
);

test("retorna indicação de vencido e prazo, sem marcar resolvidos como atrasados", async () => {
  expect(await service.get(ana, "INC-20312")).toMatchObject({
    isOverdue: true,
    dueAt: expect.any(Date),
  });
  expect(await service.get(ana, "REQ-10443")).toMatchObject({
    isOverdue: false,
    dueAt: expect.any(Date),
    lastUpdatedAt: null,
  });
  expect(await service.get(bruno, "INC-20315")).toMatchObject({
    isOverdue: true,
    dueAt: new Date(seededAt.getTime() - 60 * 60 * 1_000),
  });
  for (const number of ["INC-20150", "INC-20313", "INC-20314"]) {
    expect(await service.get(ana, number)).toMatchObject({
      isOverdue: false,
      dueAt: null,
      resolvedAt: expect.any(Date),
    });
  }
});

test("calcula o atraso na leitura e somente após o instante limite", async () => {
  const ticket = await service.get(ana, "REQ-10443");
  currentTime = ticket!.dueAt!;
  expect((await service.get(ana, "REQ-10443"))?.isOverdue).toBe(false);
  currentTime = new Date(currentTime.getTime() + 1);
  expect((await service.get(ana, "REQ-10443"))?.isOverdue).toBe(true);
  expect(
    (await service.list(ana)).find(({ number }) => number === "REQ-10443")
      ?.isOverdue,
  ).toBe(true);
});

test("última atualização redefine o prazo e as consultas não alteram os dados", async () => {
  await db.ticket.update({
    where: { number: "INC-20312" },
    data: { lastUpdatedAt: seededAt },
  });
  const before = await db.ticket.findMany({ orderBy: { number: "asc" } });
  expect(await service.get(ana, "INC-20312")).toMatchObject({
    dueAt: new Date("2026-11-12T18:00:00-03:00"),
    isOverdue: false,
  });
  await service.list(ana);
  expect(await db.ticket.findMany({ orderBy: { number: "asc" } })).toEqual(
    before,
  );
});

test("status encerrado elimina prazo pendente e dados sobrevivem à reconexão", async () => {
  await db.ticket.update({
    where: { number: "INC-20312" },
    data: { status: "CLOSED" },
  });
  await db.$disconnect();
  expect(await service.get(ana, "INC-20312")).toMatchObject({
    status: "CLOSED",
    isOverdue: false,
    dueAt: null,
  });
  expect(await service.get(bruno, "INC-20312")).toBeNull();
});
