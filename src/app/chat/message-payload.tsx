import {
  categoryLabels,
  impactLabels,
  priorityLabels,
  statusLabels,
  type ChatPayload,
} from "@/services/chat-payload";
import styles from "./chat.module.css";
import { formatDate } from "@/lib/presentation";

export function MessagePayload({
  payload,
  onOption,
  disabled,
  onDraft,
  limitReached,
}: {
  payload: ChatPayload;
  onOption: (text: string) => void;
  disabled: boolean;
  limitReached?: boolean;
  onDraft?: (id: string, action: "confirm" | "cancel") => void;
}) {
  return (
    <div className={styles.payload}>
      {payload.tickets?.map((ticket) => (
        <section className={styles.ticketCard} key={ticket.id}>
          <header>
            <strong>{ticket.number}</strong>
            <span>{statusLabels[ticket.status]}</span>
          </header>
          <h3>{ticket.title}</h3>
          <p>{ticket.description}</p>
          <dl>
            <dt>Categoria</dt>
            <dd>{categoryLabels[ticket.category]}</dd>
            <dt>Prioridade</dt>
            <dd>{priorityLabels[ticket.priority]}</dd>
            <dt>Aberto em</dt>
            <dd>{formatDate(ticket.createdAt)}</dd>
            <dt>Última atualização</dt>
            <dd>
              {ticket.lastUpdatedAt
                ? formatDate(ticket.lastUpdatedAt)
                : "Sem atualização"}
            </dd>
            <dt>Prazo</dt>
            <dd>
              {ticket.dueAt ? formatDate(ticket.dueAt) : "Sem prazo pendente"}{" "}
              {ticket.isOverdue && (
                <strong className={styles.overdue}>· prazo vencido</strong>
              )}
            </dd>
          </dl>
        </section>
      ))}
      {payload.draft && (
        <section className={styles.ticketCard}>
          <header>
            <strong>
              Rascunho ·{" "}
              {payload.draft.kind === "CREATE"
                ? "Novo chamado"
                : payload.draft.kind === "UPDATE"
                  ? "Atualização"
                  : "Reabertura"}
            </strong>
            <span>
              {payload.draft.status === "PENDING"
                ? "Aguardando confirmação"
                : payload.draft.status === "CONFIRMED"
                  ? "Confirmado"
                  : payload.draft.status === "CANCELED"
                    ? "Cancelado"
                    : "Falhou"}
            </span>
          </header>
          <h3>{payload.draft.title}</h3>
          <p>{payload.draft.description}</p>
          <dl>
            <dt>Tipo</dt>
            <dd>{payload.draft.type === "INC" ? "Incidente" : "Requisição"}</dd>
            <dt>Categoria</dt>
            <dd>{categoryLabels[payload.draft.category]}</dd>
            <dt>Prioridade</dt>
            <dd>{priorityLabels[payload.draft.priority]}</dd>
            <dt>Afetados</dt>
            <dd>{impactLabels[payload.draft.impact]}</dd>
            <dt>Previsão de prazo</dt>
            <dd>
              {payload.draft.dueAt
                ? formatDate(payload.draft.dueAt)
                : "Calculado na confirmação"}
            </dd>
          </dl>
          {payload.draft.status === "PENDING" && onDraft && (
            <div className={styles.quickOptions}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDraft(payload.draft!.id, "confirm")}
              >
                {payload.draft.failureCode === "UNAVAILABLE"
                  ? "Tentar novamente"
                  : "Confirmar"}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDraft(payload.draft!.id, "cancel")}
              >
                Cancelar
              </button>
            </div>
          )}
        </section>
      )}
      {!!payload.options?.length && (
        <div className={styles.quickOptions}>
          {payload.options.map((option) => (
            <button
              type="button"
              key={option.value}
              onClick={() => onOption(option.value)}
              disabled={disabled || limitReached}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
