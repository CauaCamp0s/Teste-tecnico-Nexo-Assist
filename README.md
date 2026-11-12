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

Trade-off atual: uma mensagem de TI exige até três requisições ao modelo (classificação, chamada de busca e resposta), sem contar novas tentativas por falha. Isso garante a classificação antes de disponibilizar ferramentas, ao custo de latência e tokens adicionais.

Retries automáticos estão desabilitados. JSON inválido ou fora do schema permite uma nova tentativa da etapa, dentro do orçamento compartilhado de 4,5 segundos de geração. Falha persistente, indisponibilidade ou timeout produz pedido de detalhes com segurança baixa e motivo registrado. Esse limite reduz a espera, mas pode interromper uma orientação útil: na medição manual, VPN/monitor passaram de 32,83/30,98 s para 4,55/4,54 s **com contingência por timeout**, não com atendimento concluído. A meta de resposta útil abaixo de 5 s permanece pendente; a busca no SQLite levou cerca de 2 ms.

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

Login com sessão persistida e rotas protegidas por papel. As telas de chat e console são iniciais; as funcionalidades de atendimento serão adicionadas em etapas.
