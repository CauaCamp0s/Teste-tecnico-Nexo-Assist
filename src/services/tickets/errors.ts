export type TicketErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "REOPEN_NOT_ALLOWED";

export class TicketError extends Error {
  constructor(
    public readonly code: TicketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TicketError";
  }
}
