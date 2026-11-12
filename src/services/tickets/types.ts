export {
  TicketType,
  TicketCategory,
  TicketStatus,
  TicketPriority,
  TicketImpact,
} from "@prisma/client";
import type {
  TicketImpact,
  TicketPriority,
  TicketStatus,
} from "@prisma/client";

export type PriorityContext = {
  impact: TicketImpact;
  interruption: "stopped" | "degraded" | "none";
  sameDayCommitment: boolean;
};

export type TicketSlaSource = {
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
  lastUpdatedAt: Date | null;
};

export type TicketSla = {
  dueAt: Date | null;
  isOverdue: boolean;
};
