# Nexo Assist

Agente de atendimento para o service desk de TI da Nexo.

## Desenvolvimento local

Requisitos: Node.js >=20.9 e npm. Para executar os testes com Vitest 5, use Node.js 22.12+, 24 ou 26+.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Antes dos comandos, copie `.env.example` para `.env`. O SQLite local será criado em `prisma/dev.db`. Acesse http://localhost:3000.

O seed adiciona três funcionários, um analista e seis artigos, sem duplicar registros nem sobrescrever dados existentes. Os e-mails de exemplo estão em `prisma/seed-data.ts`.

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

Base Next.js com TypeScript estrito e Prisma/SQLite para usuários, artigos, conversas e mensagens. As funcionalidades de atendimento serão adicionadas em etapas.
