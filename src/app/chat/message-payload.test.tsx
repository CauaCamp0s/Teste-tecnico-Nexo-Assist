import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessagePayload } from "./message-payload";
import type { ChatPayload } from "@/services/chat-payload";

test("seleção mostra linhas compactas e reserva detalhes para chamado selecionado", () => {
  const ticket = {
    id: "ticket",
    employeeId: "employee",
    number: "INC-20311",
    title: "Notebook lento",
    description: "Descrição detalhada do chamado",
    type: "INC" as const,
    category: "HARDWARE" as const,
    impact: "SELF" as const,
    priority: "MEDIUM" as const,
    status: "IN_PROGRESS" as const,
    createdAt: "2026-11-01T12:00:00Z",
    lastUpdatedAt: null,
    resolvedAt: null,
    dueAt: "2026-11-04T21:00:00Z",
    isOverdue: true,
    transferSummary: null,
  };
  const payload: ChatPayload = {
    tickets: [ticket],
    options: [{ label: ticket.title, value: ticket.number }],
  };
  const render = () =>
    renderToStaticMarkup(
      <MessagePayload payload={payload} disabled={false} onOption={() => {}} />,
    );
  expect(render()).toContain('aria-label="Selecionar chamado"');
  expect(render()).toContain("INC-20311");
  expect(render()).toContain("Em andamento");
  expect(render()).not.toContain(ticket.description);
  delete payload.options;
  expect(render()).toContain(ticket.description);
});

test("limite bloqueia opções de mensagem, mas mantém confirmação pendente e retry acessíveis", () => {
  const payload: ChatPayload = {
    draft: {
      id: "draft",
      kind: "CREATE",
      title: "VPN",
      description: "Erro 809",
      type: "INC",
      category: "NETWORK_VPN",
      priority: "HIGH",
      impact: "SELF",
      dueAt: null,
      status: "PENDING",
      failureCode: "UNAVAILABLE",
    },
    options: [{ label: "Mais dados", value: "Mais dados" }],
  };
  const html = renderToStaticMarkup(
    <MessagePayload
      payload={payload}
      disabled={false}
      limitReached
      onOption={() => {}}
      onDraft={() => {}}
    />,
  );
  expect(html).toMatch(/<button[^>]*>Tentar novamente<\/button>/);
  expect(html).toContain('disabled="">Mais dados');
  expect(html).toContain("Incidente");
  expect(html).toContain("Rede e VPN");
  payload.draft!.status = "CONFIRMED";
  const confirmed = renderToStaticMarkup(
    <MessagePayload
      payload={payload}
      disabled={false}
      onOption={() => {}}
      onDraft={() => {}}
    />,
  );
  expect(confirmed).toContain("Confirmado");
  expect(confirmed).not.toContain("Tentar novamente");
});
