import { Temporal } from "@js-temporal/polyfill";
import type { TicketPriority, TicketSla, TicketSlaSource } from "./types";

export const serviceTimeZone = "America/Sao_Paulo";
const hourMs = 60 * 60 * 1_000;
const businessHours = { HIGH: 4, MEDIUM: 30, LOW: 50 } as const;

function timestamp(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value))
    throw new RangeError("Data inválida para o cálculo do prazo.");
  return value;
}

export function calculateTicketDueAt(
  priority: TicketPriority,
  from: Date,
): Date {
  const start = timestamp(from);
  if (priority === "CRITICAL") return new Date(start + hourMs);

  let remaining = businessHours[priority] * hourMs;
  let cursor =
    Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(
      serviceTimeZone,
    );
  while (remaining > 0) {
    const opening = cursor.withPlainTime("08:00");
    const closing = cursor.withPlainTime("18:00");
    if (
      cursor.dayOfWeek > 5 ||
      cursor.epochMilliseconds >= closing.epochMilliseconds
    ) {
      cursor = cursor.add({ days: 1 }).withPlainTime("08:00");
      continue;
    }
    if (cursor.epochMilliseconds < opening.epochMilliseconds) cursor = opening;
    const available = closing.epochMilliseconds - cursor.epochMilliseconds;
    if (remaining <= available)
      return new Date(cursor.epochMilliseconds + remaining);
    remaining -= available;
    cursor = cursor.add({ days: 1 }).withPlainTime("08:00");
  }
  throw new RangeError("Prioridade inválida para o cálculo do prazo.");
}

export function getTicketSla(ticket: TicketSlaSource, now: Date): TicketSla {
  const current = timestamp(now);
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    return { dueAt: null, isOverdue: false };
  }
  const dueAt = calculateTicketDueAt(
    ticket.priority,
    ticket.lastUpdatedAt ?? ticket.createdAt,
  );
  return { dueAt, isOverdue: current > dueAt.getTime() };
}
