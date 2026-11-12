import type { Message, Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { establishedTicketNumbers } from "./ticket-context";

const message = (
  role: Message["role"],
  content: string,
  payload: Prisma.JsonValue = {},
  decisionRecord: Prisma.JsonValue = {},
) => ({ role, content, payload, decisionRecord });

test("consulta, candidato único e rascunho não estabelecem alvo, mesmo com texto livre de sucesso", () => {
  const messages = [
    message(
      "AGENT",
      "Criou INC-20315",
      { tickets: [{ number: "INC-20315", status: "OPEN" }] },
      { decision: "consultar_chamados", executedActions: [] },
    ),
    message("AGENT", "Confirme o rascunho", {
      draft: { targetNumber: "INC-20315" },
    }),
  ];
  expect([...establishedTicketNumbers(messages)]).toEqual([]);
});

test.each(["Criou", "Atualizou", "Reabriu"])(
  "%s confirmado nesta conversa estabelece o alvo",
  (verb) => {
    expect([
      ...establishedTicketNumbers([
        message(
          "AGENT",
          "Resultado",
          { tickets: [{ number: "INC-20316" }] },
          {
            decision: "confirmar_alteracao",
            executedActions: [`${verb} INC-20316.`],
          },
        ),
      ]),
    ]).toEqual(["INC-20316"]);
  },
);

test("somente referências do funcionário estabelecem seleção e citação por número", () => {
  const messages = [
    message("AGENT", "Pode ser INC-20315?"),
    message("EMPLOYEE", "É o mesmo problema do INC-20316"),
    message("EMPLOYEE", "Acrescente ao req-10445 que testei outro cabo"),
  ];
  expect([...establishedTicketNumbers(messages)]).toEqual([
    "INC-20316",
    "REQ-10445",
  ]);
});
