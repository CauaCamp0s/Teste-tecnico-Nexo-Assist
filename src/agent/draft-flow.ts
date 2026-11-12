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
              .map((t) => `${t.number}: ${t.title} (${t.status})`)
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
    async prepare(proposal: TicketProposal, record: DecisionRecord) {
      const fields = [
        ["title", "Qual título resume o problema?", []],
        ["description", "O que está acontecendo e desde quando?", []],
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
      ] as const;
      for (const [field, question, options] of fields) {
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
        sameDayCommitment: proposal.sameDayCommitment!,
      };
      const classification = classifyTicketPriority(context);
      record.appliedRules.push(
        `Prioridade ${classification.priority}: ${classification.reason} Contexto: ${context.impact}, ${context.interruption}, compromisso hoje: ${context.sameDayCommitment ? "sim" : "não"}.`,
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
        (t) => t.number === proposal.duplicate?.number,
      );
      if (
        candidates?.length &&
        (!compared ||
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
            tickets: candidates.map(ticketCard),
            options: [
              ...candidates.map((t) => ({
                label: `${t.number} · ${t.title}`,
                value: `É o mesmo problema do ${t.number}`,
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
            if (kind === "REOPEN") assertCanReopen(fresh, new Date());
            else if (["RESOLVED", "CLOSED"].includes(fresh.status))
              throw new Error("O chamado mudou de estado. Consulte novamente.");
          }
          // Só um rascunho pendente por conversa; revisão substitui o anterior sem executá-lo.
          await tx.ticketDraft.updateMany({
            where: { employeeId, conversationId, status: "PENDING" },
            data: { status: "CANCELED" },
          });
          const draft = await createDraftService(tx).create(employeeId, {
            conversationId,
            kind,
            targetNumber: target?.number,
            content: {
              title: proposal.title!,
              description: proposal.description!,
              type: target?.type ?? proposal.type!,
              category: proposal.category!,
              impact: proposal.impact!,
              priority: classification.priority,
            },
          });
          const sla = getTicketSla(
            {
              priority: draft.priority,
              status: "OPEN",
              createdAt: draft.createdAt,
              lastUpdatedAt: null,
            },
            new Date(),
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
