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
npm run lint
npm run format:check
npm test
npm run build
```

Para executar a versão compilada, use `npm start` após o build.

Use `npm run format` para formatar os arquivos e `npm run test:watch` para executar testes durante o desenvolvimento. O ESLint usa as regras de Next.js e TypeScript; o Prettier cuida da formatação.

O Vitest está configurado para testes `src/**/*.test.ts` e `src/**/*.test.tsx`, em ambiente Node.js, com o alias `@/` apontando para `src/`. Ainda não há testes nesta etapa: `npm test` retorna erro quando nenhum teste é encontrado. Para verificar apenas a inicialização do runner enquanto a suíte não existe, use `npm test -- --passWithNoTests`; isso não representa testes de comportamento aprovados.

O ESLint permanece na versão 9 porque os plugins de React, imports e acessibilidade usados pelo preset do Next.js ainda não declaram suporte à versão 10. A auditoria atual aponta um aviso moderado em `minimatch`, transitivo do `typescript-eslint`, e seus dependentes de desenvolvimento. `npm audit fix` não resolveu esse aviso; a atualização depende de uma versão compatível das ferramentas.

## Estado atual

Base Next.js com App Router e TypeScript estrito. As funcionalidades de atendimento serão adicionadas em etapas.
