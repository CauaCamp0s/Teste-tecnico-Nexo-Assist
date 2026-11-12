import { z } from "zod";

export const assessmentSchema = z.object({
  understanding: z.object({
    intent: z.enum(["ti", "rh", "financeiro", "facilities", "indefinido"]),
    summary: z.string().min(1),
  }),
  confidence: z.enum(["alta", "média", "baixa"]),
  reason: z.string().min(1),
});

export const answerSchema = assessmentSchema.extend({
  answer: z.string().min(1),
});

export type Consultation = {
  tool: "search_help_center";
  input: { query: string };
  result: {
    articleIds: string[];
    summary: string;
    status: "success" | "error";
  };
};

export type DecisionRecord = {
  understanding: z.infer<typeof assessmentSchema>["understanding"];
  consultations: Consultation[];
  decision: "orientar_com_artigos" | "pedir_detalhes" | "redirecionar";
  executedActions: [];
  confidence: z.infer<typeof assessmentSchema>["confidence"];
  reason: string;
  appliedRules: string[];
  modelRetries?: ModelRetry[];
  modelFailure?: "timeout" | "invalid_response" | "unavailable";
};

export type ModelRetry = {
  stage: "initial" | "answer" | "recovery";
  statusCode: 429 | 503;
  delayMs: number;
  outcome: "pending" | "succeeded" | "failed" | "aborted";
};

export function buildDecisionRecord(
  assessment: z.infer<typeof assessmentSchema>,
  consultations: Consultation[],
): DecisionRecord {
  const outsideScope = ["rh", "financeiro", "facilities"].includes(
    assessment.understanding.intent,
  );
  const hasArticles = consultations.some(
    (query) =>
      query.result.status === "success" && query.result.articleIds.length > 0,
  );
  const appliedRules: string[] = [];
  let confidence = assessment.confidence;

  // Evidência ausente impede segurança alta, mesmo que o modelo a declare.
  if (!outsideScope && !hasArticles && confidence === "alta") {
    confidence = "média";
    appliedRules.push(
      "Sem artigo relevante consultado, a segurança é limitada a média.",
    );
  }
  if (outsideScope)
    appliedRules.push(
      "Assuntos fora de TI são redirecionados sem consultar a central de ajuda.",
    );

  return {
    understanding: assessment.understanding,
    consultations,
    decision: outsideScope
      ? "redirecionar"
      : hasArticles && confidence !== "baixa"
        ? "orientar_com_artigos"
        : "pedir_detalhes",
    executedActions: [],
    confidence,
    reason: assessment.reason,
    appliedRules,
  };
}
