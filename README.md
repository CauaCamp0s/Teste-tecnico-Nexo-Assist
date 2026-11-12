# Nexo Assist

## Etapa 4 — interpretações do protótipo e Anexo A

Coleta: o modelo extrai dados do histórico; o código pergunta um campo ausente por vez e calcula prioridade com `classifyTicketPriority`. O modelo compara candidatos consultados; sem consulta anterior ou com correspondência incerta, o servidor pede seleção. Um problema correspondente ativo vira complemento; resolvido elegível vira oferta de reabertura no card. Revisar dados cancela o rascunho pendente anterior e cria outro atomicamente com a resposta. O prazo no rascunho é uma previsão, recalculada na confirmação, não promessa de atendimento antes de uma reunião.

Consultas do agent usam ferramentas sem parâmetro de identidade: `employeeId` fica no closure criado pelo servidor. Cards e ofertas de transferência por vencimento são derivados das consultas reais pelo código. Seleções rápidas preenchem o compositor para envio explícito. Cards persistem como retrato da consulta (datas reais, sem prometer horários ilustrativos do protótipo); a seleção consulta novamente. O payload estruturado suporta opções, chamados e rascunhos.

O serviço do analista permite à equipe listar e ler a fila; somente o responsável que assumiu pode responder, devolver ou encerrar. Assunção é transacional e registra `analystId`. As server actions exigem `requireRole("ANALYST")`; o serviço também valida o papel no banco. O painel obtém chamados pelo proprietário persistido na conversa, nunca por um id fornecido pelo cliente. Os eventos de controle ficam no histórico como mensagens de sistema. Nenhum prazo ilustrativo de N1/N2 do protótipo é prometido.

O limite conta as 30 mensagens do funcionário (inclusive ao analista), não respostas nem cliques determinísticos de confirmação. A 30ª recebe resposta normalmente; a 31ª é rejeitada em transação. Nova conversa não encerra nem remove atendimento pendente; o histórico fica acessível no menu. Em espera/atendimento humano, o funcionário pode acrescentar informações até o limite, mas o agent permanece pausado. O chat consulta atualizações a cada 3 segundos fora de AGENT. Encerramento é terminal; a devolução ao agent exige que um analista tenha assumido antes.

### Transferência e disponibilidade do legado

Quando a confirmação esgota as tentativas por `TicketUnavailableError`, o rascunho permanece `PENDING`, com `failureCode: UNAVAILABLE`, permitindo nova confirmação após a recuperação. Uma confirmação bem-sucedida limpa o código de falha; erros definitivos continuam marcando `FAILED`.

`transfer(employeeId, number, summary, idempotencyKey)` encaminha um chamado próprio ativo para `WAITING_FOR_ANALYST`, persiste `transferSummary` e reinicia `lastUpdatedAt`. A chave persistida impede repetir a escrita após perda de resposta.

`TICKET_SERVICE_OUTAGE_MS=0` desliga a simulação. Um inteiro positivo (por exemplo, `3000`) provoca uma única janela de indisponibilidade desde a primeira chamada do legado por processo; consultas e confirmações compartilham essa janela. Após o prazo, o serviço se recupera, sem reiniciar a janela a cada chamada. Reiniciar o processo reinicia a simulação.

Todas as operações do ponto de entrada público têm três tentativas totais, com esperas de 500 ms e 1000 ms, somente para `TicketUnavailableError` (`code: UNAVAILABLE`). Ao esgotar, o erro mantém `attempts` e `mayHaveCommitted`: este último sinaliza possível escrita sem resposta, não confirmação de sucesso. Na confirmação de rascunhos, a transação externa ainda desfaz as escritas em caso de falha. Relógio, espera e falhas antes/depois da operação são injetáveis nos testes.

Agente de atendimento para o service desk de TI da Nexo.

## Desenvolvimento local

Requisitos: Node.js >=22.13 e npm.

Copie `.env.example` para `.env` e execute:

```sh
npm ci
npm run setup
npm run dev
```

O SQLite local será criado em `prisma/dev.db`. Acesse http://localhost:3000.

O seed adiciona três funcionários, um analista, seis artigos e nove chamados, sem duplicar registros nem sobrescrever dados existentes. Os e-mails de exemplo estão em `prisma/seed-data.ts` e os chamados em `prisma/ticket-seed.ts`. As datas dos chamados são relativas à primeira execução que os insere; rodar o seed novamente preserva suas datas e eventuais alterações.

Para entrar, use `ana.souza@nexo.com.br` (funcionária) ou `rafael.lima@nexo.com.br` (analista) com qualquer senha não vazia, conforme o login de demonstração do desafio.

O agent usa Mastra e Gemini 3.5 Flash-Lite (`LLM_MODEL=google/gemini-3.5-flash-lite`), escolhido pelo custo e latência menores e para viabilizar o uso na cota gratuita do projeto, sujeito aos limites do Google. Para subir de modelo Gemini compatível, basta trocar `LLM_MODEL`. O raciocínio usa `thinkingLevel: minimal` (o modelo escolhido deve suportar essa opção). Preencha `GOOGLE_GENERATIVE_AI_API_KEY` somente no `.env` para chamadas reais. Os testes usam modelo mockado. O histórico vem do SQLite; o registro de decisões fica em JSON junto à mensagem, sem memória do Mastra.

Trade-off atual: a primeira chamada decide buscar ou responder diretamente; redirecionamentos e pedidos de contexto usam uma requisição. Quando há busca, uma segunda chamada recebe histórico e artigos como contexto, sem ferramentas nem mensagens de protocolo de ferramenta, e retorna JSON nativo. A primeira usa JSON via prompt para permitir a decisão de buscar. Isso mantém até duas chamadas normais, mas a decisão de não buscar assuntos fora de TI depende das instruções ao modelo. Defeitos concretos são TI mesmo sem detalhes; intenção indefinida é reservada a mensagens sem problema identificável. Consultas são capturadas pelo código e a segurança de orientações de TI nunca é alta sem artigo relevante.

Retries automáticos estão desabilitados, inclusive os processadores padrão do Mastra (`errorProcessorDefaults: false`). Na versão 1.82.0, o `StreamErrorRetryProcessor` repetia falhas até duas vezes com espera de 3 s, independentemente de `maxRetries: 0`. Agora o código permite apenas uma nova tentativa por mensagem após HTTP 503/429, com espera cancelável de 1 s; etapa, status, espera e resultado ficam em `modelRetries`, separados de `executedActions`.

JSON inválido ou fora do schema permite uma chamada extra de recuperação, sem ferramentas e com os resultados reais já consultados. O fluxo normal mantém até duas chamadas; recuperação de JSON e retry de indisponibilidade podem acrescentar uma chamada cada, sempre dentro do orçamento compartilhado de 20 segundos. Falha persistente, indisponibilidade ou timeout produz pedido de detalhes com segurança baixa, motivo e `modelFailure` registrados. O timeout protege contra falhas e não representa uma meta de latência. A latência do nível gratuito varia; a busca no SQLite levou cerca de 2 ms.

## Chamados e prazos

O módulo `src/services/tickets` concentra as regras do sistema legado simulado, separado do agent. Chamados INC/REQ têm proprietário, categoria, impacto, prioridade, status e datas persistidas. A classificação usa impacto e interrupção (`stopped`: sem conseguir trabalhar; `degraded`: há alternativa; `none`: pedido/melhoria) e compromisso no mesmo dia. Paralisação de equipe/empresa é crítica; de uma pessoa ou compromisso hoje é alta; trabalho prejudicado com alternativa é média; pedidos sem urgência são baixa.

O SLA usa `America/Sao_Paulo`, segunda a sexta das 8h às 18h, sem feriados: crítica = 1 hora corrida; alta = 4 horas úteis; média = 30 horas úteis (3 dias); baixa = 50 horas úteis (5 dias). `createdAt` inicia a primeira resposta; cada atualização de negócio define `lastUpdatedAt` e reinicia o prazo. A data não muda automaticamente ao salvar metadados. Vencido significa `agora > prazo`; resolvidos e encerrados não têm prazo pendente. O cálculo usa Temporal para respeitar o fuso IANA, sem depender do fuso da máquina.

Ana recebe os três chamados do Anexo B (`INC-20311`, `REQ-10442`, `INC-20150`) e mais quatro cenários: VPN aberta e vencida, impressora resolvida há 2 dias, software resolvido há 12 dias e requisição recente dentro do prazo. Bruno e Carla possuem um chamado cada para verificar isolamento entre funcionários. Os exemplos cobrem as quatro prioridades.

O ponto de entrada do legado simulado é `ticketService`, em `src/services/tickets/index.ts`, com contrato `TicketService`: `list(employeeId, { statuses? })` e `get(employeeId, number)`. O funcionário deve vir da sessão autenticada, nunca do modelo. Toda consulta filtra o proprietário no banco; número alheio e inexistente retornam `null`, e identidade ausente é rejeitada. Sem filtro de status, a lista inclui todos os chamados próprios, dos mais recentes aos mais antigos pela abertura. O retorno inclui `dueAt` e `isOverdue`, calculados na leitura sem alterar as datas persistidas. O adaptador SQLite e seu relógio podem ser substituídos sem alterar o contrato.

`ticketDraftService` persiste rascunhos completos de criação, complemento e reabertura, com estados pendente, confirmado, cancelado ou falhou. `confirmTicketDraft` e `cancelTicketDraft` (`tickets/confirmation.ts`) obtêm a identidade da sessão; não usam LLM. A confirmação revalida conversa e alvo, e grava alteração, chave de idempotência e resultado do rascunho em uma transação. Cancelados/falhos não podem ser confirmados; é necessário um novo rascunho. Repetir uma confirmação concluída devolve o mesmo chamado.

As escritas do legado (`create`, `addUpdate`, `reopen`) exigem chave de idempotência: a confirmação usa o id do rascunho. Chave repetida com conteúdo diferente é rejeitada. Complementos preservam a descrição anterior e reiniciam `lastUpdatedAt`; o tipo INC/REQ de um chamado existente não muda. A numeração nova começa em 100001 por tipo, em contador transacional separado da faixa dos exemplos. Estas funções ainda não têm rota HTTP ou interface.

`findDuplicateCandidates(employeeId)` retorna chamados próprios ativos e resolvidos há até 7 dias corridos (168 horas, limite inclusivo), para comparação posterior pelo agent; não presume similaridade nem altera dados. Encerrados, resoluções ausentes/futuras e resolvidos mais antigos ficam fora. `reopen` exige status `RESOLVED` e a mesma janela, revalidada também ao confirmar o rascunho. Reabertura limpa `resolvedAt`, retorna a `OPEN` e reinicia o prazo.

## Verificações

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Para executar a versão compilada, use `npm start` após o build.

Use `npm run format` para formatar os arquivos e `npm run test:watch` para executar testes durante o desenvolvimento. O ESLint usa as regras de Next.js e TypeScript; o Prettier cuida da formatação.

## Estado atual

Login com sessão persistida e rotas protegidas por papel. O chat segue as Telas 2 e 3 do protótipo, com histórico persistido, consultas visíveis acima das respostas e registro de decisões expansível. A mensagem do funcionário é salva antes da geração; o indicador “pensando” acompanha a espera. Falhas aparecem sem apagar o histórico, e mensagens pendentes podem solicitar uma resposta novamente. Ainda não há cards de chamado; o console será implementado em outra etapa.
