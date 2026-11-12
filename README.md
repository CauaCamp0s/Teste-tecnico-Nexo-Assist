# Nexo Assist

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

O seed adiciona três funcionários, um analista e seis artigos, sem duplicar registros nem sobrescrever dados existentes. Os e-mails de exemplo estão em `prisma/seed-data.ts`.

Para entrar, use `ana.souza@nexo.com.br` (funcionária) ou `rafael.lima@nexo.com.br` (analista) com qualquer senha não vazia, conforme o login de demonstração do desafio.

O agent usa Mastra e Gemini 3.5 Flash-Lite (`LLM_MODEL=google/gemini-3.5-flash-lite`), escolhido pelo custo e latência menores e para viabilizar o uso na cota gratuita do projeto, sujeito aos limites do Google. Para subir de modelo Gemini compatível, basta trocar `LLM_MODEL`. O raciocínio usa `thinkingLevel: minimal` (o modelo escolhido deve suportar essa opção). Preencha `GOOGLE_GENERATIVE_AI_API_KEY` somente no `.env` para chamadas reais. Os testes usam modelo mockado. O histórico vem do SQLite; o registro de decisões fica em JSON junto à mensagem, sem memória do Mastra.

Trade-off atual: a primeira chamada decide buscar ou responder diretamente; redirecionamentos e pedidos de contexto usam uma requisição. Quando há busca, uma segunda chamada recebe histórico e artigos como contexto, sem ferramentas nem mensagens de protocolo de ferramenta, e retorna JSON nativo. A primeira usa JSON via prompt para permitir a decisão de buscar. Isso mantém até duas chamadas normais, mas a decisão de não buscar assuntos fora de TI depende das instruções ao modelo. Defeitos concretos são TI mesmo sem detalhes; intenção indefinida é reservada a mensagens sem problema identificável. Consultas são capturadas pelo código e a segurança de orientações de TI nunca é alta sem artigo relevante.

Retries automáticos estão desabilitados, inclusive os processadores padrão do Mastra (`errorProcessorDefaults: false`). Na versão 1.82.0, o `StreamErrorRetryProcessor` repetia falhas até duas vezes com espera de 3 s, independentemente de `maxRetries: 0`. Agora o código permite apenas uma nova tentativa por mensagem após HTTP 503/429, com espera cancelável de 1 s; etapa, status, espera e resultado ficam em `modelRetries`, separados de `executedActions`.

JSON inválido ou fora do schema permite uma chamada extra de recuperação, sem ferramentas e com os resultados reais já consultados. O fluxo normal mantém até duas chamadas; recuperação de JSON e retry de indisponibilidade podem acrescentar uma chamada cada, sempre dentro do orçamento compartilhado de 20 segundos. Falha persistente, indisponibilidade ou timeout produz pedido de detalhes com segurança baixa, motivo e `modelFailure` registrados. O timeout protege contra falhas e não representa uma meta de latência. A latência do nível gratuito varia; a busca no SQLite levou cerca de 2 ms.

## Chamados e prazos

O módulo `src/services/tickets` concentra as regras do sistema legado simulado, separado do agent. Chamados INC/REQ têm proprietário, categoria, impacto, prioridade, status e datas persistidas. A classificação usa impacto e interrupção (`stopped`: sem conseguir trabalhar; `degraded`: há alternativa; `none`: pedido/melhoria) e compromisso no mesmo dia. Paralisação de equipe/empresa é crítica; de uma pessoa ou compromisso hoje é alta; trabalho prejudicado com alternativa é média; pedidos sem urgência são baixa.

O SLA usa `America/Sao_Paulo`, segunda a sexta das 8h às 18h, sem feriados: crítica = 1 hora corrida; alta = 4 horas úteis; média = 30 horas úteis (3 dias); baixa = 50 horas úteis (5 dias). `createdAt` inicia a primeira resposta; cada atualização de negócio define `lastUpdatedAt` e reinicia o prazo. A data não muda automaticamente ao salvar metadados. Vencido significa `agora > prazo`; resolvidos e encerrados não têm prazo pendente. O cálculo usa Temporal para respeitar o fuso IANA, sem depender do fuso da máquina.

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
