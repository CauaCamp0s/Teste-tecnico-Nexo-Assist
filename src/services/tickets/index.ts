import { db } from "@/lib/db";
import { createTicketService } from "./service";
import { createDraftService } from "./drafts";

export type { EmployeeTicket, TicketListOptions, TicketService } from "./types";
export const ticketService = createTicketService(db);
export const ticketDraftService = createDraftService(db);
export type { TicketDraftInput } from "./drafts";
