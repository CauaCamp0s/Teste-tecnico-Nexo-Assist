# Nexo Assist

Service desk de TI com assistente virtual, chamados simulados e atendimento humano. Implementa as Telas 1–5 do protótipo: identificação, chat e console do analista, com layout responsivo e histórico persistido.

Demonstração: https://app-production-48425a24.up.railway.app (funcionário `ana.souza@nexo.com.br`, analista `rafael.lima@nexo.com.br`, qualquer senha).

## Roteiro rápido de avaliação

Entre como `ana.souza@nexo.com.br` e abra "Registro de decisões" abaixo de cada resposta para ver o que o agent consultou, decidiu e executou, com segurança e motivo.

1. **Dúvida resolvida pela central:** "Minha VPN está dando erro 809". O agent consulta o artigo e pergunta a versão do Windows; no Windows 10 orienta com os passos, no Windows 11 segue para chamado.
2. **Sem duplicidade:** responda "Windows 11". A Ana já tem `INC-20312` aberto sobre VPN, então o agent propõe complementar esse chamado em vez de criar outro.
3. **Consulta sem número e prazo vencido:** "Qual o status do meu chamado?". Escolha `INC-20311` no seletor: o agent informa o atraso e oferece um analista.
4. **Transferência:** clique em "Falar com um analista". O agent pausa e a conversa entra na fila com um resumo.
5. **Console do analista:** saia e entre como `rafael.lima@nexo.com.br`. Assuma a conversa da Ana, responda e devolva ao agent ou encerre.
6. **Abertura de chamado:** entre como `bruno.tavares@nexo.com.br` e escreva "Meu monitor não liga, já troquei o cabo". O agent pergunta só o que falta, calcula a prioridade e o prazo e mostra o rascunho para confirmação.
7. **Fora de escopo:** "Como peço férias?" é redirecionado ao RH.

O banco da demonstração é persistente e compartilhado. Se alguém já tiver percorrido o roteiro, os chamados podem estar em outro estado; localmente, `npm run setup` com um banco novo reproduz o cenário inicial.

## Executar localmente

Requisitos: Node.js >=22.13 e npm. Copie `.env.example` para `.env` e preencha `GOOGLE_GENERATIVE_AI_API_KEY` com uma chave do Google AI Studio.

```sh
npm ci
npm run setup
npm run dev
```

Acesse http://localhost:3000. O SQLite padrão fica em `prisma/dev.db`. Sem chave, a interface e os serviços continuam acessíveis; solicitações ao modelo mostram indisponibilidade e permitem tentar novamente.

### Contas de demonstração

Use qualquer senha não vazia. Trata-se do login simulado do desafio, não de autenticação corporativa real.

| Papel       | E-mail                    |
| ----------- | ------------------------- |
| Funcionária | ana.souza@nexo.com.br     |
| Funcionário | bruno.tavares@nexo.com.br |
| Funcionária | carla.mendes@nexo.com.br  |
| Analista    | rafael.lima@nexo.com.br   |

O analista entra pela mesma página e segue para `/console`; funcionários seguem para `/chat`. Sessões são persistidas, com cookie HttpOnly, SameSite e Secure em produção. Rotas e ações validam o papel no servidor.

O seed idempotente insere três funcionários, um analista, seis artigos e nove chamados. Não sobrescreve dados existentes. Ana tem os chamados do Anexo B (`INC-20311`, `REQ-10442`, `INC-20150`) e cenários adicionais de prazo, duplicidade e reabertura. Bruno e Carla permitem verificar isolamento. Datas são relativas à primeira inserção e preservadas nas execuções seguintes.

## Execução em produção

Configure as variáveis de `.env.example` no ambiente, prepare um volume gravável e use `DATABASE_URL=file:/data/nexo.db` para persistência. Execute:

```sh
npm ci --include=dev
npm run build
npm start
```

`npm start` executa, em sequência, `prisma migrate deploy`, seed idempotente e `next start`. Falha em uma etapa impede iniciar a seguinte. Prisma CLI, tsx e dotenv precisam estar instalados também na execução. Use HTTPS para os cookies de produção. O build das fontes via `next/font/google` requer acesso ao Google Fonts.

| Variável                       | Uso                                                              |
| ------------------------------ | ---------------------------------------------------------------- |
| `DATABASE_URL`                 | SQLite local ou caminho absoluto em volume persistente           |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Credencial do provedor, somente no servidor                      |
| `LLM_MODEL`                    | Padrão `google/gemini-3.5-flash-lite`                            |
| `TICKET_SERVICE_OUTAGE_MS`     | Janela simulada de falha do legado; `0` desliga                  |
| `AGENT_RATE_LIMIT_MAX`         | Gerações por janela, padrão `10`                                 |
| `AGENT_RATE_LIMIT_WINDOW_MS`   | Duração da janela, padrão `60000` ms                             |
| `TRUST_PROXY`                  | `true` habilita limite adicional por `x-forwarded-for` confiável |
| `PORT`                         | Porta HTTP, padrão `3000`                                        |

O limite é aplicado antes da geração, inclui novas tentativas e preserva a mensagem já salva. Usa contadores por sessão e, com `TRUST_PROXY=true`, por IP. Habilite essa opção somente atrás de proxy que sobrescreva `x-forwarded-for` e impeça acesso direto à aplicação. Sem proxy confiável, o Next não fornece IP direto nas server actions e o limite fica por sessão. Os contadores são locais ao processo, expiram e reiniciam com ele; não substituem proteção distribuída.

### Deploy na Railway

A demonstração roda na Railway, a partir da branch `main` deste repositório, com o builder padrão (Railpack). O banco SQLite fica em um volume montado em `/data` (`DATABASE_URL=file:/data/nexo.db`), então conversas, chamados e estados sobrevivem a novos deploys e reinícios. A chave do modelo existe apenas nas variáveis do serviço. `NPM_CONFIG_INCLUDE=dev` mantém Prisma CLI e tsx disponíveis para migração e seed no start, e `TRUST_PROXY=true` habilita o limite por IP atrás do proxy da Railway. Para conter custo, além do limite por sessão e IP, o projeto usa um modelo econômico e o limite de 30 mensagens por conversa; um teto de gastos também deve ser configurado no painel do provedor do modelo.

## Arquitetura

```text
Interface Next.js/React
  → Server actions: sessão, papel e limite de requisições
    → Serviços de conversa, analista e confirmação
    → Agent Mastra: interpretação e proposta estruturada
      → Ferramentas de consulta com identidade fixada pelo servidor
        → Central de ajuda e serviço de chamados simulado
          → Prisma / SQLite
```

- `src/app`: login, chat, console, carregamento e recuperação de erros. O console consulta atualizações a cada três segundos; o chat acompanha atendimento humano com o mesmo intervalo.
- `src/agent`: instruções, schema Zod, ferramentas, coleta, decisões e orçamento de geração. O histórico vem do banco, sem memória paralela do Mastra.
- `src/services`: conversas, autenticação, atendimento humano e confirmação de rascunhos.
- `src/services/tickets`: contrato do legado simulado, regras de propriedade, prioridade, SLA, duplicidade, idempotência e disponibilidade.
- `prisma`: schema, migrações e seed. Mensagens, decisões, rascunhos, sessões e operações ficam persistidos.

Stack: Next.js 16, React 19, TypeScript estrito, Prisma 6/SQLite, Mastra 1.82, Zod e Vitest. O adaptador do serviço de chamados pode ser substituído mantendo seu contrato.

## Como o agent decide

**O modelo interpreta e propõe; o código executa e impõe as regras.**

1. A mensagem do funcionário é persistida antes de chamar o modelo. As ferramentas recebem `employeeId` pelo closure criado com a sessão autenticada; o modelo não escolhe o proprietário.
2. O modelo identifica a intenção e consulta artigos ou chamados. Quando há artigo aplicável, o agent orienta antes de abrir chamado e respeita as condições do artigo (por exemplo, Windows 10 ou 11). Assuntos fora de TI são redirecionados sem consulta. `list_tickets` lista ativos por padrão e aceita assunto, pesquisado no título/descrição pelo serviço. Um resultado é exibido diretamente; dois ou mais pedem seleção. Toda consulta filtra o proprietário no banco.
3. Para abertura, o modelo infere título, tipo e categoria quando possível. O código prioriza lacunas de impacto e interrupção, uma pergunta por vez. Não pergunta compromisso hoje quando interrupção total já define alta/crítica.
4. A prioridade é calculada no servidor: paralisação de equipe/empresa é crítica; paralisação individual ou compromisso hoje é alta; trabalho prejudicado com alternativa é média; pedido sem urgência é baixa. O modelo não determina livremente a prioridade.
5. Antes da escrita, candidatos próprios são consultados. Correspondência ativa gera proposta de complemento; resolvido elegível gera proposta de reabertura. Incerteza pede esclarecimento, mostrando só candidatos plausíveis; a resposta às opções de duplicidade é interpretada pelo código. Um complemento só vale para chamado estabelecido na conversa (criado, atualizado, selecionado ou citado pelo funcionário). Referência resolvida fora da janela não cria silenciosamente outro chamado.
6. O funcionário confere o rascunho e confirma ou cancela. Essas ações não usam modelo. A confirmação revalida alvo, estado e propriedade, e grava alteração, chave de idempotência, resultado e histórico em transação. Repetir a confirmação devolve o mesmo resultado. Editar prepara outro rascunho e cancela o anterior.

Cada resposta registra entendimento, consultas e resultados, decisão, ações efetivamente persistidas, regras, segurança e motivo. A interface mostra títulos, números públicos e datas em pt-BR/São Paulo; o JSON técnico permanece no banco. Consultas não aparecem como alterações, e alegações de escrita no texto livre são substituídas por mensagens controladas pelo código.

### Prazos, reabertura e transferência

- Horário útil: segunda a sexta, 08h–18h, `America/Sao_Paulo`, sem feriados. Crítica: uma hora corrida; alta: quatro horas úteis; média: 30 horas úteis; baixa: 50 horas úteis.
- Abertura inicia o prazo; atualização de negócio reinicia a contagem em `lastUpdatedAt`. Metadados não reiniciam SLA. O prazo do rascunho é previsão, recalculada na confirmação.
- Vencido significa `agora > prazo`; resolvidos/encerrados não têm prazo pendente. Vencimento **oferece** transferência, não transfere automaticamente.
- Reabertura exige `RESOLVED` há no máximo sete dias corridos (168 horas, limite inclusivo), validado novamente na confirmação.
- Pedido humano, criticidade calculada ou segurança baixa sobre um problema de TI identificado encaminham a conversa e pausam o agent. Saudações e intenção indefinida não transferem por baixa segurança. RH, financeiro e facilities recebem redirecionamento de escopo.
- O resumo da transferência reúne relatos, consultas, decisões e chamado relacionado. Somente o analista responsável pode responder, devolver ao agent ou encerrar; assumir é transacional. Encerrar conversa não equivale a encerrar chamado.

## Modelo, custo e disponibilidade

Escolhi o Gemini Flash-Lite (`google/gemini-3.5-flash-lite`) porque o atendimento precisa de respostas rápidas e baratas, com chamada de ferramentas e saída estruturada confiáveis. As decisões que exigem rigor (prioridade, prazo, duplicidade, permissões e escrita) ficam no código, então um modelo pequeno basta para interpretar e redigir. Nas validações reais, as respostas levaram em torno de 2 a 4 segundos. O provedor é trocável pela variável `LLM_MODEL`, sem mudar o código. O uso de cota gratuita depende da disponibilidade e dos limites do projeto Google. Não há preço fixo por mensagem: o custo depende dos tokens de entrada/saída e da tabela do provedor.

O fluxo normal usa uma chamada para interpretar/consultar e, havendo consulta, outra para responder com os resultados: aproximadamente duas chamadas por mensagem. Respostas diretas podem usar uma; confirmar/cancelar e ações do analista usam zero. O histórico aumenta o consumo de entrada. Usa-se `thinkingLevel: minimal`; trocar `LLM_MODEL` exige um modelo compatível com essa opção e com a saída estruturada.

A geração tem orçamento compartilhado de 18 segundos, reservando dois segundos do orçamento de resposta de 20 segundos para persistência/backoff. Não é garantia de latência externa. Retries automáticos do SDK/Mastra estão desligados. Há uma nova tentativa para 429/503, com espera cancelável de um segundo, e uma recuperação excepcional de JSON inválido, dentro do mesmo orçamento; podem acrescentar uma chamada cada. Essas ocorrências ficam registradas separadamente das ações executadas.

Falha técnica, timeout ou JSON persistentemente inválido mantém a conversa em `AGENT`, registra `modelFailure` e permite tentar novamente a mesma mensagem sem gastar outra das 30 mensagens. Falha do provedor não é tratada como insegurança sobre o problema de TI.

### Simular falha do serviço de chamados

Defina `TICKET_SERVICE_OUTAGE_MS=3000` e reinicie a aplicação. A primeira chamada ao legado inicia uma única janela de indisponibilidade por processo. Consultas e confirmações compartilham essa janela; o serviço se recupera após o prazo. `0` desliga.

O ponto de entrada público tenta até três vezes, com esperas de 500 e 1000 ms, apenas para indisponibilidade. Falha de confirmação mantém o rascunho `PENDING`, permitindo nova tentativa; erro definitivo marca `FAILED`. Escritas usam chave de idempotência e transação para evitar duplicação após perda de resposta. Se a transferência do chamado falhar, a conversa ainda pode entrar na fila, com aviso de que o chamado não foi alterado. No console, a falha do painel de chamados preserva histórico e controles.

## Como garanti a qualidade das decisões

1. **Regras no servidor, não no prompt.** Identidade, permissões, prioridade, prazo, duplicidade, reabertura e escrita são determinísticas e testadas. O modelo não consegue criar ou alterar um chamado sem a confirmação do funcionário, nem ver chamados de outra pessoa.
2. **Testes de cenário do agent.** Conversas completas rodam com o modelo simulado, verificando a decisão tomada, as consultas registradas e as ações executadas em cada passo.
3. **Validação com o modelo real.** Os fluxos foram percorridos no navegador, localmente e no deploy, com banco novo. Essa etapa encontrou problemas que os testes simulados não pegavam (como um loop na pergunta de duplicidade e um complemento apontando para o chamado errado), e cada um virou correção com teste de regressão.
4. **Transparência auditável.** O registro de decisões mostra o que foi consultado e executado a partir do que o código de fato fez; alegações de alteração no texto livre do modelo são bloqueadas.

Verificações:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

A suíte atual tem 239 testes em 30 arquivos. `src/agent/scenarios.test.ts` percorre orientação, consulta/seleção, vencimento/aceite, coleta, confirmação, duplicidade, reabertura, criticidade, escopo, falhas e isolamento com modelo simulado e rede bloqueada. Outros testes verificam prioridade/SLA, sessão/papel, concorrência, limites, rollback, idempotência e recuperação. As regras ficam no servidor, não apenas no prompt ou nos botões.

Rodadas reais de modelo são manuais e curtas; suas saídas e credenciais não fazem parte do repositório.

## Interpretações e trade-offs

- O limite de 30 conta mensagens do funcionário, inclusive ao analista. A 30ª recebe resposta; a 31ª é rejeitada em transação. Confirmações determinísticas continuam disponíveis. Nova conversa preserva atendimentos anteriores.
- O assistente fica pausado na fila e durante atendimento humano; o funcionário ainda pode acrescentar contexto até o limite. Devolução exige que um analista tenha assumido. Conversa encerrada é terminal.
- Cards no histórico são retratos de consultas reais. O painel do analista é atualizado periodicamente. Não são prometidos prazos ilustrativos de contato N1/N2.
- Perfil ficou fora do escopo; números ilustrativos do protótipo não são exibidos como métricas reais. Login da demonstração aceita qualquer senha conforme solicitado.
- SQLite e contadores em memória simplificam a execução em uma instância com volume. Para múltiplas réplicas seriam necessários banco compartilhado, limite distribuído e coordenação de inicialização.
- Polling reduz complexidade, com pequeno atraso e leituras periódicas. Busca textual simples e comparação pelo modelo evitam infraestrutura vetorial, mas limitam a relevância em bases maiores.
- Inferências de intenção e similaridade dependem do modelo; validação, propriedade, prioridade e escrita são determinísticas. Testes simulados cobrem regras e cenários, não garantem todas as respostas de um provedor real.

## O que faria com mais tempo

- Avaliações automáticas do agent com o modelo real, a partir de relatos anonimizados, para medir a qualidade das decisões a cada mudança de prompt ou de modelo.
- Streaming das respostas e atualização por eventos no lugar do polling.
- Busca semântica na central de ajuda.
- PostgreSQL e limite de requisições distribuído para rodar com várias instâncias.
- Observabilidade de tokens, custo e latência por conversa.
- SSO corporativo, integração com o sistema legado real e calendário de feriados no cálculo de prazo.
- Testes de acessibilidade e de ponta a ponta da interface.
