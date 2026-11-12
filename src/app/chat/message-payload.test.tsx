import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessagePayload } from "./message-payload";
import type { ChatPayload } from "@/services/chat-payload";

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
  expect(html).toContain('type="button">Tentar novamente');
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
