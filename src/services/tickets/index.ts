import { db } from "@/lib/db";
import { createTicketService } from "./service";
import { createDraftService } from "./drafts";
import { createTemporaryOutage, withTicketResilience } from "./resilience";
import type { TicketDatabase } from "./writes";

export type { EmployeeTicket, TicketListOptions, TicketService } from "./types";
const fault = createTemporaryOutage(process.env.TICKET_SERVICE_OUTAGE_MS);
const ticketFactory = (database: TicketDatabase) =>
  withTicketResilience(createTicketService(database), { fault });
export const ticketService = ticketFactory(db);
export const ticketDraftService = createDraftService(
  db,
  undefined,
  ticketFactory,
);
export type { TicketDraftInput } from "./drafts";
