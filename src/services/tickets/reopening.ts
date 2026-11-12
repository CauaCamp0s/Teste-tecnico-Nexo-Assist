import type { Ticket } from "@prisma/client";
import { TicketError } from "./errors";

export const reopenWindowMs = 7 * 24 * 60 * 60 * 1_000;

export function assertCanReopen(
  ticket: Pick<Ticket, "status" | "resolvedAt">,
  now: Date,
) {
  if (ticket.status !== "RESOLVED") {
    throw new TicketError(
      "INVALID_STATE",
      "Somente chamados resolvidos podem ser reabertos.",
    );
  }
  const age = ticket.resolvedAt
    ? now.getTime() - ticket.resolvedAt.getTime()
    : NaN;
  if (!Number.isFinite(age) || age < 0 || age > reopenWindowMs) {
    throw new TicketError(
      "REOPEN_NOT_ALLOWED",
      "A reabertura exige uma resolução registrada há no máximo 7 dias corridos.",
    );
  }
}
