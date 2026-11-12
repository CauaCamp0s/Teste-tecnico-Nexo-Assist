import {
  categoryLabels,
  impactLabels,
  priorityLabels,
  statusLabels,
} from "@/services/chat-payload";

export function formatDate(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(", ", " às ");
}

const labels: Record<string, string> = {
  ...categoryLabels,
  ...impactLabels,
  ...priorityLabels,
  ...statusLabels,
  CREATE: "criação",
  UPDATE: "complemento",
  REOPEN: "reabertura",
  stopped: "trabalho parado",
  degraded: "trabalho prejudicado, com alternativa",
  none: "sem interrupção",
};

// Somente apresentação: dados técnicos permanecem intactos no registro persistido.
export function readableDecisionText(value: string): string {
  return value
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
      (date) => formatDate(date),
    )
    .replace(/\bc[a-z0-9]{24,}\b/gi, "")
    .replace(
      /\b[A-Z_]+\b|\b(?:stopped|degraded|none)\b/g,
      (word) => labels[word] ?? word,
    )
    .replace(/ {2,}/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .trim();
}
