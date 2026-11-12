import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createDraftService } from "./drafts";
import { createTicketService } from "./service";
import { TicketError } from "./errors";
import {
  content,
  createTicketFixture,
  type TicketFixture,
} from "./test-support";

let f: TicketFixture;
let drafts: ReturnType<typeof createDraftService>;
beforeAll(async () => {
  f = await createTicketFixture();
}, 30_000);
beforeEach(async () => {
  await f.reset();
  drafts = createDraftService(f.db, f.clock);
});
afterAll(async () => {
  await f?.close();
});
const create = () =>
  drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "CREATE",
    content,
  });

test("rascunho completo persiste sem executar a alteração", async () => {
  const draft = await create();
  await f.db.$disconnect();
  expect(await drafts.get(f.ana, draft.id)).toMatchObject({
    ...content,
    employeeId: f.ana,
    conversationId: f.conversationId,
    kind: "CREATE",
    status: "PENDING",
    targetTicketId: null,
  });
  expect(await f.db.ticket.count()).toBe(9);
  expect(await f.db.ticketOperation.count()).toBe(0);
});

test("confirmar novamente após reconexão não duplica chamado e usa id do rascunho", async () => {
  const draft = await create();
  const first = await drafts.confirm(f.ana, draft.id);
  await f.db.$disconnect();
  const second = await drafts.confirm(f.ana, draft.id);
  expect(second.ticket.id).toBe(first.ticket.id);
  expect(second.draft).toMatchObject({
    status: "CONFIRMED",
    resultTicketId: first.ticket.id,
  });
  expect(first.ticket.number).toBe("INC-20316");
  expect(await f.db.ticket.count()).toBe(10);
  expect(await f.db.ticketOperation.findFirst()).toMatchObject({
    idempotencyKey: draft.id,
    kind: "CREATE",
    employeeId: f.ana,
  });
});

test("duas confirmações concorrentes não criam dois chamados", async () => {
  const draft = await create();
  const results = await Promise.all([
    drafts.confirm(f.ana, draft.id),
    drafts.confirm(f.ana, draft.id),
  ]);
  expect(results[0].ticket.id).toBe(results[1].ticket.id);
  expect(await f.db.ticket.count()).toBe(10);
});

test("numeração continua o máximo por tipo sob criação concorrente e após importação", async () => {
  const service = createTicketService(f.db, f.clock);
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      service.create(f.ana, content, `concurrent-${index}`),
    ),
  );
  expect(results.map((ticket) => ticket.number).sort()).toEqual([
    "INC-20316",
    "INC-20317",
    "INC-20318",
    "INC-20319",
  ]);
  expect(
    (await service.create(f.ana, { ...content, type: "REQ" }, "request"))
      .number,
  ).toBe("REQ-10445");
  await f.db.ticket.update({
    where: { id: results[0].id },
    data: { number: "INC-99999" },
  });
  expect((await service.create(f.ana, content, "after-import")).number).toBe(
    "INC-100000",
  );
  expect((await service.create(f.ana, content, "after-import")).number).toBe(
    "INC-100000",
  );
  expect(
    (await service.create(f.ana, content, "after-width-change")).number,
  ).toBe("INC-100001");
});

test("cancelar é idempotente e bloqueia confirmação", async () => {
  const draft = await create();
  expect((await drafts.cancel(f.ana, draft.id)).status).toBe("CANCELED");
  expect((await drafts.cancel(f.ana, draft.id)).status).toBe("CANCELED");
  await expect(drafts.confirm(f.ana, draft.id)).rejects.toMatchObject({
    code: "INVALID_STATE",
  });
  expect(await f.db.ticket.count()).toBe(9);
});

test("complemento preserva descrição e reinicia prazo uma única vez", async () => {
  const original = await f.db.ticket.findUniqueOrThrow({
    where: { number: "INC-20312" },
  });
  const draft = await drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "UPDATE",
    targetNumber: original.number,
    content,
  });
  const result = await drafts.confirm(f.ana, draft.id);
  expect(result.ticket.description).toBe(
    `${original.description}\n\nAtualização:\n${content.description}`,
  );
  expect(result.ticket.lastUpdatedAt).toEqual(f.clock());
  expect(result.ticket.dueAt).toEqual(new Date("2026-11-12T18:00:00-03:00"));
  f.setNow(new Date("2026-11-13T10:00:00-03:00"));
  const again = await drafts.confirm(f.ana, draft.id);
  expect(again.ticket.lastUpdatedAt).toEqual(result.ticket.lastUpdatedAt);
  expect(again.ticket.description).toBe(result.ticket.description);
});

test("confirma reabertura resolvida, limpa resolução e renova prazo", async () => {
  const draft = await drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "REOPEN",
    targetNumber: "INC-20150",
    content,
  });
  const result = await drafts.confirm(f.ana, draft.id);
  expect(result.ticket).toMatchObject({
    status: "OPEN",
    resolvedAt: null,
    lastUpdatedAt: f.clock(),
  });
  expect((await drafts.confirm(f.ana, draft.id)).ticket.id).toBe(
    result.ticket.id,
  );
});

test("isola conversa, alvo, leitura, confirmação e cancelamento pelo funcionário", async () => {
  await expect(
    drafts.create(f.ana, {
      conversationId: f.otherConversationId,
      kind: "CREATE",
      content,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    drafts.create(f.ana, {
      conversationId: f.conversationId,
      kind: "UPDATE",
      targetNumber: "INC-20315",
      content,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const draft = await create();
  for (const action of [drafts.get, drafts.confirm, drafts.cancel]) {
    await expect(action(f.bruno, draft.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }
  expect((await drafts.get(f.ana, draft.id)).status).toBe("PENDING");
});

test("revalida propriedade do alvo na confirmação e marca falha sem alteração", async () => {
  const draft = await drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "UPDATE",
    targetNumber: "INC-20312",
    content,
  });
  await f.db.ticket.update({
    where: { number: "INC-20312" },
    data: { employeeId: f.bruno },
  });
  await expect(drafts.confirm(f.ana, draft.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await drafts.get(f.ana, draft.id)).status).toBe("FAILED");
  expect(await f.db.ticketOperation.count()).toBe(0);
});

test("falha após a escrita desfaz operação e registra rascunho falhou", async () => {
  const draft = await create();
  const failing = createDraftService(f.db, f.clock, (tx) => {
    const service = createTicketService(tx, f.clock);
    return {
      ...service,
      create: async (...args) => {
        await service.create(...args);
        throw new TicketError("INVALID_STATE", "Falha simulada");
      },
    };
  });
  await expect(failing.confirm(f.ana, draft.id)).rejects.toThrow(
    "Falha simulada",
  );
  expect(await drafts.get(f.ana, draft.id)).toMatchObject({
    status: "FAILED",
    failureCode: "INVALID_STATE",
  });
  expect(await f.db.ticket.count()).toBe(9);
  expect(await f.db.ticketOperation.count()).toBe(0);
  await expect(drafts.confirm(f.ana, draft.id)).rejects.toMatchObject({
    code: "INVALID_STATE",
  });
});

test("serviço rejeita reutilização da chave com outro conteúdo e escritas alheias", async () => {
  const service = createTicketService(f.db, f.clock);
  await service.create(f.ana, content, "key");
  await expect(
    service.create(f.ana, { ...content, title: "Outro" }, "key"),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.addUpdate(f.bruno, "INC-20312", content, "update"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.reopen(f.bruno, "INC-20150", content, "reopen"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await f.db.ticket.count()).toBe(10);
});

test("rascunho incompleto ou alvo ausente não é persistido", async () => {
  await expect(
    drafts.create(f.ana, {
      conversationId: f.conversationId,
      kind: "CREATE",
      content: { ...content, title: " " },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    drafts.create(f.ana, {
      conversationId: f.conversationId,
      kind: "UPDATE",
      content,
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(await f.db.ticketDraft.count()).toBe(0);
});
