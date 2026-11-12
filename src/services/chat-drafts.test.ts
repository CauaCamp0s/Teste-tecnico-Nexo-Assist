import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createTicketFixture,
  content,
  type TicketFixture,
} from "./tickets/test-support";
import { createTicketService } from "./tickets/service";
import { createDraftService } from "./tickets/drafts";
import { createChatDraftService } from "./chat-drafts";
import { TicketUnavailableError } from "./tickets/errors";
import type { DecisionRecord } from "@/agent/decisions";

let f: TicketFixture;
beforeAll(async () => {
  f = await createTicketFixture();
}, 30000);
beforeEach(async () => {
  await f.db.message.deleteMany();
  await f.reset();
});
afterAll(async () => {
  await f?.close();
});
const draft = () =>
  createDraftService(f.db).create(f.ana, {
    conversationId: f.conversationId,
    kind: "CREATE",
    content,
  });
test("confirmação idempotente e resultado real são atômicos", async () => {
  const d = await draft();
  const act = createChatDraftService(f.db);
  const first = await act(f.ana, f.conversationId, d.id, "confirm");
  const second = await act(f.ana, f.conversationId, d.id, "confirm");
  expect(second.id).toBe(first.id);
  expect(first.content).toContain("INC-20316");
  expect(
    (first.decisionRecord as unknown as DecisionRecord).executedActions,
  ).toEqual(["Criou INC-20316."]);
  expect(await f.db.ticket.count()).toBe(10);
  expect(await f.db.message.count()).toBe(1);
});
test("indisponibilidade não confirma falsamente e permite repetir", async () => {
  const d = await draft();
  const fail = createChatDraftService(f.db, (tx) => ({
    ...createTicketService(tx),
    create: async () => {
      throw new TicketUnavailableError(3);
    },
  }));
  const message = await fail(f.ana, f.conversationId, d.id, "confirm");
  expect(
    (message.decisionRecord as unknown as DecisionRecord).executedActions,
  ).toEqual([]);
  expect(message.content).toContain("continua pendente");
  expect(
    (await f.db.ticketDraft.findUniqueOrThrow({ where: { id: d.id } })).status,
  ).toBe("PENDING");
  await createChatDraftService(f.db)(f.ana, f.conversationId, d.id, "confirm");
  expect(await f.db.ticket.count()).toBe(10);
});
test("não confirma rascunho de outro funcionário ou outra conversa; cancelar não escreve chamado", async () => {
  const d = await draft();
  const act = createChatDraftService(f.db);
  await expect(act(f.bruno, f.conversationId, d.id, "confirm")).rejects.toThrow(
    "não encontrado",
  );
  await expect(
    act(f.ana, f.otherConversationId, d.id, "confirm"),
  ).rejects.toThrow("não encontrado");
  await act(f.ana, f.conversationId, d.id, "cancel");
  const result = await act(f.ana, f.conversationId, d.id, "confirm");
  expect(
    (result.decisionRecord as unknown as DecisionRecord).executedActions,
  ).toEqual([]);
  expect(await f.db.ticket.count()).toBe(9);
});
