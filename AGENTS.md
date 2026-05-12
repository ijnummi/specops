# AGENTS.md

Guidance for coding agents working in this repository.

## Project Basics

SpecOps Workbench is a pnpm TypeScript monorepo.

- `apps/api`: Fastify API.
- `apps/web`: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, and CodeMirror UI.
- `packages/db`: Drizzle/PostgreSQL schema and migration runner.
- `packages/markdown`: SpecOps markdown parsing and project initialization.
- `packages/repo-scanner`: TypeScript/JavaScript source inventory scanner.

Markdown and source files are canonical. PostgreSQL stores rebuildable derived cache data.

## Normal Local Ports

Use these ports unless the user explicitly says otherwise:

- PostgreSQL: `localhost:5436`
- API: `http://127.0.0.1:4004`
- Web: `http://127.0.0.1:5176`

Do not assume the older defaults `4000` for the API or `5173` for Vite.

## Environment

The repo root `.env.example` is the source for local defaults:

```sh
DATABASE_URL=postgres://specops:specops@localhost:5436/specops
API_HOST=127.0.0.1
API_PORT=4004
VITE_API_URL=http://127.0.0.1:4004
```

`pnpm db:migrate` and the API load the nearest `.env`. The web app reads root env values through Vite.

## Common Commands

```sh
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Validation:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

DB-backed API tests require `TEST_DATABASE_URL`, usually:

```sh
export TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test
```

## Working Rules

- Prefer `rg` for searching.
- Keep changes scoped to the requested task.
- Do not revert user changes.
- Use the repo's existing TypeScript, React, Fastify, Drizzle, and Vitest patterns.
- For frontend changes, verify with focused tests and browser inspection when practical.
