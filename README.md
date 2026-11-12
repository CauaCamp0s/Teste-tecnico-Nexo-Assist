# Nexo Assist

Agente de atendimento para o service desk de TI da Nexo.

## Desenvolvimento local

Requisitos: Node.js 24 e npm 11.

```sh
npm ci
npm run dev
```

Acesse http://localhost:3000. A estrutura inicial ainda não exige variáveis de ambiente; `.env.example` será preenchido conforme as integrações forem implementadas.

## Verificações

```sh
npm run typecheck
npm run build
```

Para executar a versão compilada, use `npm start` após o build.

## Estado atual

Base Next.js com App Router e TypeScript estrito. As funcionalidades de atendimento serão adicionadas em etapas.
