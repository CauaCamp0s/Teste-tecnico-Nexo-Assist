export type TicketErrorCode =
  "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE" | "IDEMPOTENCY_CONFLICT";

export class TicketError extends Error {
  constructor(
    public readonly code: TicketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TicketError";
  }
}
