import type { DecisionRecord } from "@/agent/decisions";
import styles from "./chat.module.css";

const decisions = {
  orientar_com_artigos: "Orientar com artigos",
  pedir_detalhes: "Pedir mais detalhes",
  redirecionar: "Redirecionar ao departamento responsável",
  consultar_chamados: "Consultar chamados próprios",
  oferecer_transferencia: "Oferecer atendimento humano",
  propor_rascunho: "Propor rascunho para confirmação",
  confirmar_alteracao: "Confirmar alteração",
  cancelar_rascunho: "Cancelar rascunho",
  transferir: "Transferir atendimento",
  indisponivel: "Informar indisponibilidade",
};
const intents = {
  ti: "TI",
  rh: "Recursos Humanos",
  financeiro: "Financeiro",
  facilities: "Facilities",
  indefinido: "Aguardando contexto",
};
const stages = {
  initial: "Decisão inicial",
  answer: "Resposta",
  recovery: "Recuperação do formato",
};
const outcomes = {
  pending: "Pendente",
  succeeded: "Chamada concluída",
  failed: "Falhou",
  aborted: "Interrompida pelo limite de espera",
};

const toolLabels = {
  search_help_center: "Central de ajuda",
  list_tickets: "Seus chamados",
  get_ticket: "Chamado selecionado",
  find_duplicate_candidates: "Candidatos a duplicidade",
};
const activityLabels = {
  search_help_center: "buscou na central de ajuda",
  list_tickets: "consultou seus chamados",
  get_ticket: "consultou o chamado",
  find_duplicate_candidates: "verificou duplicidade",
};

export function ActivityLine({ record }: { record: DecisionRecord | null }) {
  return (
    <div className={styles.activity}>
      <strong>Nexo Assist</strong>
      {record?.consultations.map((consultation, index) => (
        <span key={index}>
          <span aria-hidden="true">
            {consultation.result.status === "success" ? "✓" : "!"}
          </span>{" "}
          {consultation.result.status === "success"
            ? activityLabels[consultation.tool]
            : `falha na consulta: ${toolLabels[consultation.tool]}`}
          {consultation.input.number ? ` ${consultation.input.number}` : ""}
        </span>
      ))}
      {record?.appliedRules.some((rule) => rule.startsWith("Prioridade ")) && (
        <span>✓ classificou a prioridade</span>
      )}
      {record?.appliedRules.some((rule) => /SLA|Prazo|prazo/.test(rule)) && (
        <span>✓ calculou o prazo</span>
      )}
      {record?.executedActions.map((action) => (
        <span key={action}>✓ {action}</span>
      ))}
      {!!record?.modelRetries?.length && (
        <span>↻ nova tentativa do modelo</span>
      )}
      {record?.modelFailure && (
        <span className={styles.failureLabel}>resposta de contingência</span>
      )}
    </div>
  );
}

export function DecisionDetails({ record }: { record: DecisionRecord }) {
  return (
    <details className={styles.decisions}>
      <summary>
        Registro de decisões{" "}
        <span className={styles.confidence}>Segurança {record.confidence}</span>
      </summary>
      <div className={styles.decisionBody}>
        <dl>
          <dt>Entendimento</dt>
          <dd>
            <strong>{intents[record.understanding.intent]}</strong> ·{" "}
            {record.understanding.summary}
          </dd>
          <dt>Consultas</dt>
          <dd>
            {record.consultations.length ? (
              <ul>
                {record.consultations.map((consultation, index) => (
                  <li key={index}>
                    <strong>{toolLabels[consultation.tool]}</strong>
                    {(consultation.input.query ||
                      consultation.input.number) && (
                      <>
                        {" "}
                        · “
                        {consultation.input.query || consultation.input.number}”
                      </>
                    )}
                    <p>
                      {consultation.result.status === "error"
                        ? "Consulta não concluída. "
                        : ""}
                      {consultation.result.summary}
                    </p>
                    {!!consultation.result.articleIds.length && (
                      <span className={styles.articleIds}>
                        Artigos consultados:{" "}
                        {consultation.result.articleIds.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              "Nenhuma consulta realizada."
            )}
          </dd>
          <dt>Decisão</dt>
          <dd>{decisions[record.decision]}</dd>
          <dt>Ações executadas</dt>
          <dd>
            {record.executedActions.length ? (
              <ul>
                {record.executedActions.map((action, index) => (
                  <li key={index}>{action}</li>
                ))}
              </ul>
            ) : (
              "Nenhuma ação de alteração de estado. Buscas são consultas."
            )}
          </dd>
          <dt>Segurança</dt>
          <dd>{record.confidence}</dd>
          <dt>Motivo</dt>
          <dd>{record.reason}</dd>
          {!!record.appliedRules.length && (
            <>
              <dt>Regras aplicadas</dt>
              <dd>
                <ul>
                  {record.appliedRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {!!record.modelRetries?.length && (
            <>
              <dt>Nova tentativa do modelo</dt>
              <dd>
                <ul>
                  {record.modelRetries.map((retry, index) => (
                    <li key={index}>
                      {stages[retry.stage]} · HTTP {retry.statusCode} · espera
                      prevista de {retry.delayMs / 1_000} s ·{" "}
                      {outcomes[retry.outcome]}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    </details>
  );
}
