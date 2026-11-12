import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createTicketFixture,
  type TicketFixture,
} from "@/services/tickets/test-support";
import { createTicketService } from "@/services/tickets/service";
import { createDraftFlow } from "./draft-flow";
import { buildDecisionRecord } from "./decisions";
import type { TicketProposal } from "./proposal";

let f: TicketFixture;
beforeAll(async () => {
  f = await createTicketFixture();
}, 30000);
beforeEach(async () => {
  await f.reset();
});
afterAll(async () => {
  await f?.close();
});
const proposal: TicketProposal = {
  title: "VPN falha",
  description: "Erro 809 no Windows 11",
  type: "INC",
  category: "NETWORK_VPN",
  impact: "SELF",
  interruption: "stopped",
  sameDayCommitment: true,
  duplicate: { relation: "different", number: null },
};
function setup() {
  const record = buildDecisionRecord(
    {
      understanding: { intent: "ti", summary: "VPN falha" },
      confidence: "alta",
      reason: "Dados completos",
    },
    [],
  );
  return {
    record,
    flow: createDraftFlow(
      f.ana,
      f.conversationId,
      createTicketService(f.db, f.clock),
      record.consultations,
      [],
      f.clock,
    ),
  };
}
test("coleta um campo por vez com opções e não cria chamado", async () => {
  const { record, flow } = setup();
  const result = await flow.prepare(
    { ...proposal, impact: null, interruption: null },
    record,
  );
  expect(result.content).toBe("Quem está sendo afetado?");
  expect(result.payload.options).toHaveLength(4);
  expect(await f.db.ticketDraft.count()).toBe(0);
});
test("sem comparação observada, pede seleção; prioridade vem do código", async () => {
  const { record, flow } = setup();
  const result = await flow.prepare(proposal, record);
  expect(result.content).toContain("mesmo problema");
  expect(record.appliedRules.join(" ")).toContain("Prioridade HIGH");
  expect(record.consultations[0].tool).toBe("find_duplicate_candidates");
});
test.each([null, "INC-20312", "INC-20150"])(
  "persiste operação correta para candidato %s",
  async (number) => {
    const { record, flow } = setup();
    await flow.tool.execute!({}, {} as never);
    const result = await flow.prepare(
      {
        ...proposal,
        duplicate: { relation: number ? "same" : "different", number },
      },
      record,
    );
    if (!("persist" in result) || !result.persist)
      throw new Error("Rascunho esperado");
    const payload = await f.db.$transaction(result.persist);
    expect(payload.draft).toMatchObject({
      kind:
        number === null
          ? "CREATE"
          : number === "INC-20150"
            ? "REOPEN"
            : "UPDATE",
      priority: "HIGH",
      status: "PENDING",
    });
    expect(await f.db.ticket.count()).toBe(9);
    expect(await f.db.ticketOperation.count()).toBe(0);
  },
);
