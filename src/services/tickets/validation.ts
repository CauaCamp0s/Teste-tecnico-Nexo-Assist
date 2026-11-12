import { z } from "zod";
import {
  TicketCategory,
  TicketImpact,
  TicketPriority,
  TicketType,
} from "@prisma/client";
import { TicketError } from "./errors";

export const ticketContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  type: z.enum(TicketType),
  category: z.enum(TicketCategory),
  priority: z.enum(TicketPriority),
  impact: z.enum(TicketImpact),
});

export function parseTicketContent(input: unknown) {
  const result = ticketContentSchema.safeParse(input);
  if (!result.success)
    throw new TicketError(
      "INVALID_INPUT",
      "Preencha todos os dados do chamado com valores válidos.",
    );
  return result.data;
}

export function requireEmployeeId(employeeId: string) {
  if (typeof employeeId !== "string" || !employeeId.trim()) {
    throw new TicketError(
      "INVALID_INPUT",
      "O funcionário é obrigatório para consultar chamados.",
    );
  }
}
