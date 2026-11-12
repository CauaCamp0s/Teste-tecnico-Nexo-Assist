import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TicketService, EmployeeTicket } from "@/services/tickets/types";
import { TicketUnavailableError } from "@/services/tickets/errors";
import type { Consultation, DecisionRecord } from "./decisions";
import {
  ticketCard,
  priorityLabels,
  type ChatPayload,
} from "@/services/chat-payload";

export function overdueExplanation(ticket: EmployeeTicket, now = new Date()) {
  const elapsed = Math.max(
    0,
    now.getTime() - (ticket.lastUpdatedAt ?? ticket.createdAt).getTime(),
  );
  const days = Math.floor(elapsed / 86400000);
  const hours = Math.floor(elapsed / 3600000);
  const age =
    days >= 1
      ? `${days} ${days === 1 ? "dia" : "dias"}`
      : hours >= 1
        ? `${hours} ${hours === 1 ? "hora" : "horas"}`
        : "menos de uma hora";
  const sla = {
    CRITICAL: "1 hora corrida",
    HIGH: "4 horas úteis",
    MEDIUM: "3 dias úteis",
    LOW: "5 dias úteis",
  }[ticket.priority];
  return `O chamado ${ticket.number} está sem atualização há ${age}, acima do prazo de ${sla} para prioridade ${priorityLabels[ticket.priority].toLocaleLowerCase("pt-BR")}. Quer que eu chame um analista?`;
}

export function createEmployeeTicketTools(
  employeeId: string,
  service: TicketService,
  consultations: Consultation[],
  results: unknown[],
) {
  let observed: EmployeeTicket[] | undefined;
  let unavailable = false;
  async function consult(
    tool: "list_tickets" | "get_ticket",
    number?: string,
    subject?: string,
  ) {
    try {
      const tickets = number
        ? [await service.get(employeeId, number)].filter(
            (ticket): ticket is EmployeeTicket => !!ticket,
          )
        : await service.list(employeeId, {
            statuses: [
              "OPEN",
              "WAITING_FOR_ANALYST",
              "IN_PROGRESS",
              "APPROVED",
            ],
            subject,
          });
      observed = tickets;
      consultations.push({
        tool,
        input: number ? { number } : subject ? { subject } : {},
        result: {
          status: "success",
          articleIds: [],
          summary: tickets.length
            ? tickets
                .map(
                  (ticket) =>
                    `${ticket.number}: ${ticket.title}, ${ticket.status}, prazo ${ticket.dueAt?.toISOString() ?? "não pendente"}${ticket.isOverdue ? ", vencido" : ""}`,
                )
                .join("; ")
            : "Nenhum chamado próprio encontrado.",
        },
      });
      const result = { tickets: tickets.map(ticketCard) };
      results.push(result);
      return result;
    } catch (error) {
      if (!(error instanceof TicketUnavailableError)) throw error;
      unavailable = true;
      consultations.push({
        tool,
        input: number ? { number } : subject ? { subject } : {},
        result: {
          status: "error",
          articleIds: [],
          summary: "Serviço de chamados indisponível após três tentativas.",
        },
      });
      const result = { unavailable: true };
      results.push(result);
      return result;
    }
  }
  return {
    tools: {
      list_tickets: createTool({
        id: "list_tickets",
        description:
          "Lista chamados ativos (não resolvidos nem encerrados) do funcionário autenticado. Sem número, extraia subject do assunto informado, por exemplo notebook. Busca em título e descrição.",
        inputSchema: z.object({
          subject: z.string().trim().min(1).max(200).optional(),
        }),
        execute: ({ subject }) => consult("list_tickets", undefined, subject),
      }),
      get_ticket: createTool({
        id: "get_ticket",
        description:
          "Obtém um chamado próprio pelo número, inclusive seleção anterior.",
        inputSchema: z.object({ number: z.string().regex(/^(INC|REQ)-\d+$/i) }),
        execute: ({ number }) => consult("get_ticket", number),
      }),
    },
    presentation(
      record: DecisionRecord,
    ): { content: string; payload: ChatPayload } | undefined {
      if (unavailable) {
        record.decision = "indisponivel";
        return {
          content:
            "O serviço de chamados está indisponível. Não consegui consultar seus chamados. Tente novamente em instantes.",
          payload: {},
        };
      }
      if (!observed) return;
      record.decision = "consultar_chamados";
      record.appliedRules.push(
        "Privacidade: consultas restritas ao funcionário da sessão.",
        "Prazo calculado no servidor em America/Sao_Paulo; vencido somente após o limite do SLA.",
      );
      const payload: ChatPayload = { tickets: observed.map(ticketCard) };
      if (observed.length > 1) {
        payload.options = observed.map((ticket) => ({
          label: `${ticket.number} · ${ticket.title}`,
          value: ticket.number,
        }));
        return {
          content: "Encontrei estes chamados. Sobre qual deles quer saber?",
          payload,
        };
      }
      if (!observed.length)
        return {
          content: "Não encontrei esse chamado entre os seus chamados.",
          payload,
        };
      const ticket = observed[0];
      if (ticket.isOverdue) {
        record.decision = "oferecer_transferencia";
        record.appliedRules.push(
          "Chamado vencido: informar o atraso e oferecer atendimento humano, aguardando aceite.",
        );
        payload.options = [
          {
            label: "Falar com um analista",
            value: `Quero falar com um analista sobre ${ticket.number}`,
          },
          {
            label: "Adicionar informação",
            value: `Quero adicionar informação ao ${ticket.number}`,
          },
          { label: "Não, obrigado", value: "Não quero transferir agora" },
        ];
        return {
          content: overdueExplanation(ticket),
          payload,
        };
      }
      return {
        content: `Aqui estão os dados atuais do chamado ${ticket.number}.`,
        payload,
      };
    },
  };
}
