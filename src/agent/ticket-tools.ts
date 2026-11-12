import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TicketService, EmployeeTicket } from "@/services/tickets/types";
import { TicketUnavailableError } from "@/services/tickets/errors";
import type { Consultation, DecisionRecord } from "./decisions";
import { ticketCard, type ChatPayload } from "@/services/chat-payload";

export function createEmployeeTicketTools(
  employeeId: string,
  service: TicketService,
  consultations: Consultation[],
  results: unknown[],
) {
  let observed: EmployeeTicket[] | undefined;
  let unavailable = false;
  async function consult(tool: "list_tickets" | "get_ticket", number?: string) {
    try {
      const tickets = number
        ? [await service.get(employeeId, number)].filter(
            (t): t is EmployeeTicket => !!t,
          )
        : await service.list(employeeId);
      observed = tickets;
      consultations.push({
        tool,
        input: number ? { number } : {},
        result: {
          status: "success",
          articleIds: [],
          summary: tickets.length
            ? tickets
                .map(
                  (t) =>
                    `${t.number}: ${t.title}, ${t.status}, prazo ${t.dueAt?.toISOString() ?? "não pendente"}${t.isOverdue ? ", vencido" : ""}`,
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
        input: number ? { number } : {},
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
          "Lista somente os chamados do funcionário autenticado. Use para consulta sem número.",
        inputSchema: z.object({}),
        execute: () => consult("list_tickets"),
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
        payload.options = observed.map((t) => ({
          label: `${t.number} · ${t.title}`,
          value: t.number,
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
          content: `O prazo do chamado ${ticket.number} está vencido. Quer que eu chame um analista?`,
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
