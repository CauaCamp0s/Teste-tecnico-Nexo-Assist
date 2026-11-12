import type { TicketCard } from "@/services/chat-payload";
import { priorityLabels, statusLabels } from "@/services/chat-payload";
import { formatDate } from "@/lib/presentation";
import { MessagePayload } from "@/app/chat/message-payload";
import styles from "./console.module.css";

export function TicketPanel({
  tickets,
  relatedNumbers,
}: {
  tickets: TicketCard[];
  relatedNumbers: string[];
}) {
  const related = tickets.filter((ticket) =>
    relatedNumbers.includes(ticket.number),
  );
  const others = tickets.filter(
    (ticket) => !relatedNumbers.includes(ticket.number),
  );
  return (
    <>
      {!!related.length && (
        <>
          <h3>Desta conversa</h3>
          <MessagePayload
            payload={{ tickets: related }}
            disabled
            onOption={() => {}}
          />
        </>
      )}
      {!!others.length && <h3>Outros chamados</h3>}
      {others.map((ticket) => (
        <details key={ticket.id} className={styles.compactTicket}>
          <summary>
            <strong>{ticket.title}</strong>
            <span>
              {ticket.number} · {statusLabels[ticket.status]} ·{" "}
              {priorityLabels[ticket.priority]}
            </span>
            <small data-overdue={ticket.isOverdue}>
              {ticket.dueAt
                ? `Prazo: ${formatDate(ticket.dueAt)}${ticket.isOverdue ? " · vencido" : ""}`
                : "Sem prazo pendente"}
            </small>
          </summary>
          <MessagePayload
            payload={{ tickets: [ticket] }}
            disabled
            onOption={() => {}}
          />
        </details>
      ))}
    </>
  );
}
