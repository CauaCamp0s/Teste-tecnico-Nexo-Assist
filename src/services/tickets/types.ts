export {
  TicketType,
  TicketCategory,
  TicketStatus,
  TicketPriority,
  TicketImpact,
} from "@prisma/client";
import type {
  TicketCategory,
  TicketImpact,
  TicketPriority,
  TicketStatus,
  TicketType,
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

export type EmployeeTicket = TicketSla & {
  id: string;
  number: string;
  employeeId: string;
  type: TicketType;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  impact: TicketImpact;
  title: string;
  description: string;
  createdAt: Date;
  lastUpdatedAt: Date | null;
  resolvedAt: Date | null;
};

export type TicketListOptions = {
  statuses?: readonly TicketStatus[];
};

export type TicketContent = Pick<
  EmployeeTicket,
  "title" | "description" | "type" | "category" | "priority" | "impact"
>;

export interface TicketService {
  findDuplicateCandidates(employeeId: string): Promise<EmployeeTicket[]>;
  list(
    employeeId: string,
    options?: TicketListOptions,
  ): Promise<EmployeeTicket[]>;
  get(employeeId: string, number: string): Promise<EmployeeTicket | null>;
  create(
    employeeId: string,
    content: TicketContent,
    idempotencyKey: string,
  ): Promise<EmployeeTicket>;
  addUpdate(
    employeeId: string,
    number: string,
    content: TicketContent,
    idempotencyKey: string,
  ): Promise<EmployeeTicket>;
  reopen(
    employeeId: string,
    number: string,
    content: TicketContent,
    idempotencyKey: string,
  ): Promise<EmployeeTicket>;
}
