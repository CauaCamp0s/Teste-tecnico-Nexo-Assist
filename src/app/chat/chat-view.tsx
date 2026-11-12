"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConversationStatus } from "@prisma/client";
import type { ChatMessage } from "@/services/chat";
import { requestReply, sendMessage } from "./actions";
import { ActivityLine, DecisionDetails } from "./decision-details";
import styles from "./chat.module.css";

export function ChatView({
  conversationId,
  status,
  initialMessages,
  firstName,
}: {
  conversationId: string;
  status: ConversationStatus;
  initialMessages: ChatMessage[];
  firstName: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "thinking">("idle");
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = phase !== "idle";
  const paused = status !== "AGENT";
  const last = messages.at(-1);
  const pendingMessage = last?.role === "EMPLOYEE" ? last : null;

  useEffect(() => {
    end.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [messages, phase]);

  useEffect(() => {
    if (phase === "idle") input.current?.focus();
  }, [phase]);

  function append(message: ChatMessage) {
    setMessages((current) =>
      current.some(({ id }) => id === message.id)
        ? current
        : [...current, message],
    );
  }

  async function getReply(messageId: string) {
    setPhase("thinking");
    try {
      const result = await requestReply(conversationId, messageId);
      if (result.message) append(result.message);
      else setError(result.error);
    } catch {
      setError(
        "A conexão foi interrompida. Sua mensagem está salva. Tente obter a resposta novamente ou atualize a conversa.",
      );
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || paused || !draft.trim()) return;
    locked.current = true;
    setError(null);
    setPhase("sending");
    try {
      const result = await sendMessage(conversationId, draft);
      if (!result.message) {
        setError(result.error);
        return;
      }
      append(result.message);
      setDraft("");
      await getReply(result.message.id);
    } catch {
      setError(
        "Não foi possível confirmar o envio. Seu texto foi mantido. Atualize a conversa antes de enviar novamente.",
      );
    } finally {
      locked.current = false;
      setPhase("idle");
    }
  }

  async function retryPending() {
    if (locked.current || !pendingMessage || paused) return;
    locked.current = true;
    setError(null);
    try {
      await getReply(pendingMessage.id);
    } finally {
      locked.current = false;
      setPhase("idle");
    }
  }

  return (
    <div className={styles.chat}>
      <section className={styles.messages} aria-label="Histórico da conversa">
        <div className={styles.messageColumn}>
          {!messages.length && (
            <div className={styles.welcome}>
              <span className={styles.welcomeMark} aria-hidden="true">
                N
              </span>
              <p className={styles.eyebrow}>SEU SERVICE DESK DE TI</p>
              <h2>
                Olá, {firstName}.<br />
                Como posso ajudar?
              </h2>
              <p>
                Conte o que está acontecendo. Vou consultar a central de ajuda
                para orientar você.
              </p>
              <div className={styles.suggestions}>
                {[
                  "VPN com erro 809",
                  "Meu monitor não liga",
                  "Não consigo acessar o e-mail",
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    disabled={busy || paused}
                    onClick={() => {
                      setDraft(text);
                      input.current?.focus();
                    }}
                  >
                    {text} <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              aria-label={
                message.role === "EMPLOYEE"
                  ? "Sua mensagem"
                  : message.role === "AGENT"
                    ? "Resposta do Nexo Assist"
                    : "Mensagem do atendimento"
              }
              className={
                message.role === "EMPLOYEE"
                  ? styles.employeeMessage
                  : styles.agentMessage
              }
            >
              {message.role === "AGENT" ? (
                <ActivityLine record={message.decisionRecord} />
              ) : (
                message.role !== "EMPLOYEE" && (
                  <div className={styles.activity}>
                    <strong>
                      {message.role === "ANALYST" ? "Analista" : "Atendimento"}
                    </strong>
                  </div>
                )
              )}
              {message.decisionRecord?.modelFailure && (
                <div className={styles.modelError} role="alert">
                  <strong>Não foi possível concluir a orientação.</strong>
                  <span>
                    Sua mensagem está salva. Você pode acrescentar detalhes ou
                    tentar mais tarde.
                  </span>
                </div>
              )}
              <div
                className={
                  message.role === "EMPLOYEE"
                    ? styles.employeeBubble
                    : styles.agentBubble
                }
              >
                {message.content}
              </div>
              {message.role === "AGENT" && message.decisionRecord && (
                <DecisionDetails record={message.decisionRecord} />
              )}
            </article>
          ))}
          <div aria-live="polite" role="status" className={styles.progress}>
            {busy && (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                {phase === "sending"
                  ? "Salvando sua mensagem…"
                  : "Nexo Assist está pensando…"}
                <span className={styles.progressNote}>
                  {phase === "thinking"
                    ? "Sua mensagem está salva. Isso pode levar até 20 segundos."
                    : ""}
                </span>
              </>
            )}
          </div>
          {!busy && !error && pendingMessage && !paused && (
            <div className={styles.pending}>
              Sua mensagem está salva e ainda não tem resposta.
              <button type="button" onClick={retryPending}>
                Obter resposta
              </button>
            </div>
          )}
          {error && (
            <div className={styles.error} role="alert">
              <p>{error}</p>
              <div>
                {pendingMessage && !busy && !paused && (
                  <button type="button" onClick={retryPending}>
                    Tentar obter resposta
                  </button>
                )}
                <a href="/chat">Atualizar conversa</a>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </section>
      <div className={styles.composerArea}>
        {paused ? (
          <p className={styles.paused}>
            O assistente está pausado nesta conversa. Atualize a página para
            acompanhar o atendimento.
          </p>
        ) : (
          <form onSubmit={submit} className={styles.composer} aria-busy={busy}>
            <label htmlFor="mensagem" className={styles.srOnly}>
              Mensagem para o Nexo Assist
            </label>
            <textarea
              ref={input}
              id="mensagem"
              name="message"
              placeholder="Escreva para o Nexo…"
              maxLength={4_000}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              <span aria-hidden="true">↑</span> Enviar
            </button>
          </form>
        )}
        <div className={styles.composerMeta}>
          <span>
            {messages.filter(({ role }) => role === "EMPLOYEE").length}{" "}
            mensagens enviadas
          </span>
          <span>Enter para enviar · Shift + Enter para nova linha</span>
        </div>
      </div>
    </div>
  );
}
