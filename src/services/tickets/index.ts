import { db } from "@/lib/db";
import { createTicketService } from "./service";

export type { EmployeeTicket, TicketListOptions, TicketService } from "./types";
export const ticketService = createTicketService(db);
