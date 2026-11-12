export type TicketErrorCode =
  | "UNAVAILABLE"
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

export class TicketUnavailableError extends TicketError {
  constructor(
    public readonly attempts = 1,
    public readonly mayHaveCommitted = false,
  ) {
    super(
      "UNAVAILABLE",
      "O serviço de chamados está temporariamente indisponível.",
    );
    this.name = "TicketUnavailableError";
  }
}
