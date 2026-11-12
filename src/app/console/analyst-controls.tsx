import type { ConversationStatus } from "@prisma/client";
export type AnalystAction = "assume" | "reply" | "return" | "close";
export const conversationLabels: Record<ConversationStatus, string> = {
  AGENT: "Com o assistente",
  WAITING_FOR_ANALYST: "Aguardando atendente",
  ANALYST: "Com analista",
  CLOSED: "Encerrada",
};

export function AnalystControls({
  status,
  assignedId,
  analystId,
  busy,
  onAction,
}: {
  status: ConversationStatus;
  assignedId: string | null;
  analystId: string;
  busy: boolean;
  onAction: (action: AnalystAction) => void;
}) {
  if (status === "WAITING_FOR_ANALYST")
    return (
      <button type="button" disabled={busy} onClick={() => onAction("assume")}>
        Assumir atendimento
      </button>
    );
  if (status === "ANALYST" && assignedId === analystId)
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("return")}
        >
          Devolver ao agent
        </button>
        <button type="button" disabled={busy} onClick={() => onAction("close")}>
          Encerrar atendimento
        </button>
      </>
    );
  return (
    <span>
      {conversationLabels[status]}
      {assignedId && assignedId !== analystId ? " · outro responsável" : ""}
    </span>
  );
}
