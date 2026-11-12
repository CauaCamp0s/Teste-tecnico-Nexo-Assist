import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createTicketFixture,
  type TicketFixture,
} from "@/services/tickets/test-support";
import { createTicketService } from "@/services/tickets/service";
import { createEmployeeTicketTools } from "./ticket-tools";
import { buildDecisionRecord, type Consultation } from "./decisions";

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
test("ferramentas isolam identidade e apresentação deriva vencimento dos dados", async () => {
  const queries: Consultation[] = [];
  const tools = createEmployeeTicketTools(
    f.ana,
    createTicketService(f.db, f.clock),
    queries,
    [],
  );
  const record = buildDecisionRecord(
    {
      understanding: { intent: "ti", summary: "Consulta" },
      confidence: "alta",
      reason: "Dados consultados",
    },
    queries,
  );
  await tools.tools.list_tickets.execute!({}, {} as never);
  expect(tools.presentation(record)?.payload.options!.length).toBeGreaterThan(
    1,
  );
  await tools.tools.get_ticket.execute!({ number: "INC-20311" }, {} as never);
  expect(tools.presentation(record)?.payload.tickets?.[0].isOverdue).toBe(true);
  expect(record.decision).toBe("oferecer_transferencia");
  await tools.tools.get_ticket.execute!({ number: "INC-20315" }, {} as never);
  expect(tools.presentation(record)?.payload.tickets).toEqual([]);
  expect(queries.at(-1)?.result.summary).toContain("Nenhum");
});
