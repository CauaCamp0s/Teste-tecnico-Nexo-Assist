import type { Message } from "@prisma/client";
import type { ChatPayload } from "@/services/chat-payload";
import type { DecisionRecord } from "./decisions";

// Candidatos, consultas automáticas e rascunhos não estabelecem um alvo.
// Só a referência do funcionário ou a confirmação de uma escrita nesta conversa.
export function establishedTicketNumbers(
  messages: Pick<Message, "role" | "content" | "payload" | "decisionRecord">[],
): ReadonlySet<string> {
  const numbers = new Set<string>();
  for (const message of messages) {
    if (message.role === "EMPLOYEE") {
      for (const match of message.content.matchAll(/\b(?:INC|REQ)-\d+\b/gi))
        numbers.add(match[0].toUpperCase());
      continue;
    }
    const record = message.decisionRecord as DecisionRecord | null;
    if (message.role !== "AGENT" || record?.decision !== "confirmar_alteracao")
      continue;
    const cards = (message.payload as ChatPayload | null)?.tickets ?? [];
    for (const ticket of cards) {
      if (
        record.executedActions.some((action) =>
          ["Criou", "Atualizou", "Reabriu"].some(
            (verb) => action === `${verb} ${ticket.number}.`,
          ),
        )
      )
        numbers.add(ticket.number);
    }
  }
  return numbers;
}
