import type { EmployeeTicket } from "./tickets/types";

export type TicketCard = Omit<
  EmployeeTicket,
  "createdAt" | "lastUpdatedAt" | "resolvedAt" | "dueAt"
> & {
  createdAt: string;
  lastUpdatedAt: string | null;
  resolvedAt: string | null;
  dueAt: string | null;
};
export type DraftCard = {
  failureCode?: string | null;
  id: string;
  kind: "CREATE" | "UPDATE" | "REOPEN";
  title: string;
  description: string;
  type: string;
  category: string;
  priority: string;
  impact: string;
  dueAt: string | null;
  status: "PENDING" | "CONFIRMED" | "CANCELED" | "FAILED";
};
export type ChatPayload = {
  options?: { label: string; value: string }[];
  tickets?: TicketCard[];
  draft?: DraftCard;
};

export function ticketCard(ticket: EmployeeTicket): TicketCard {
  return {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    lastUpdatedAt: ticket.lastUpdatedAt?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    dueAt: ticket.dueAt?.toISOString() ?? null,
  };
}
export const statusLabels: Record<string, string> = {
  OPEN: "Aberto",
  WAITING_FOR_ANALYST: "Aguardando analista",
  IN_PROGRESS: "Em andamento",
  APPROVED: "Aprovado",
  RESOLVED: "Resolvido",
  CLOSED: "Encerrado",
};
export const priorityLabels: Record<string, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};
export const categoryLabels: Record<string, string> = {
  ACCESS: "Acesso",
  NETWORK_VPN: "Rede e VPN",
  HARDWARE: "Hardware",
  SOFTWARE: "Software",
  EMAIL: "E-mail",
  OTHER: "Outros",
};
export const impactLabels: Record<string, string> = {
  SELF: "Somente você",
  TEAM: "Sua equipe",
  COMPANY: "Toda a empresa",
};
