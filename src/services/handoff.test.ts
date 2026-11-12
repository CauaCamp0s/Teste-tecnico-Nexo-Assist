import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createTicketFixture,
  type TicketFixture,
} from "./tickets/test-support";
import { createTicketService } from "./tickets/service";
import { buildDecisionRecord } from "@/agent/decisions";
import { handoffConversation } from "./handoff";

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
test.each([false, true])(
  "encaminha com resumo e informa legado indisponível=%s",
  async (unavailable) => {
    const message = await f.db.message.create({
      data: {
        conversationId: f.conversationId,
        role: "EMPLOYEE",
        content: "Quero um analista para o notebook",
      },
    });
    const record = buildDecisionRecord(
      {
        understanding: { intent: "ti", summary: "Notebook" },
        confidence: "alta",
        reason: "Pedido explícito",
      },
      [],
    );
    const result = await f.db.$transaction((tx) =>
      handoffConversation(
        tx,
        f.ana,
        f.conversationId,
        message.id,
        [message],
        record,
        createTicketService(tx, f.clock),
        "INC-20311",
        unavailable,
      ),
    );
    const c = await f.db.conversation.findUniqueOrThrow({
      where: { id: f.conversationId },
    });
    expect(c.status).toBe("WAITING_FOR_ANALYST");
    expect(c.transferSummary).toContain(message.content);
    expect(c.transferSummary).toContain("INC-20311");
    expect(record.executedActions).toHaveLength(unavailable ? 1 : 2);
    expect(await f.db.ticketOperation.count()).toBe(unavailable ? 0 : 1);
    if (unavailable)
      expect(result).toContain("não consegui transferir o chamado");
  },
);
test("número alheio não transfere nem revela chamado", async () => {
  const record = buildDecisionRecord(
    {
      understanding: { intent: "ti", summary: "Ajuda" },
      confidence: "baixa",
      reason: "Dúvida",
    },
    [],
  );
  await f.db.$transaction((tx) =>
    handoffConversation(
      tx,
      f.ana,
      f.conversationId,
      "source",
      [],
      record,
      createTicketService(tx),
      "INC-20315",
    ),
  );
  expect(await f.db.ticketOperation.count()).toBe(0);
  expect(
    (
      await f.db.conversation.findUniqueOrThrow({
        where: { id: f.conversationId },
      })
    ).transferSummary,
  ).toContain("nenhum chamado próprio");
});
