import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ActivityLine, DecisionDetails } from "./decision-details";
import type { DecisionRecord } from "@/agent/decisions";

test("detalhe apresenta consultas, ações e regras reais sem JSON cru", () => {
  const record: DecisionRecord = {
    understanding: { intent: "ti", summary: "VPN com erro 809" },
    consultations: [
      {
        tool: "get_ticket",
        input: { number: "INC-100001" },
        result: {
          status: "success",
          articleIds: [],
          summary: "Chamado aberto, prazo até 18h.",
        },
      },
    ],
    decision: "confirmar_alteracao",
    executedActions: ["Criou INC-100001."],
    confidence: "alta",
    reason: "Confirmação explícita do funcionário.",
    appliedRules: [
      "Prioridade HIGH: compromisso hoje.",
      "Prazo real: 18h; calendário de dias úteis.",
    ],
  };
  const html = renderToStaticMarkup(<DecisionDetails record={record} />);
  for (const text of [
    "Entendimento",
    "Chamado selecionado",
    "INC-100001",
    "Chamado aberto",
    "Confirmar alteração",
    "Criou INC-100001.",
    "compromisso hoje",
    "calendário de dias úteis",
    "Confirmação explícita",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Nenhuma ação");
  expect(html).not.toContain("executedActions");
  const activity = renderToStaticMarkup(<ActivityLine record={record} />);
  expect(activity).toContain("classificou a prioridade");
  expect(activity).toContain("calculou o prazo");
  expect(activity).not.toContain("buscou na central");
});
