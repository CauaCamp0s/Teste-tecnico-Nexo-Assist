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
const tool = (name: string, input: unknown) =>
  text({
    ...assessment,
    consultationPlan: [{ tool: name, ...(input as object) }],
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
  options: {
    employeeId?: string;
    conversationId?: string;
    followup?: object;
  } = {},
) {
  const employeeId = options.employeeId ?? f.ana;
  const conversationId = options.conversationId ?? f.conversationId;
  await f.db.message.create({
    data: {
      conversationId,
      authorId: employeeId,
      role: "EMPLOYEE",
      content,
    },
  });
  const model = new MastraLanguageModelV2Mock({
    doGenerate: call
      ? [tool(call.name, call.input), text(answer)]
      : options.followup
        ? [text(answer), text(options.followup)]
        : text(answer),
  });
  const start = performance.now();
  const message = await respond(employeeId, conversationId, model);
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

test.each(["10", "11"])(
  "VPN 809 orienta antes da coleta e respeita Windows %s",
  async (version) => {
    const opening = await turn("Minha VPN está dando erro 809", {
      ...assessment,
      proposal: { ...complete, impact: null },
    });
    expect(opening.message.content).toContain("Windows 10 ou Windows 11");
    expect(opening.payload.draft).toBeUndefined();
    const followup = await turn(
      `Windows ${version}`,
      { ...assessment, proposal: { ...complete, impact: null } },
      { name: "search_help_center", input: { query: "VPN erro 809" } },
    );
    expect(followup.message.content).toContain(
      version === "10"
        ? "Reinstale o cliente de VPN"
        : "Quem está sendo afetado?",
    );
    expect(await f.db.ticketDraft.count()).toBe(0);
  },
);

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

test("consulta por notebook vai direto ao único chamado ativo do funcionário", async () => {
  const result = await turn("Como está meu chamado do notebook?", assessment, {
    name: "list_tickets",
    input: { subject: "notebook" },
  });
  expect(result.payload.tickets?.map((ticket) => ticket.number)).toEqual([
    "INC-20311",
  ]);
  expect(result.message.content).not.toContain("Sobre qual");
  expect(result.record.consultations[0].input).toEqual({ subject: "notebook" });
  expect(result.record.confidence).toBe("alta");
  expect(result.record.appliedRules.join(" ")).not.toContain(
    "Sem artigo relevante",
  );
  const all = await services.ticketService.list(f.ana, { subject: "notebook" });
  expect(all.every((ticket) => ticket.employeeId === f.ana)).toBe(true);
  const active = await turn("Meus chamados", assessment, {
    name: "list_tickets",
    input: {},
  });
  expect(
    active.payload.tickets?.every(
      (ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status),
    ),
  ).toBe(true);
});

test("abertura com uma pergunta até confirmação, sem urgência redundante nem prioridade livre", async () => {
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
  const second = await turn(
    "Só eu, não consigo trabalhar. É outro problema.",
    {
      ...assessment,
      proposal: { ...complete, sameDayCommitment: null, priority: "LOW" },
    },
    { name: "find_duplicate_candidates", input: {} },
  );
  expect(second.payload.draft).toMatchObject({
    kind: "CREATE",
    priority: "HIGH",
    status: "PENDING",
  });
  expect(second.record.confidence).toBe("alta");
  expect(second.record.appliedRules.join(" ")).not.toContain(
    "Sem artigo relevante",
  );
  expect(second.record.appliedRules.join(" ")).toContain(
    "Compromisso no mesmo dia não perguntado",
  );
  expect(await f.db.ticket.count()).toBe(9);
  const act = createChatDraftService(f.db);
  const confirmed = await act(
    f.ana,
    f.conversationId,
    second.payload.draft!.id,
    "confirm",
  );
  expect(confirmed.content).toContain("Criou o chamado INC-20316");
  await act(f.ana, f.conversationId, second.payload.draft!.id, "confirm");
  expect(await f.db.ticket.count()).toBe(10);
  const savedCard = await f.db.message.findUniqueOrThrow({
    where: { id: second.message.id },
  });
  expect((savedCard.payload as ChatPayload).draft?.status).toBe("CONFIRMED");
});

test("Bruno cria monitor e acrescenta teste na mesma conversa: UPDATE sem repetir coleta e confirmação executa addUpdate", async () => {
  const actor = { employeeId: f.bruno, conversationId: f.otherConversationId };
  const opened = await turn(
    "Quero abrir um chamado: meu monitor não liga. Só eu, tenho alternativa para trabalhar, sem compromisso hoje. É outro problema.",
    {
      ...assessment,
      proposal: {
        ...complete,
        title: "Monitor não liga",
        description: "Monitor não liga.",
        category: "HARDWARE",
        interruption: "degraded",
        sameDayCommitment: false,
      },
    },
    { name: "find_duplicate_candidates", input: {} },
    actor,
  );
  const addUpdate = vi.fn();
  const act = createChatDraftService(f.db, (tx) => {
    const tickets = createTicketService(tx);
    return {
      ...tickets,
      addUpdate: async (...args) => {
        addUpdate(...args);
        return tickets.addUpdate(...args);
      },
    };
  });
  const created = await act(
    f.bruno,
    f.otherConversationId,
    opened.payload.draft!.id,
    "confirm",
  );
  expect((created.payload as ChatPayload).tickets?.[0].number).toBe(
    "INC-20316",
  );
  const before = await f.db.ticket.findUniqueOrThrow({
    where: { number: "INC-20316" },
  });
  const information =
    "O monitor continua sem ligar, testei em outra tomada e também não funcionou.";
  const understood = {
    ...assessment,
    answer: "Posso acrescentar esse teste ao chamado.",
    reason:
      "O chamado INC-20316 já foi criado para o problema do monitor e o funcionário está apenas informando um novo teste",
    proposal: null,
    consultationPlan: [],
  };
  const update = await turn(information, understood, undefined, {
    ...actor,
    followup: { ...understood, ticketUpdate: { number: "INC-20316" } },
  });
  expect(update.model.doGenerateCalls).toHaveLength(2);
  expect(
    update.record.consultations.map((consultation) => consultation.tool),
  ).toEqual(["find_duplicate_candidates"]);
  expect(update.message.content).not.toMatch(
    /central de ajuda|Quem está sendo afetado|Como isso afeta/,
  );
  expect(update.payload.draft).toMatchObject({
    kind: "UPDATE",
    title: before.title,
    description: information,
    type: before.type,
    category: before.category,
    priority: before.priority,
    impact: before.impact,
    status: "PENDING",
  });
  expect(addUpdate).not.toHaveBeenCalled();
  expect(
    (await f.db.ticket.findUniqueOrThrow({ where: { id: before.id } }))
      .description,
  ).toBe(before.description);
  const confirmed = await act(
    f.bruno,
    f.otherConversationId,
    update.payload.draft!.id,
    "confirm",
  );
  expect(addUpdate).toHaveBeenCalledExactlyOnceWith(
    f.bruno,
    "INC-20316",
    expect.objectContaining({
      description: information,
      priority: before.priority,
      category: before.category,
    }),
    update.payload.draft!.id,
  );
  expect(
    (confirmed.decisionRecord as unknown as DecisionRecord).executedActions,
  ).toEqual(["Atualizou INC-20316."]);
  expect(
    (await f.db.ticket.findUniqueOrThrow({ where: { id: before.id } }))
      .description,
  ).toBe(`${before.description}\n\nAtualização:\n${information}`);
  expect(await f.db.ticket.count()).toBe(10);
  await act(
    f.bruno,
    f.otherConversationId,
    update.payload.draft!.id,
    "confirm",
  );
  expect(addUpdate).toHaveBeenCalledTimes(1);
});

test("Bruno relata monitor parado: candidato de e-mail é descartado e criação é proposta diretamente", async () => {
  const result = await turn(
    "Meu monitor não liga desde hoje cedo. Já troquei o cabo de força e nada. Só eu estou afetado e não consigo trabalhar.",
    {
      ...assessment,
      helpOutcome: "not_applicable",
      proposal: {
        ...complete,
        title: "Monitor não liga",
        description:
          "Monitor não liga desde hoje cedo, mesmo após trocar o cabo de força.",
        category: "HARDWARE",
        sameDayCommitment: null,
        duplicate: { relation: "uncertain", number: null },
      },
    },
    { name: "find_duplicate_candidates", input: {} },
    { employeeId: f.bruno, conversationId: f.otherConversationId },
  );
  expect(result.payload.draft, result.message.content).toMatchObject({
    kind: "CREATE",
    category: "HARDWARE",
    priority: "HIGH",
  });
  expect(result.payload.tickets).toBeUndefined();
  expect(result.message.content).not.toContain("mesmo problema");
  expect(result.payload.options).toBeUndefined();
  expect(await f.db.ticketOperation.count()).toBe(0);
});

test.each(["ticketUpdate", "duplicate"])(
  "%s não autoriza complementar e-mail exibido apenas em pergunta não respondida sobre monitor",
  async (mode) => {
    const email = await services.ticketService.get(f.bruno, "INC-20315");
    const monitor = {
      ...complete,
      title: "Monitor não liga",
      description:
        "Monitor não liga desde hoje cedo. Cabo de força trocado sem sucesso.",
      category: "HARDWARE" as const,
      sameDayCommitment: null,
      duplicate: null,
    };
    // Histórico anterior à correção: o candidato incompatível foi exibido, não escolhido.
    await f.db.message.create({
      data: {
        conversationId: f.otherConversationId,
        role: "EMPLOYEE",
        content:
          "Meu monitor não liga desde hoje cedo. Já troquei o cabo de força e nada. Só eu estou afetado e não consigo trabalhar.",
      },
    });
    await f.db.message.create({
      data: {
        conversationId: f.otherConversationId,
        role: "AGENT",
        content: "Algum destes chamados trata do mesmo problema?",
        payload: {
          pendingProposal: monitor,
          tickets: [JSON.parse(JSON.stringify(email))],
          options: [
            {
              label: "INC-20315 · E-mail indisponível para a equipe comercial",
              value: "É o mesmo problema do INC-20315",
            },
            {
              label: "É outro problema",
              value: "É outro problema, diferente desses chamados",
            },
          ],
        },
      },
    });
    const information =
      "O monitor continua sem ligar, testei em outra tomada e também não funcionou.";
    const result = await turn(
      information,
      {
        ...assessment,
        ...(mode === "ticketUpdate"
          ? { ticketUpdate: { number: "INC-20315" } }
          : {
              proposal: {
                ...monitor,
                description: information,
                duplicate: { relation: "same", number: "INC-20315" },
              },
            }),
      },
      undefined,
      { employeeId: f.bruno, conversationId: f.otherConversationId },
    );
    expect(result.record.appliedRules.join(" ")).toContain(
      "Alvo sugerido rejeitado",
    );
    expect(result.payload.draft).toMatchObject({
      kind: "CREATE",
      category: "HARDWARE",
      priority: "HIGH",
      description: information,
    });
    expect(result.payload.tickets).toBeUndefined();
    const stored = await f.db.ticketDraft.findUniqueOrThrow({
      where: { id: result.payload.draft!.id },
    });
    expect(stored.targetTicketId).toBeNull();
    await createChatDraftService(f.db)(
      f.bruno,
      f.otherConversationId,
      stored.id,
      "confirm",
    );
    expect(
      (await services.ticketService.get(f.bruno, "INC-20315"))?.description,
    ).toBe(email!.description);
    expect(
      await f.db.ticketOperation.count({ where: { kind: "UPDATE" } }),
    ).toBe(0);
  },
);

test("sem busca de artigos não substitui uma pergunta contextual por contingência da central", async () => {
  const result = await turn("Quero acrescentar informações ao meu chamado", {
    ...assessment,
    answer: "Qual informação você quer acrescentar?",
  });
  expect(result.message.content).toBe("Qual informação você quer acrescentar?");
});

test("candidato plausível só recebe complemento depois da seleção do funcionário", async () => {
  const original = await f.db.ticket.findUniqueOrThrow({
    where: { number: "INC-20311" },
  });
  const information = "Testei reiniciar o notebook, mas continua lento.";
  const result = await turn(
    information,
    {
      ...assessment,
      ticketUpdate: { number: original.number },
      proposal: { ...complete, title: original.title, category: "HARDWARE" },
    },
    { name: "find_duplicate_candidates", input: {} },
  );
  expect(result.payload.draft).toBeUndefined();
  expect(
    result.payload.options?.some(
      (option) => option.value === `É o mesmo problema do ${original.number}`,
    ),
  ).toBe(true);
  const selected = await turn(`É o mesmo problema do ${original.number}`);
  expect(selected.model.doGenerateCalls).toHaveLength(0);
  expect(selected.payload.draft).toMatchObject({
    kind: "UPDATE",
    description: information,
    category: original.category,
    priority: original.priority,
    impact: original.impact,
  });
  expect(selected.message.content).not.toContain("Quem está sendo afetado");
});

test.each(["INC-20315", "INC-20150", "INC-999999"])(
  "complemento %s não permite alvo alheio, resolvido ou inexistente",
  async (number) => {
    const result = await turn(
      `No ${number}, testei outra tomada e não funcionou.`,
      {
        ...assessment,
        ticketUpdate: { number },
      },
    );
    expect(result.payload.draft).toBeUndefined();
    expect(result.message.content).toContain(
      "Não encontrei esse chamado ativo entre os seus",
    );
    expect(await f.db.ticketDraft.count()).toBe(0);
  },
);

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

test.each(["INC-20312", "INC-20150", null])(
  "seleção de duplicidade %s não depende de proposal.duplicate nem repete pergunta",
  async (number) => {
    const first = await turn(
      "A VPN continua sem conectar ao SAP. Quero registrar um chamado.",
      {
        ...assessment,
        proposal: {
          ...complete,
          duplicate: null,
          possibleRelatedNumbers: ["INC-20150"],
        },
      },
    );
    expect(first.message.content).toContain("Algum destes chamados");
    const selected = await turn(
      number
        ? `É o mesmo problema do ${number}`
        : "É outro problema, diferente desses chamados",
      { ...assessment, proposal: null },
    );
    expect(selected.model.doGenerateCalls).toHaveLength(0);
    expect(selected.payload.draft?.kind).toBe(
      number === null ? "CREATE" : number === "INC-20150" ? "REOPEN" : "UPDATE",
    );
    expect(selected.message.content).not.toContain("Algum destes chamados");
  },
);

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

test.each(["rh", "financeiro", "facilities"])(
  "escopo %s impede consultas propostas antes de executar qualquer busca",
  async (intent) => {
    const help = await import("@/services/help-center");
    const search = vi.spyOn(help, "searchHelpCenter");
    const result = await turn("Como faço para pedir férias?", {
      ...assessment,
      understanding: { intent, summary: "Pedido administrativo" },
      consultationPlan: [{ tool: "search_help_center", query: "pedir férias" }],
    });
    expect(search).not.toHaveBeenCalled();
    expect(result.record.consultations).toEqual([]);
    expect(result.record.decision).toBe("redirecionar");
    expect(result.model.doGenerateCalls).toHaveLength(1);
  },
);

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
