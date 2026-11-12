import type { PriorityContext, TicketPriority } from "./types";

export function classifyTicketPriority(context: PriorityContext): {
  priority: TicketPriority;
  reason: string;
} {
  if (context.interruption === "stopped" && context.impact !== "SELF") {
    return {
      priority: "CRITICAL",
      reason: "Algo parado para uma equipe ou para a empresa.",
    };
  }
  if (context.interruption === "stopped" || context.sameDayCommitment) {
    return {
      priority: "HIGH",
      reason:
        "Impede uma pessoa de trabalhar ou há compromisso em risco no mesmo dia.",
    };
  }
  if (context.interruption === "degraded") {
    return {
      priority: "MEDIUM",
      reason: "Atrapalha o trabalho, mas há alternativa.",
    };
  }
  return { priority: "LOW", reason: "Pedido ou melhoria sem urgência." };
}
