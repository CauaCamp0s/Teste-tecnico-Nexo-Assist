import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  createTicketFixture,
  type TicketFixture,
} from "@/services/tickets/test-support";
import { createChatDraftService } from "@/services/chat-drafts";
import { TicketUnavailableError } from "@/services/tickets/errors";
import { createTicketService } from "@/services/tickets/service";
import type { ChatPayload } from "@/services/chat-payload";
import type { DecisionRecord } from "./decisions";
import type { TicketProposal } from "./proposal";

let f: TicketFixture;
let respond: typeof import("./help-center").respondToConversation;
let services: typeof import("@/services/tickets");
const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
const assessment = {
  understanding: { intent: "ti", summary: "Solicitação de TI" },
  confidence: "alta",
  reason: "Contexto informado pelo funcionário.",
  answer: "Confira os dados.",
};
const complete: TicketProposal = {
  title: "VPN com erro 809",
  description: "Windows 11 com erro 809 desde ontem.",
  type: "INC",
  category: "NETWORK_VPN",
  impact: "SELF",
  interruption: "stopped",
  sameDayCommitment: true,
  duplicate: { relation: "different", number: null },
};
const text = (object: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(object) }],
  finishReason: "stop" as const,
  usage,
  warnings: [],
});
const tool = (name: string, input: unknown) => ({
  content: [
    {
      type: "tool-call" as const,
      toolCallId: "call",
      toolName: name,
      input: JSON.stringify(input),
    },
  ],
  finishReason: "tool-calls" as const,
  usage,
  warnings: [],
});

beforeAll(async () => {
  f = await createTicketFixture();
  vi.doMock("@/lib/db", () => ({ db: f.db }));
  respond = (await import("./help-center")).respondToConversation;
  services = await import("@/services/tickets");
}, 30000);
beforeEach(async () => {
  vi.restoreAllMocks();
  await f.db.message.deleteMany();
  await f.reset();
  await f.db.ticket.update({
    where: { number: "INC-20150" },
    data: { resolvedAt: new Date(Date.now() - 4 * 86400000) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("API real proibida nos cenários automatizados.");
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/db");
  await f?.close();
});

async function turn(
  content: string,
  answer: object = assessment,
  call?: { name: string; input: unknown },
) {
  await f.db.message.create({
    data: {
      conversationId: f.conversationId,
      authorId: f.ana,
      role: "EMPLOYEE",
      content,
    },
  });
  const model = new MastraLanguageModelV2Mock({
    doGenerate: call
      ? [tool(call.name, call.input), text(answer)]
      : [text(answer)],
  });
  const start = performance.now();
  const message = await respond(f.ana, f.conversationId, model);
  expect(performance.now() - start).toBeLessThan(20000);
  expect(model.doGenerateCalls.length).toBeLessThanOrEqual(2);
  return {
    message,
    model,
    record: message.decisionRecord as unknown as DecisionRecord,
    payload: message.payload as ChatPayload,
  };
}

test("dúvida resolvida por artigo sem criar chamado", async () => {
  const result = await turn(
    "VPN erro 809 Windows 10",
    {
      ...assessment,
      answer:
        "Reinstale o cliente VPN pelo portal de softwares e reinicie o computador; esse artigo vale para Windows 10.",
    },
    { name: "search_help_center", input: { query: "VPN erro 809" } },
  );
  expect(result.record.decision).toBe("orientar_com_artigos");
  expect(
    result.record.consultations[0].result.articleIds.length,
  ).toBeGreaterThan(0);
  expect(result.record.executedActions).toEqual([]);
});

test("consulta sem número pede seleção; selecionado vencido oferece transferência", async () => {
  const list = await turn("Qual o status do meu chamado?", assessment, {
    name: "list_tickets",
    input: {},
  });
  expect(list.payload.options!.length).toBeGreaterThan(1);
  const selected = await turn("INC-20311", assessment, {
    name: "get_ticket",
    input: { number: "INC-20311" },
  });
  expect(selected.payload.tickets![0].isOverdue).toBe(true);
  expect(selected.record.decision).toBe("oferecer_transferencia");
  expect(
    selected.payload.options!.some((o) => o.label === "Falar com um analista"),
  ).toBe(true);
  expect(
    (
      await f.db.conversation.findUniqueOrThrow({
        where: { id: f.conversationId },
      })
    ).status,
  ).toBe("AGENT");
  const accepted = await turn("Quero falar com um analista sobre INC-20311", {
    ...assessment,
    handoff: { requested: true, relatedNumber: "INC-20311" },
  });
  expect(accepted.record.executedActions.join(" ")).toContain(
    "Transferiu INC-20311",
  );
  expect(await f.db.ticketOperation.count()).toBe(1);
});

test("abertura em três mensagens até confirmação, sem prioridade livre do modelo", async () => {
  const first = await turn(
    "VPN erro 809 no Windows 11 desde ontem. Quero chamado.",
    {
      ...assessment,
      proposal: {
        ...complete,
        impact: null,
        interruption: null,
        sameDayCommitment: null,
      },
    },
  );
  expect(first.message.content).toBe("Quem está sendo afetado?");
  const second = await turn("Só eu, não consigo trabalhar.", {
    ...assessment,
    proposal: { ...complete, sameDayCommitment: null },
  });
  expect(second.message.content).toContain("compromisso");
  const third = await turn(
    "Tenho reunião hoje; problema diferente dos meus chamados anteriores.",
    { ...assessment, proposal: { ...complete, priority: "LOW" } },
    { name: "find_duplicate_candidates", input: {} },
  );
  expect(third.payload.draft).toMatchObject({
    kind: "CREATE",
    priority: "HIGH",
    status: "PENDING",
  });
  expect(third.record.appliedRules.join(" ")).toContain(
    "compromisso hoje: sim",
  );
  expect(await f.db.ticket.count()).toBe(9);
  const act = createChatDraftService(f.db);
  const confirmed = await act(
    f.ana,
    f.conversationId,
    third.payload.draft!.id,
    "confirm",
  );
  expect(confirmed.content).toContain("Criou o chamado INC-100001");
  await act(f.ana, f.conversationId, third.payload.draft!.id, "confirm");
  expect(await f.db.ticket.count()).toBe(10);
  const savedCard = await f.db.message.findUniqueOrThrow({
    where: { id: third.message.id },
  });
  expect((savedCard.payload as ChatPayload).draft?.status).toBe("CONFIRMED");
});

test("texto livre não confirma escrita inventada mesmo após consulta válida de artigo", async () => {
  const result = await turn(
    "VPN erro 809",
    { ...assessment, answer: "Criei o chamado INC-999999 para você." },
    { name: "search_help_center", input: { query: "VPN erro 809" } },
  );
  expect(result.message.content).not.toContain("INC-999999");
  expect(result.record.executedActions).toEqual([]);
  expect(await f.db.ticketOperation.count()).toBe(0);
});

test("falha após escrita do encaminhamento desfaz chamado e preserva fila com aviso honesto", async () => {
  vi.spyOn(services, "ticketFactory").mockImplementation((tx) => {
    const service = createTicketService(tx);
    return {
      ...service,
      transfer: async (...args) => {
        await service.transfer(...args);
        throw new TicketUnavailableError(3, true);
      },
    };
  });
  const result = await turn("Analista para INC-20312", {
    ...assessment,
    handoff: { requested: true, relatedNumber: "INC-20312" },
  });
  expect(result.message.content).toContain("não consegui transferir o chamado");
  expect(result.record.executedActions).toEqual([
    "Encaminhou a conversa para a fila de analistas e pausou o agent.",
  ]);
  expect(await f.db.ticketOperation.count()).toBe(0);
  expect(
    (
      await f.db.conversation.findUniqueOrThrow({
        where: { id: f.conversationId },
      })
    ).status,
  ).toBe("WAITING_FOR_ANALYST");
});

test.each(["INC-20312", "INC-20150"])(
  "mesmo problema em %s gera operação correta sem duplicação",
  async (number) => {
    const result = await turn(
      `É o mesmo problema do ${number}`,
      {
        ...assessment,
        proposal: { ...complete, duplicate: { relation: "same", number } },
      },
      { name: "find_duplicate_candidates", input: {} },
    );
    expect(result.payload.draft?.kind).toBe(
      number === "INC-20150" ? "REOPEN" : "UPDATE",
    );
    await createChatDraftService(f.db)(
      f.ana,
      f.conversationId,
      result.payload.draft!.id,
      "confirm",
    );
    expect(await f.db.ticket.count()).toBe(9);
    expect(
      (await f.db.ticket.findUniqueOrThrow({ where: { number } })).description,
    ).toContain(complete.description);
  },
);

test("fora de sete dias não reabre nem cria silenciosamente", async () => {
  await f.db.ticket.update({
    where: { number: "INC-20150" },
    data: { resolvedAt: new Date(Date.now() - 8 * 86400000) },
  });
  const result = await turn(
    "Reabra INC-20150",
    {
      ...assessment,
      proposal: {
        ...complete,
        duplicate: { relation: "same", number: "INC-20150" },
      },
    },
    { name: "find_duplicate_candidates", input: {} },
  );
  expect(result.message.content).toContain("não pode ser reaberto");
  expect(result.payload.draft).toBeUndefined();
  expect(await f.db.ticketDraft.count()).toBe(0);
  expect(await f.db.ticketOperation.count()).toBe(0);
});

test.each(["explicit", "critical", "low"])(
  "encaminha %s e não executa modelo enquanto pausado",
  async (reason) => {
    const result = await turn("Preciso de atendimento", {
      ...assessment,
      confidence: reason === "low" ? "baixa" : "alta",
      handoff: { requested: reason === "explicit", relatedNumber: null },
      proposal:
        reason === "critical"
          ? { ...complete, impact: "TEAM", description: null }
          : null,
    });
    expect(result.record.decision).toBe("transferir");
    const c = await f.db.conversation.findUniqueOrThrow({
      where: { id: f.conversationId },
    });
    expect(c.status).toBe("WAITING_FOR_ANALYST");
    expect(c.transferSummary).toContain("Preciso de atendimento");
    const model = new MastraLanguageModelV2Mock({
      doGenerate: text(assessment),
    });
    await expect(respond(f.ana, c.id, model)).rejects.toThrow(
      "não está atendendo",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  },
);

test("fora de escopo é redirecionado, mesmo com sugestão indevida de rascunho", async () => {
  const result = await turn("Quero saber meu saldo de férias", {
    ...assessment,
    understanding: { intent: "rh", summary: "Férias" },
    proposal: complete,
    handoff: { requested: true, relatedNumber: null },
  });
  expect(result.record.decision).toBe("redirecionar");
  expect(result.message.content).toContain("RH");
  expect(await f.db.ticketDraft.count()).toBe(0);
});

test("indisponibilidade do legado não vira confirmação falsa", async () => {
  vi.spyOn(services.ticketService, "list").mockRejectedValue(
    new TicketUnavailableError(3),
  );
  const result = await turn(
    "Meus chamados",
    { ...assessment, answer: "Já resolvi tudo" },
    { name: "list_tickets", input: {} },
  );
  expect(result.record.decision).toBe("indisponivel");
  expect(result.record.executedActions).toEqual([]);
  expect(result.message.content).toContain("Não consegui consultar");
  expect(result.message.content).not.toContain("resolvi");
});

test("isolamento pelo closure ignora identidade injetada pelo modelo", async () => {
  const result = await turn("Consulte INC-20315", assessment, {
    name: "get_ticket",
    input: { number: "INC-20315", employeeId: f.bruno },
  });
  expect(result.payload.tickets).toEqual([]);
  expect(result.message.content).toContain("Não encontrei");
  const list = await turn("Liste chamados de Bruno", assessment, {
    name: "list_tickets",
    input: { employeeId: f.bruno },
  });
  expect(list.payload.tickets!.every((t) => t.employeeId === f.ana)).toBe(true);
  expect(JSON.stringify(list.record)).not.toContain("INC-20315");
});
