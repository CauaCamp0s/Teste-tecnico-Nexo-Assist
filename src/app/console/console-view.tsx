"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConversationStatus } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { getConsoleSnapshot, manageAnalystConversation } from "./actions";
import {
  AnalystControls,
  conversationLabels,
  type AnalystAction,
} from "./analyst-controls";
import { ActivityLine, DecisionDetails } from "@/app/chat/decision-details";
import { MessagePayload } from "@/app/chat/message-payload";
import { formatDate, readableDecisionText } from "@/lib/presentation";
import styles from "./console.module.css";

type Snapshot = Awaited<ReturnType<typeof getConsoleSnapshot>>;

export function ConsoleView({
  analystId,
  analystName,
}: {
  analystId: string;
  analystName: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState<ConversationStatus | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let fetching = false;
    async function refresh() {
      if (fetching || locked.current) return;
      fetching = true;
      try {
        const result = await getConsoleSnapshot(
          filter === "ALL" ? undefined : filter,
          selectedId,
        );
        if (active) {
          setSnapshot(result);
          setError(null);
          if (!selectedId && result.detail) setSelectedId(result.detail.id);
        }
      } catch {
        if (active)
          setError(
            "Não foi possível atualizar o atendimento. Tente novamente.",
          );
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [filter, selectedId, revision]);

  const detail = snapshot?.detail;
  const canReply =
    detail?.status === "ANALYST" && detail.analystId === analystId;
  async function act(action: AnalystAction) {
    if (!detail || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await manageAnalystConversation(
        detail.id,
        action,
        action === "reply" ? text : undefined,
      );
      if (action === "reply") setText("");
    } catch {
      setError(
        "Não foi possível concluir a ação. O atendimento pode ter mudado; atualize e confira antes de tentar novamente.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() && canReply) void act("reply");
  }
  const filtered =
    snapshot?.conversations.filter((conversation) =>
      `${conversation.employee.name} ${conversation.employee.email} ${conversation.messages[0]?.content ?? ""} ${conversation.transferSummary ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    ) ?? [];
  return (
    <main className={styles.shell} aria-label="Console do analista">
      <aside className={styles.rail} aria-label="Conta do analista">
        <a href="/console" aria-label="Nexo Assist" className={styles.logo}>
          N
        </a>
        <span title={analystName}>
          {analystName
            .split(" ")
            .map((part) => part[0])
            .slice(0, 2)
            .join("")}
        </span>
        <form action={logout}>
          <button type="submit">Sair</button>
        </form>
      </aside>
      <section className={styles.queue} aria-label="Fila de conversas">
        <header>
          <h1>Conversas</h1>
          <span>Service desk</span>
        </header>
        <label className={styles.search}>
          Pesquisar conversa ou chamado
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome, assunto ou número"
          />
        </label>
        <div className={styles.filters} aria-label="Filtrar por status">
          {(
            [
              "ALL",
              "WAITING_FOR_ANALYST",
              "AGENT",
              "ANALYST",
              "CLOSED",
            ] as const
          ).map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filter === status}
              disabled={busy}
              onClick={() => {
                setFilter(status);
                setSelectedId(undefined);
                setSnapshot(null);
                setText("");
                setLoading(true);
              }}
            >
              {status === "ALL" ? "Todas" : conversationLabels[status]}
            </button>
          ))}
        </div>
        <div className={styles.queueItems}>
          {filtered.map((conversation) => (
            <button
              type="button"
              className={styles.queueItem}
              key={conversation.id}
              aria-pressed={detail?.id === conversation.id}
              disabled={busy}
              onClick={() => {
                setSelectedId(conversation.id);
                setLoading(true);
                setText("");
              }}
            >
              <strong>{conversation.employee.name}</strong>
              <time>{formatDate(conversation.updatedAt)}</time>
              <p>{conversation.messages[0]?.content ?? "Conversa iniciada"}</p>
              <span className={styles.state} data-status={conversation.status}>
                {conversation.analystId === analystId &&
                conversation.status === "ANALYST"
                  ? "Você está atendendo"
                  : conversationLabels[conversation.status]}
              </span>
            </button>
          ))}
        </div>
        {!loading && !filtered.length && (
          <p className={styles.empty}>Nenhuma conversa neste filtro.</p>
        )}
      </section>
      <section
        className={styles.conversation}
        aria-label="Histórico e atendimento"
        aria-busy={loading || busy}
      >
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {loading && (
          <p className={styles.notice} role="status">
            Carregando atendimento…
          </p>
        )}
        {detail && (!selectedId || detail.id === selectedId) ? (
          <>
            <header className={styles.conversationHeader}>
              <div>
                <h2>{detail.employee.name}</h2>
                <p>{detail.employee.email}</p>
                <span className={styles.state} data-status={detail.status}>
                  {conversationLabels[detail.status]}
                </span>
              </div>
              <div className={styles.controls}>
                <AnalystControls
                  status={detail.status}
                  assignedId={detail.analystId}
                  analystId={analystId}
                  busy={busy || loading}
                  onAction={(action) => void act(action)}
                />
              </div>
            </header>
            <div className={styles.history}>
              {detail.transferSummary && (
                <details open className={styles.summary}>
                  <summary>Resumo da transferência</summary>
                  <p>{readableDecisionText(detail.transferSummary)}</p>
                </details>
              )}
              {detail.messages.map((message) => (
                <article
                  className={styles.message}
                  data-role={message.role}
                  key={message.id}
                >
                  {message.role === "AGENT" ? (
                    <ActivityLine record={message.decisionRecord} />
                  ) : (
                    <strong>
                      {message.role === "EMPLOYEE"
                        ? detail.employee.name
                        : message.role === "ANALYST"
                          ? "Analista"
                          : "Atendimento"}
                    </strong>
                  )}
                  <p>{message.content}</p>
                  <time>{formatDate(message.createdAt)}</time>
                  {message.payload && (
                    <MessagePayload
                      payload={message.payload}
                      disabled
                      onOption={() => {}}
                    />
                  )}
                  {message.decisionRecord && (
                    <DecisionDetails record={message.decisionRecord} />
                  )}
                </article>
              ))}
            </div>
            <div className={styles.reply}>
              <p>
                {detail.status === "CLOSED"
                  ? "Atendimento encerrado."
                  : detail.status === "AGENT"
                    ? "O assistente está atendendo esta conversa."
                    : "Agent pausado durante o atendimento humano."}
              </p>
              <form onSubmit={submit}>
                <label htmlFor="analyst-reply">Resposta ao funcionário</label>
                <textarea
                  id="analyst-reply"
                  rows={3}
                  maxLength={4000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={!canReply || busy}
                  placeholder={
                    canReply
                      ? "Escreva sua resposta…"
                      : "Assuma o atendimento para responder"
                  }
                />
                <button
                  type="submit"
                  disabled={!canReply || busy || !text.trim()}
                >
                  {busy ? "Salvando…" : "Responder"}
                </button>
              </form>
            </div>
          </>
        ) : (
          !loading && (
            <p className={styles.empty}>
              Selecione uma conversa para acompanhar o atendimento.
            </p>
          )
        )}
      </section>
      <aside className={styles.tickets} aria-label="Chamados do funcionário">
        {detail && (!selectedId || detail.id === selectedId) ? (
          <>
            <h2>Chamados de {detail.employee.name.split(" ")[0]}</h2>
            <p>
              {
                detail.tickets.filter(
                  (ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status),
                ).length
              }{" "}
              ativos · {detail.tickets.length} no total
            </p>
            <MessagePayload
              payload={{ tickets: detail.tickets }}
              disabled
              onOption={() => {}}
            />
            {!detail.tickets.length && <p>Nenhum chamado encontrado.</p>}
          </>
        ) : (
          <p>Os chamados aparecerão ao selecionar uma conversa.</p>
        )}
      </aside>
    </main>
  );
}
