import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed-data";
import type { DecisionRecord } from "./decisions";

let directory: string;
let db: PrismaClient;
let employeeId: string;
let conversationId: string;
let respond: (typeof import("./help-center"))["respondToConversation"];
let search: typeof import("@/services/help-center");

const assessment = {
  understanding: { intent: "ti", summary: "Consulta sobre VPN" },
  confidence: "alta",
  reason: "O artigo descreve o erro informado.",
  answer: "Pode informar mais detalhes?",
};
const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };

function text(object: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(object) }],
    finishReason: "stop" as const,
    usage,
    warnings: [],
  };
}

function tool(query: string) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: "search-1",
        toolName: "search_help_center",
        input: JSON.stringify({ query }),
      },
    ],
    finishReason: "tool-calls" as const,
    usage,
    warnings: [],
  };
}

function modelFor(query: string, confidence = "alta") {
  return new MastraLanguageModelV2Mock({
    doGenerate: [
      tool(query),
      text({
        ...assessment,
        confidence,
        answer:
          "Consulte o portal de softwares para reinstalar a VPN no Windows 10.",
        consultations: [{ tool: "invented" }],
        executedActions: ["criou chamado"],
        decision: "criou_chamado",
      }),
    ],
  });
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nexo-agent-test-"));
  const databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  await seedDatabase(db);
  employeeId = (
    await db.user.findUniqueOrThrow({
      where: { email: "ana.souza@nexo.com.br" },
    })
  ).id;
  vi.doMock("@/lib/db", () => ({ db }));
  respond = (await import("./help-center")).respondToConversation;
  search = await import("@/services/help-center");
}, 30_000);

beforeEach(async () => {
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  const conversation = await db.conversation.create({
    data: {
      employeeId,
      messages: {
        create: {
          role: "EMPLOYEE",
          authorId: employeeId,
          content: "VPN com erro 809 no Windows 10",
        },
      },
    },
  });
  conversationId = conversation.id;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Rede proibida nos testes do agent.");
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.$disconnect();
  vi.doUnmock("@/lib/db");
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("registra a busca real como consulta, sem atribuir ações de alteração de estado", async () => {
  const model = modelFor("VPN erro 809");
  const message = await respond(employeeId, conversationId, model);
  const record = message.decisionRecord as unknown as DecisionRecord;
  expect(record.consultations).toHaveLength(1);
  expect(record.consultations[0]).toMatchObject({
    tool: "search_help_center",
    input: { query: "VPN erro 809" },
    result: { status: "success" },
  });
  expect(record.consultations[0].result.summary).toContain("VPN com erro 809");
  expect(record.executedActions).toEqual([]);
  expect(record.decision).toBe("orientar_com_artigos");
  expect(record.confidence).toBe("alta");
  expect(JSON.stringify(record)).not.toContain("invented");
  expect(JSON.stringify(record)).not.toContain("criou chamado");
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(model.doGenerateCalls[0].responseFormat?.type).not.toBe("json");
  expect(model.doGenerateCalls[1].responseFormat?.type).toBe("json");
  expect(model.doGenerateCalls[1].tools ?? []).toEqual([]);
  expect(model.doGenerateCalls[1].toolChoice).toEqual({ type: "none" });
  expect(
    model.doGenerateCalls[1].prompt.some((message) => message.role === "tool"),
  ).toBe(false);
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
    "VPN com erro 809",
  );
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
    "Windows 10",
  );
  expect(fetch).not.toHaveBeenCalled();
  await db.$disconnect();
  const saved = await db.message.findFirstOrThrow({
    where: { id: message.id, conversation: { employeeId } },
  });
  expect(saved.decisionRecord).toEqual(record);
});

test.each(["alta", "média", "baixa"])(
  "busca vazia nunca permite segurança alta: modelo declarou %s",
  async (confidence) => {
    const message = await respond(
      employeeId,
      conversationId,
      modelFor("zqxw inexistente", confidence),
    );
    const record = message.decisionRecord as unknown as DecisionRecord;
    expect(record.consultations[0].result.articleIds).toEqual([]);
    expect(record.executedActions).toHaveLength(confidence === "baixa" ? 1 : 0);
    expect(record.confidence).toBe(
      confidence === "alta" ? "média" : confidence,
    );
    expect(record.decision).toBe(
      confidence === "baixa" ? "transferir" : "pedir_detalhes",
    );
    expect(message.content).toContain(
      confidence === "baixa"
        ? "Encaminhei"
        : "Não tenho informações suficientes",
    );
    if (confidence === "alta")
      expect(record.appliedRules).toContain(
        "Sem artigo relevante consultado, a segurança é limitada a média.",
      );
  },
);

test.each(["rh", "financeiro", "facilities"])(
  "redireciona %s sem executar ferramentas",
  async (intent) => {
    const searchSpy = vi.spyOn(search, "searchHelpCenter");
    const model = new MastraLanguageModelV2Mock({
      doGenerate: text({
        ...assessment,
        understanding: { intent, summary: "Solicitação fora de TI" },
      }),
    });
    const message = await respond(employeeId, conversationId, model);
    const record = message.decisionRecord as unknown as DecisionRecord;
    expect(record.decision).toBe("redirecionar");
    expect(record.consultations).toEqual([]);
    expect(record.executedActions).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].toolChoice).toEqual({ type: "auto" });
    expect(message.content).toContain("Esse assunto deve ser tratado");
  },
);

test("usa o histórico persistido explicitamente e não inclui outras conversas", async () => {
  await db.message.create({
    data: {
      conversationId,
      role: "EMPLOYEE",
      authorId: employeeId,
      content: "Já tentei reiniciar o computador.",
    },
  });
  await db.conversation.create({
    data: {
      employeeId,
      messages: {
        create: { role: "EMPLOYEE", content: "Informação de outra conversa" },
      },
    },
  });
  const model = modelFor("VPN erro 809");
  await respond(employeeId, conversationId, model);
  const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
  expect(prompt).toContain("VPN com erro 809 no Windows 10");
  expect(prompt).toContain("Já tentei reiniciar o computador.");
  expect(prompt).not.toContain("Informação de outra conversa");
});

test("não inventa consulta quando o modelo deixa de chamar a ferramenta", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: [text({ ...assessment, answer: "Consultei tudo e resolvi." })],
  });
  const message = await respond(employeeId, conversationId, model);
  const record = message.decisionRecord as unknown as DecisionRecord;
  expect(record.consultations).toEqual([]);
  expect(record.executedActions).toEqual([]);
  expect(record.confidence).toBe("média");
  expect(message.content).not.toContain("resolvi");
});

test("registra falha da ferramenta sem anunciar execução bem-sucedida", async () => {
  vi.spyOn(search, "searchHelpCenter").mockRejectedValueOnce(
    new Error("Banco indisponível"),
  );
  const message = await respond(
    employeeId,
    conversationId,
    modelFor("VPN erro 809"),
  );
  const record = message.decisionRecord as unknown as DecisionRecord;
  expect(record.consultations[0].result.status).toBe("error");
  expect(record.executedActions).toEqual([]);
  expect(record.confidence).not.toBe("alta");
});

test("não executa o modelo para conversa de outro funcionário ou pausada", async () => {
  const model = modelFor("VPN erro 809");
  await expect(
    respond("outro-funcionario", conversationId, model),
  ).rejects.toThrow("Conversa não encontrada.");
  await db.conversation.updateMany({
    where: { id: conversationId, employeeId },
    data: { status: "ANALYST" },
  });
  await expect(respond(employeeId, conversationId, model)).rejects.toThrow(
    "O agent não está atendendo",
  );
  expect(model.doGenerateCalls).toHaveLength(0);
});

test("mensagem indefinida com segurança baixa não transfere", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: text({
      ...assessment,
      understanding: { intent: "indefinido", summary: "Pedido sem detalhes" },
      confidence: "baixa",
    }),
  });
  const message = await respond(employeeId, conversationId, model);
  const record = message.decisionRecord as unknown as DecisionRecord;
  expect(record.decision).toBe("pedir_detalhes");
  expect(record.confidence).toBe("baixa");
  expect(record.consultations).toEqual([]);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("não persiste resposta se o analista assumir durante a geração", async () => {
  let step = 0;
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      step += 1;
      if (step === 1) return tool("VPN erro 809");
      await db.conversation.updateMany({
        where: { id: conversationId, employeeId },
        data: { status: "ANALYST" },
      });
      return text({
        ...assessment,
        answer: "Resposta que não deve ser enviada.",
      });
    },
  });
  await expect(respond(employeeId, conversationId, model)).rejects.toThrow(
    "A conversa não está mais com o agent.",
  );
  expect(
    await db.message.count({ where: { conversationId, role: "AGENT" } }),
  ).toBe(0);
});

test("não persiste resposta obsoleta quando outra aba envia durante a geração", async () => {
  let calls = 0;
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      if (++calls === 1) return tool("VPN erro 809");
      await db.message.create({
        data: {
          conversationId,
          authorId: employeeId,
          role: "EMPLOYEE",
          content: "Atualização enviada em outra aba",
        },
      });
      return text(assessment);
    },
  });
  await expect(respond(employeeId, conversationId, model)).rejects.toThrow(
    "novas mensagens",
  );
  expect(
    await db.message.count({ where: { conversationId, role: "AGENT" } }),
  ).toBe(0);
  expect(
    await db.message.count({ where: { conversationId, role: "EMPLOYEE" } }),
  ).toBe(2);
});

test.each(["json", "schema"])(
  "persiste contingência após duas respostas inválidas: %s",
  async (kind) => {
    const invalid =
      kind === "schema"
        ? text({ answer: 42 })
        : {
            ...text({}),
            content: [{ type: "text" as const, text: "isto não é JSON" }],
          };
    const model = new MastraLanguageModelV2Mock({
      doGenerate: [tool("VPN erro 809"), invalid, invalid],
    });
    const message = await respond(employeeId, conversationId, model);
    const record = message.decisionRecord as unknown as DecisionRecord;
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(record).toMatchObject({
      decision: "indisponivel",
      confidence: "baixa",
      executedActions: [],
    });
    expect(record.reason).toContain("duas tentativas");
    expect(record.consultations).toHaveLength(1);
    expect(message.content).toContain("Tentar novamente");
    expect(
      (
        await db.conversation.findUniqueOrThrow({
          where: { id: conversationId },
        })
      ).status,
    ).toBe("AGENT");
    expect(
      (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
        .decisionRecord,
    ).toEqual(record);
  },
);

test("recupera resposta fora do schema em uma nova tentativa", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: [
      tool("VPN erro 809"),
      text({ answer: 42 }),
      text({ ...assessment, answer: "Qual versão do Windows você utiliza?" }),
    ],
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(3);
  expect(model.doGenerateCalls[2].tools ?? []).toEqual([]);
  expect(model.doGenerateCalls[2].responseFormat?.type).toBe("json");
  expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain(
    "VPN com erro 809",
  );
  expect(message.content).toContain("Reinstale o cliente de VPN");
  expect((message.decisionRecord as unknown as DecisionRecord).confidence).toBe(
    "alta",
  );
});

test("falha de transporte não dispara retry e persiste segurança baixa", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      throw new Error("Provedor indisponível");
    },
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(message.decisionRecord).toMatchObject({
    confidence: "baixa",
    decision: "indisponivel",
    consultations: [],
  });
});

test("resposta direta inválida tenta novamente sem consultar artigos", async () => {
  const model = new MastraLanguageModelV2Mock({ doGenerate: text({}) });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(message.decisionRecord).toMatchObject({
    confidence: "baixa",
    consultations: [],
    decision: "indisponivel",
  });
});

test("timeout cancela a chamada e registra contingência", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async ({ abortSignal }) => {
      return new Promise((_, reject) => {
        abortSignal!.addEventListener(
          "abort",
          () => reject(abortSignal!.reason),
          { once: true },
        );
      });
    },
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(message.decisionRecord).toMatchObject({
    confidence: "baixa",
    reason: expect.stringContaining(
      "O modelo excedeu seu orçamento de 18 segundos",
    ),
    consultations: [],
  });
}, 30_000);

test.each([
  "monitor não liga",
  "impressora não imprime",
  "não consigo acessar o e-mail",
])(
  "trata o cenário concreto %s como TI e preserva a consulta real",
  async (problem) => {
    await db.message.updateMany({
      where: { conversationId, role: "EMPLOYEE" },
      data: { content: problem },
    });
    const model = new MastraLanguageModelV2Mock({
      doGenerate: [
        tool(problem),
        text({
          ...assessment,
          understanding: { intent: "ti", summary: problem },
        }),
      ],
    });
    const message = await respond(employeeId, conversationId, model);
    const record = message.decisionRecord as unknown as DecisionRecord;
    expect(record.understanding.intent).toBe("ti");
    expect(record.consultations).toHaveLength(1);
    expect(record.consultations[0].input.query).toBe(problem);
    expect(record.executedActions).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain(
      "Defeitos concretos são TI mesmo sem detalhes de diagnóstico",
    );
    expect(prompt).toContain(
      "indefinido somente para mensagens sem problema identificável",
    );
    expect(prompt).toContain(problem);
  },
);

test.each([429, 503])(
  "repete uma vez HTTP %s após 1s e registra sem repetir a busca",
  async (statusCode) => {
    let calls = 0;
    const times: number[] = [];
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        times.push(performance.now());
        calls++;
        if (calls === 1) return tool("VPN erro 809");
        if (calls === 2)
          throw Object.assign(new Error("Indisponível"), {
            statusCode,
            isRetryable: true,
          });
        return text(assessment);
      },
    });
    const message = await respond(employeeId, conversationId, model);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(950);
    expect(times[2] - times[1]).toBeLessThan(2_500);
    const record = message.decisionRecord as unknown as DecisionRecord;
    expect(record.modelRetries).toEqual([
      { stage: "answer", statusCode, delayMs: 1_000, outcome: "succeeded" },
    ]);
    expect(record.consultations).toHaveLength(1);
    expect(record.executedActions).toEqual([]);
  },
);

test("limita retry de indisponibilidade a um por mensagem, mesmo em etapas diferentes", async () => {
  let calls = 0;
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      if (++calls === 2) return tool("VPN erro 809");
      throw Object.assign(new Error("Indisponível"), {
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(3);
  expect(message.decisionRecord).toMatchObject({
    modelFailure: "unavailable",
    confidence: "baixa",
    modelRetries: [{ stage: "initial", outcome: "succeeded" }],
  });
});

test("registra retry esgotado e persiste a resposta de contingência", async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      throw Object.assign(new Error("Indisponível"), {
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(message.decisionRecord).toMatchObject({
    modelFailure: "unavailable",
    confidence: "baixa",
    modelRetries: [{ statusCode: 503, outcome: "failed" }],
  });
  expect(
    (await db.conversation.findUniqueOrThrow({ where: { id: conversationId } }))
      .status,
  ).toBe("AGENT");
  const recovered = await respond(
    employeeId,
    conversationId,
    modelFor("VPN erro 809"),
  );
  expect(
    (recovered.decisionRecord as unknown as DecisionRecord).modelFailure,
  ).toBeUndefined();
  expect(
    await db.message.count({ where: { conversationId, role: "EMPLOYEE" } }),
  ).toBe(1);
});

test.each([400, 401, 403, 500])("não repete HTTP %s", async (statusCode) => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      throw Object.assign(new Error("Erro"), { statusCode, isRetryable: true });
    },
  });
  const message = await respond(employeeId, conversationId, model);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(message.decisionRecord).toMatchObject({
    modelRetries: [],
    modelFailure: "unavailable",
  });
});

test("a busca ignora consultas genéricas e encontra títulos com acentos", async () => {
  expect(
    await search.searchHelpCenter("preciso de ajuda com meu problema"),
  ).toEqual([]);
  const articles = await search.searchHelpCenter("horario service desk");
  expect(articles[0].title).toBe("Horário do service desk");
});
