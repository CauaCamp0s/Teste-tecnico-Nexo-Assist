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

O agent usa Mastra e OpenAI (`LLM_MODEL`), com modo Fast e esforço `low`. Preencha `OPENAI_API_KEY` somente no `.env` para chamadas reais. Os testes usam modelo mockado. O histórico vem do SQLite; o registro de decisões fica em JSON junto à mensagem, sem memória do Mastra.

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
