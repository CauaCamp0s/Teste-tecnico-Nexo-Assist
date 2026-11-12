import { createHash } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  Ticket,
  TicketOperationKind,
} from "@prisma/client";
import { TicketError } from "./errors";
import { requireEmployeeId } from "./validation";

export type TicketDatabase = PrismaClient | Prisma.TransactionClient;

export async function writeTicket(
  database: TicketDatabase,
  employeeId: string,
  idempotencyKey: string,
  kind: TicketOperationKind,
  payload: unknown,
  now: Date,
  mutate: (tx: Prisma.TransactionClient) => Promise<Ticket>,
): Promise<Ticket> {
  requireEmployeeId(employeeId);
  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.trim() ||
    idempotencyKey.length > 200
  ) {
    throw new TicketError(
      "INVALID_INPUT",
      "Informe uma chave de idempotência válida.",
    );
  }
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ kind, payload }))
    .digest("hex");
  const execute = async (tx: Prisma.TransactionClient) => {
    const previous = await tx.ticketOperation.findUnique({
      where: { employeeId_idempotencyKey: { employeeId, idempotencyKey } },
    });
    if (previous) {
      if (previous.kind !== kind || previous.payloadHash !== payloadHash) {
        throw new TicketError(
          "IDEMPOTENCY_CONFLICT",
          "Esta chave já foi usada para outra alteração.",
        );
      }
      const ticket = await tx.ticket.findFirst({
        where: { id: previous.ticketId, employeeId },
      });
      if (!ticket)
        throw new TicketError("NOT_FOUND", "Chamado não encontrado.");
      return ticket;
    }
    const ticket = await mutate(tx);
    await tx.ticketOperation.create({
      data: {
        employeeId,
        idempotencyKey,
        kind,
        payloadHash,
        ticketId: ticket.id,
        createdAt: now,
      },
    });
    return ticket;
  };
  return "$transaction" in database
    ? database.$transaction(execute)
    : execute(database);
}

export async function ownedTicket(
  tx: Prisma.TransactionClient,
  employeeId: string,
  number: string,
) {
  const ticket = await tx.ticket.findFirst({ where: { employeeId, number } });
  if (!ticket) throw new TicketError("NOT_FOUND", "Chamado não encontrado.");
  return ticket;
}
