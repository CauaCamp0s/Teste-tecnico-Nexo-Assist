import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createTicketFixture,
  type TicketFixture,
} from "./tickets/test-support";
import { createTicketService } from "./tickets/service";
import { createAnalystService } from "./analyst";
import { TicketUnavailableError } from "./tickets/errors";

let f: TicketFixture;
let service: ReturnType<typeof createAnalystService>;
beforeAll(async () => {
  f = await createTicketFixture();
  await f.db.user.createMany({
    data: ["n1", "n2"].map((id) => ({
      id,
      name: id,
      email: `${id}@test.com`,
      role: "ANALYST" as const,
    })),
  });
  service = createAnalystService(f.db, createTicketService(f.db, f.clock));
}, 30000);
beforeEach(async () => {
  await f.db.message.deleteMany();
  await f.reset();
  await f.db.conversation.update({
    where: { id: f.conversationId },
    data: {
      status: "WAITING_FOR_ANALYST",
      transferSummary: "VPN indisponível",
    },
  });
});
afterAll(async () => {
  await f?.close();
});

test("fila e detalhe restritos ao papel; chamados derivam do funcionário da conversa", async () => {
  await expect(service.list(f.ana)).rejects.toThrow("restrito");
  await expect(service.detail(f.ana, f.conversationId)).rejects.toThrow(
    "restrito",
  );
  expect(await service.list("n1", "WAITING_FOR_ANALYST")).toHaveLength(1);
  const detail = await service.detail("n1", f.conversationId);
  expect(detail.transferSummary).toBe("VPN indisponível");
  expect(detail.tickets.every((t) => t.employeeId === f.ana)).toBe(true);
});
test("assunção concorrente tem um vencedor e só o responsável responde e devolve", async () => {
  const results = await Promise.allSettled([
    service.act("n1", f.conversationId, "assume"),
    service.act("n2", f.conversationId, "assume"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const c = await f.db.conversation.findUniqueOrThrow({
    where: { id: f.conversationId },
  });
  const owner = c.analystId!;
  await expect(
    service.act(owner === "n1" ? "n2" : "n1", c.id, "reply", "Oi"),
  ).rejects.toThrow("Assuma");
  await expect(service.act(owner, c.id, "reply", "  ")).rejects.toThrow();
  expect(
    await service.act(owner, c.id, "reply", "Vou verificar"),
  ).toMatchObject({
    authorId: owner,
    role: "ANALYST",
    content: "Vou verificar",
  });
  await service.act(owner, c.id, "return");
  expect(
    await f.db.conversation.findUnique({ where: { id: c.id } }),
  ).toMatchObject({ status: "AGENT", analystId: null });
  await expect(service.act(owner, c.id, "reply", "Oi")).rejects.toThrow(
    "Assuma",
  );
});
test("encerra atendimento assumido preservando histórico", async () => {
  await expect(service.act("n1", f.conversationId, "close")).rejects.toThrow(
    "Assuma",
  );
  await service.act("n1", f.conversationId, "assume");
  await service.act("n1", f.conversationId, "close");
  const detail = await service.detail("n1", f.conversationId);
  expect(detail.status).toBe("CLOSED");
  expect(detail.messages).toHaveLength(2);
});

test("indisponibilidade dos chamados preserva histórico e controles do analista", async () => {
  const unavailable = createAnalystService(f.db, {
    ...createTicketService(f.db),
    list: async () => {
      throw new TicketUnavailableError(3);
    },
  });
  const detail = await unavailable.detail("n1", f.conversationId);
  expect(detail.ticketsUnavailable).toBe(true);
  expect(detail.transferSummary).toBe("VPN indisponível");
  expect(detail.tickets).toEqual([]);
  await unavailable.assume("n1", f.conversationId);
  await unavailable.reply(
    "n1",
    f.conversationId,
    "Já li o histórico e vou ajudar.",
  );
  expect(
    (await unavailable.detail("n1", f.conversationId)).messages,
  ).toHaveLength(2);
});

test("contagens incluem todos os status e acompanham assumir e encerrar", async () => {
  const analyst = createAnalystService(f.db, createTicketService(f.db));
  const initial = await analyst.counts("n1");
  expect(initial.ALL).toBe(await f.db.conversation.count());
  expect(initial.WAITING_FOR_ANALYST).toBe(1);
  expect(initial.ANALYST).toBe(0);
  await analyst.assume("n1", f.conversationId);
  expect(await analyst.counts("n1")).toMatchObject({
    ALL: initial.ALL,
    WAITING_FOR_ANALYST: 0,
    ANALYST: 1,
  });
  await analyst.close("n1", f.conversationId);
  expect(await analyst.counts("n1")).toMatchObject({
    ALL: initial.ALL,
    ANALYST: 0,
    CLOSED: initial.CLOSED + 1,
  });
  await expect(analyst.counts(f.ana)).rejects.toThrow("Acesso restrito");
});
