import type { Prisma } from "@prisma/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TicketService, EmployeeTicket } from "@/services/tickets/types";
import { TicketUnavailableError } from "@/services/tickets/errors";
import { createDraftService } from "@/services/tickets/drafts";
import { classifyTicketPriority } from "@/services/tickets/priority";
import { getTicketSla } from "@/services/tickets/sla";
import { assertCanReopen } from "@/services/tickets/reopening";
import { ticketCard, type ChatPayload } from "@/services/chat-payload";
import type { Consultation, DecisionRecord } from "./decisions";
import type { TicketProposal } from "./proposal";

export function createDraftFlow(
  employeeId: string,
  conversationId: string,
  tickets: TicketService,
  consultations: Consultation[],
  results: unknown[],
  clock: () => Date = () => new Date(),
) {
  let candidates: EmployeeTicket[] | undefined;
  let unavailable = false;
  async function lookup() {
    try {
      candidates = await tickets.findDuplicateCandidates(employeeId);
      consultations.push({
        tool: "find_duplicate_candidates",
        input: {},
        result: {
          status: "success",
          articleIds: [],
          summary:
            candidates
              .map(
                (ticket) =>
                  `${ticket.number}: ${ticket.title} (${ticket.status})`,
              )
              .join("; ") || "Nenhum candidato próprio.",
        },
      });
      const result = { candidates: candidates.map(ticketCard) };
      results.push(result);
      return result;
    } catch (error) {
      if (!(error instanceof TicketUnavailableError)) throw error;
      unavailable = true;
      consultations.push({
        tool: "find_duplicate_candidates",
        input: {},
        result: {
          status: "error",
          articleIds: [],
          summary:
            "Não foi possível verificar duplicidade: serviço indisponível.",
        },
      });
      return { unavailable: true };
    }
  }
  return {
    tool: createTool({
      id: "find_duplicate_candidates",
      description:
        "Consulta candidatos próprios antes de propor criar, complementar ou reabrir um chamado. Compare descrição e contexto, não apenas categoria.",
      inputSchema: z.object({}),
      execute: lookup,
    }),
    async prepare(
      proposal: TicketProposal,
      record: DecisionRecord,
      selected = false,
    ) {
      let existingUpdate: EmployeeTicket | undefined;
      if (
        proposal.duplicate?.relation === "same" &&
        proposal.duplicate.number &&
        proposal.description
      ) {
        if (candidates === undefined && !unavailable) await lookup();
        existingUpdate = candidates?.find(
          (ticket) =>
            ticket.number === proposal.duplicate!.number &&
            !["RESOLVED", "CLOSED"].includes(ticket.status),
        );
        if (existingUpdate) {
          proposal = {
            ...proposal,
            title: existingUpdate.title,
            type: existingUpdate.type,
            category: existingUpdate.category,
            impact: existingUpdate.impact,
          };
          record.appliedRules.push(
            "Complemento de chamado ativo: reutilizar título, tipo, categoria, impacto e prioridade; não repetir coleta de abertura.",
          );
        }
        if (unavailable) {
          record.decision = "indisponivel";
          return {
            content:
              "Não consegui consultar o chamado para preparar o complemento. Tente novamente em instantes.",
            payload: {} as ChatPayload,
          };
        }
        if (!existingUpdate && proposal.type === null) {
          record.decision = "pedir_detalhes";
          return {
            content:
              "Não encontrei esse chamado ativo entre os seus. Qual chamado você quer complementar?",
            payload: {} as ChatPayload,
          };
        }
      }
      const fields = [
        [
          "impact",
          "Quem está sendo afetado?",
          ["Só eu", "Minha equipe", "Toda a empresa", "Não sei"],
        ],
        [
          "interruption",
          "Como isso afeta o trabalho?",
          [
            "Não consigo trabalhar",
            "Atrapalha, mas há alternativa",
            "É um pedido sem interrupção",
          ],
        ],
        [
          "sameDayCommitment",
          "Há algum compromisso em risco ainda hoje?",
          ["Sim, tenho compromisso hoje", "Não há compromisso hoje"],
        ],
        ["description", "O que está acontecendo e desde quando?", []],
        ["title", "Qual problema você quer registrar?", []],
        [
          "type",
          "Algo deixou de funcionar ou é um novo pedido?",
          [
            "Algo deixou de funcionar",
            "Novo pedido de acesso, equipamento ou software",
          ],
        ],
        [
          "category",
          "A qual área de TI isso se refere?",
          ["Acesso", "Rede e VPN", "Hardware", "Software", "E-mail", "Outros"],
        ],
      ] as const;
      for (const [field, question, options] of fields) {
        if (
          existingUpdate &&
          (field === "interruption" || field === "sameDayCommitment")
        )
          continue;
        if (
          field === "sameDayCommitment" &&
          proposal.interruption === "stopped" &&
          proposal.sameDayCommitment === null
        ) {
          record.appliedRules.push(
            "Compromisso no mesmo dia não perguntado: interrupção total já determina prioridade alta ou crítica.",
          );
          continue;
        }
        if (proposal[field] === null || proposal[field] === "") {
          record.decision = "pedir_detalhes";
          record.appliedRules.push(
            `Abertura completa: falta ${field}; perguntar um dado por vez.`,
          );
          return {
            content: question,
            payload: {
              options: options.map((label) => ({ label, value: label })),
            } as ChatPayload,
          };
        }
      }
      const context = {
        impact: proposal.impact!,
        interruption: proposal.interruption!,
        sameDayCommitment: proposal.sameDayCommitment ?? false,
      };
      const classification = existingUpdate
        ? {
            priority: existingUpdate.priority,
            reason: "Prioridade do chamado existente preservada.",
          }
        : classifyTicketPriority(context);
      if (!existingUpdate)
        record.appliedRules.push(
          `Prioridade ${classification.priority}: ${classification.reason} Contexto: ${context.impact}, ${context.interruption}, compromisso hoje: ${proposal.sameDayCommitment === null ? "não necessário para classificação" : context.sameDayCommitment ? "sim" : "não"}.`,
        );
      const compared = candidates !== undefined;
      if (!compared && !unavailable) await lookup();
      if (unavailable) {
        record.decision = "indisponivel";
        return {
          content:
            "O serviço está indisponível. Não montei um rascunho porque ainda não consegui verificar duplicidade. Tente novamente em instantes.",
          payload: {},
        };
      }
      const match = candidates?.find(
        (ticket) => ticket.number === proposal.duplicate?.number,
      );
      if (
        proposal.duplicate?.relation === "same" &&
        proposal.duplicate.number &&
        !match
      ) {
        let target: EmployeeTicket | null;
        try {
          target = await tickets.get(employeeId, proposal.duplicate.number);
        } catch (error) {
          if (!(error instanceof TicketUnavailableError)) throw error;
          consultations.push({
            tool: "get_ticket",
            input: { number: proposal.duplicate.number },
            result: {
              status: "error",
              articleIds: [],
              summary: "Serviço indisponível ao validar alvo.",
            },
          });
          record.decision = "indisponivel";
          return {
            content:
              "Não consegui validar esse chamado porque o serviço está indisponível. Tente novamente em instantes.",
            payload: {},
          };
        }
        consultations.push({
          tool: "get_ticket",
          input: { number: proposal.duplicate.number },
          result: {
            status: "success",
            articleIds: [],
            summary: target
              ? `${target.number}: ${target.status}; fora dos candidatos elegíveis.`
              : "Nenhum chamado próprio encontrado.",
          },
        });
        record.decision = "pedir_detalhes";
        record.appliedRules.push(
          "Reabertura exige RESOLVED com resolução há no máximo 7 dias; alvo fora dos candidatos não autoriza criação automática.",
        );
        return {
          content: target
            ? "Esse chamado não pode ser reaberto na janela de até 7 dias. Quer preparar um novo chamado para este problema?"
            : "Não encontrei esse chamado entre os seus. Qual chamado você quer complementar?",
          payload: {
            options: target
              ? [
                  {
                    label: "Preparar novo chamado",
                    value:
                      "Quero um novo chamado, separado do anterior fora da janela de reabertura",
                  },
                ]
              : [],
          },
        };
      }
      if (
        candidates?.length &&
        ((!compared && !selected && proposal.duplicate?.relation !== "same") ||
          !proposal.duplicate ||
          proposal.duplicate.relation === "uncertain" ||
          (proposal.duplicate.relation === "same" && !match))
      ) {
        record.decision = "pedir_detalhes";
        record.appliedRules.push(
          "Correspondência incerta: perguntar antes de criar para evitar duplicidade.",
        );
        return {
          content: "Algum destes chamados trata do mesmo problema?",
          payload: {
            pendingProposal: proposal,
            tickets: candidates.map(ticketCard),
            options: [
              ...candidates.map((ticket) => ({
                label: `${ticket.number} · ${ticket.title}`,
                value: `É o mesmo problema do ${ticket.number}`,
              })),
              {
                label: "É outro problema",
                value: "É outro problema, diferente desses chamados",
              },
            ],
          },
        };
      }
      const target =
        proposal.duplicate?.relation === "same" ? match : undefined;
      const kind = target
        ? target.status === "RESOLVED"
          ? "REOPEN"
          : "UPDATE"
        : "CREATE";
      record.decision = "propor_rascunho";
      record.appliedRules.push(
        target
          ? kind === "REOPEN"
            ? "Mesmo problema resolvido há até 7 dias: oferecer reabertura mediante confirmação."
            : "Mesmo problema ativo: complementar, nunca duplicar."
          : "Nenhum candidato corresponde ao problema; propor criação após confirmação.",
      );
      return {
        content:
          kind === "REOPEN"
            ? `Posso reabrir ${target!.number}. Confira e confirme o rascunho.`
            : kind === "UPDATE"
              ? `O problema já está em ${target!.number}. Confira o complemento antes de confirmar.`
              : "Confira os dados antes de criar o chamado. O prazo definitivo será calculado na confirmação.",
        payload: {} as ChatPayload,
        persist: async (tx: Prisma.TransactionClient): Promise<ChatPayload> => {
          if (target) {
            const fresh = await tx.ticket.findFirst({
              where: { id: target.id, employeeId },
            });
            if (!fresh) throw new Error("Chamado não encontrado.");
            if (kind === "REOPEN") assertCanReopen(fresh, clock());
            else if (["RESOLVED", "CLOSED"].includes(fresh.status))
              throw new Error("O chamado mudou de estado. Consulte novamente.");
            if (existingUpdate)
              existingUpdate = { ...existingUpdate, ...fresh };
          }
          // Só um rascunho pendente por conversa; revisão substitui o anterior sem executá-lo.
          await tx.ticketDraft.updateMany({
            where: { employeeId, conversationId, status: "PENDING" },
            data: { status: "CANCELED" },
          });
          const draft = await createDraftService(tx, clock).create(employeeId, {
            conversationId,
            kind,
            targetNumber: target?.number,
            content: {
              title: existingUpdate?.title ?? proposal.title!,
              description: proposal.description!,
              type: existingUpdate?.type ?? target?.type ?? proposal.type!,
              category: existingUpdate?.category ?? proposal.category!,
              impact: existingUpdate?.impact ?? proposal.impact!,
              priority: existingUpdate?.priority ?? classification.priority,
            },
          });
          const sla = getTicketSla(
            {
              priority: draft.priority,
              status: "OPEN",
              createdAt: draft.createdAt,
              lastUpdatedAt: null,
            },
            clock(),
          );
          record.appliedRules.push(
            `SLA previsto: ${sla.dueAt?.toISOString()}; recalculado na confirmação, calendário America/Sao_Paulo, dias úteis 08–18h (crítica: 1h corrida).`,
          );
          record.executedActions.push(
            `Persistiu rascunho ${draft.id} de ${kind}; nenhum chamado alterado.`,
          );
          return {
            draft: {
              id: draft.id,
              kind,
              title: draft.title,
              description: draft.description,
              type: draft.type,
              category: draft.category,
              priority: draft.priority,
              impact: draft.impact,
              dueAt: sla.dueAt?.toISOString() ?? null,
              status: draft.status,
            },
          };
        },
      };
    },
  };
}
