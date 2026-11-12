import type { PrismaClient, Ticket } from "@prisma/client";
import { getTicketSla } from "./sla";
import type { EmployeeTicket, TicketService } from "./types";

function requireEmployeeId(employeeId: string) {
  if (typeof employeeId !== "string" || !employeeId.trim()) {
    throw new Error("O funcionário é obrigatório para consultar chamados.");
  }
}

function toEmployeeTicket(ticket: Ticket, now: Date): EmployeeTicket {
  return {
    id: ticket.id,
    number: ticket.number,
    employeeId: ticket.employeeId,
    type: ticket.type,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    impact: ticket.impact,
    title: ticket.title,
    description: ticket.description,
    createdAt: ticket.createdAt,
    lastUpdatedAt: ticket.lastUpdatedAt,
    resolvedAt: ticket.resolvedAt,
    ...getTicketSla(ticket, now),
  };
}

export function createTicketService(
  database: Pick<PrismaClient, "ticket">,
  clock: () => Date = () => new Date(),
): TicketService {
  return {
    async list(employeeId, options = {}) {
      requireEmployeeId(employeeId);
      const tickets = await database.ticket.findMany({
        where: {
          employeeId,
          status: options.statuses ? { in: [...options.statuses] } : undefined,
        },
        orderBy: [{ createdAt: "desc" }, { number: "asc" }],
      });
      const now = clock();
      return tickets.map((ticket) => toEmployeeTicket(ticket, now));
    },
    async get(employeeId, number) {
      requireEmployeeId(employeeId);
      if (typeof number !== "string" || !number.trim()) return null;
      const ticket = await database.ticket.findFirst({
        where: { employeeId, number: number.trim().toUpperCase() },
      });
      return ticket ? toEmployeeTicket(ticket, clock()) : null;
    },
  };
}
