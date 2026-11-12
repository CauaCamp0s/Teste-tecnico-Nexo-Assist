import type { Ticket } from "@prisma/client";
import { getTicketSla } from "./sla";
import type { EmployeeTicket, TicketService, TicketContent } from "./types";
import { parseTicketContent, requireEmployeeId } from "./validation";
import { ownedTicket, writeTicket, type TicketDatabase } from "./writes";
import { TicketError } from "./errors";
import { assertCanReopen, reopenWindowMs } from "./reopening";

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
    transferSummary: ticket.transferSummary,
    ...getTicketSla(ticket, now),
  };
}

export function createTicketService(
  database: TicketDatabase,
  clock: () => Date = () => new Date(),
): TicketService {
  async function change(
    employeeId: string,
    number: string,
    input: TicketContent,
    idempotencyKey: string,
    kind: "UPDATE" | "REOPEN",
  ) {
    requireEmployeeId(employeeId);
    const content = parseTicketContent(input);
    const target = number.trim().toUpperCase();
    const now = clock();
    const result = await writeTicket(
      database,
      employeeId,
      idempotencyKey,
      kind,
      { number: target, content },
      now,
      async (tx) => {
        const ticket = await ownedTicket(tx, employeeId, target);
        if (ticket.type !== content.type)
          throw new TicketError(
            "INVALID_INPUT",
            "O tipo do chamado existente não pode ser alterado.",
          );
        if (kind === "REOPEN") {
          assertCanReopen(ticket, now);
        } else if (["RESOLVED", "CLOSED"].includes(ticket.status)) {
          throw new TicketError(
            "INVALID_STATE",
            "Somente chamados abertos podem receber complementos.",
          );
        }
        await tx.ticket.updateMany({
          where: { id: ticket.id, employeeId },
          data: {
            ...content,
            description: `${ticket.description}\n\n${kind === "REOPEN" ? "Reabertura" : "Atualização"}:\n${content.description}`,
            lastUpdatedAt: now,
            ...(kind === "REOPEN"
              ? { status: "OPEN" as const, resolvedAt: null }
              : {}),
          },
        });
        return ownedTicket(tx, employeeId, target);
      },
    );
    return toEmployeeTicket(result, now);
  }
  return {
    async transfer(employeeId, number, summary, idempotencyKey) {
      requireEmployeeId(employeeId);
      if (
        typeof summary !== "string" ||
        !summary.trim() ||
        summary.trim().length > 10_000 ||
        typeof number !== "string" ||
        !number.trim()
      ) {
        throw new TicketError(
          "INVALID_INPUT",
          "Informe o chamado e um resumo de até 10000 caracteres.",
        );
      }
      const target = number.trim().toUpperCase();
      const transferSummary = summary.trim();
      const now = clock();
      const result = await writeTicket(
        database,
        employeeId,
        idempotencyKey,
        "TRANSFER",
        { number: target, transferSummary },
        now,
        async (tx) => {
          const ticket = await ownedTicket(tx, employeeId, target);
          if (["RESOLVED", "CLOSED"].includes(ticket.status))
            throw new TicketError(
              "INVALID_STATE",
              "Somente chamados ativos podem ser transferidos.",
            );
          await tx.ticket.updateMany({
            where: { id: ticket.id, employeeId },
            data: {
              status: "WAITING_FOR_ANALYST",
              transferSummary,
              lastUpdatedAt: now,
            },
          });
          return ownedTicket(tx, employeeId, target);
        },
      );
      return toEmployeeTicket(result, now);
    },
    async findDuplicateCandidates(employeeId) {
      requireEmployeeId(employeeId);
      const now = clock();
      const tickets = await database.ticket.findMany({
        where: {
          employeeId,
          OR: [
            { status: { notIn: ["RESOLVED", "CLOSED"] } },
            {
              status: "RESOLVED",
              resolvedAt: {
                gte: new Date(now.getTime() - reopenWindowMs),
                lte: now,
              },
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { number: "asc" }],
      });
      return tickets.map((ticket) => toEmployeeTicket(ticket, now));
    },
    async create(employeeId, input, idempotencyKey) {
      requireEmployeeId(employeeId);
      const content = parseTicketContent(input);
      const now = clock();
      const result = await writeTicket(
        database,
        employeeId,
        idempotencyKey,
        "CREATE",
        content,
        now,
        async (tx) => {
          const sequence = await tx.ticketSequence.upsert({
            where: { type: content.type },
            create: { type: content.type, value: 100_001 },
            update: { value: { increment: 1 } },
          });
          return tx.ticket.create({
            data: {
              ...content,
              employeeId,
              number: `${content.type}-${sequence.value}`,
              createdAt: now,
            },
          });
        },
      );
      return toEmployeeTicket(result, now);
    },
    addUpdate: (employeeId, number, content, key) =>
      change(employeeId, number, content, key, "UPDATE"),
    reopen: (employeeId, number, content, key) =>
      change(employeeId, number, content, key, "REOPEN"),
    async list(employeeId, options = {}) {
      requireEmployeeId(employeeId);
      if (
        options.subject !== undefined &&
        (typeof options.subject !== "string" || options.subject.length > 200)
      )
        throw new TicketError(
          "INVALID_INPUT",
          "Informe um assunto com até 200 caracteres.",
        );
      const subject = options.subject?.trim();
      const tickets = await database.ticket.findMany({
        where: {
          employeeId,
          status: options.statuses ? { in: [...options.statuses] } : undefined,
          ...(subject
            ? {
                OR: [
                  { title: { contains: subject } },
                  { description: { contains: subject } },
                ],
              }
            : {}),
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
