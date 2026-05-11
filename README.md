# SpecOps Workbench

SpecOps Workbench is a local-first specification workbench for creating, editing, indexing, and navigating markdown-native product and engineering specs. The current local workflow includes canonical markdown files under `specops/`, PostgreSQL-backed derived indexes, source inventory scanning, an API, and a web UI for project and spec workflows.

## Architecture

This repository is a pnpm TypeScript monorepo with:

- `apps/web`: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, and CodeMirror UI.
- `apps/api`: Fastify API for projects, markdown initialization, indexing, source inventory, entities, search, links, and validation messages.
- `apps/worker`: future asynchronous worker entrypoint. In Milestone 1, indexing runs synchronously through the API.
- `packages/domain`, `packages/contracts`, `packages/markdown`, `packages/graph`, and `packages/db`: shared domain types, Zod contracts, markdown parsing, graph helpers, and Drizzle/PostgreSQL persistence.
- `packages/repo-scanner`, `packages/taskgen`, and `packages/ai-prefill`: source scanning, agent task generation, and AI-assisted prefill workflows.

Markdown and source files are canonical. PostgreSQL stores rebuildable cache data for indexed entities, links, source inventory, index runs, and validation messages. If database cache data is deleted, it can be rebuilt by indexing the project again.

## Prerequisites

- Node.js 20 or newer.
- pnpm 9.12.3 or compatible via Corepack.
- Docker with Docker Compose for local PostgreSQL.
- A shell environment that can copy `.env.example` to `.env`.

Some environments expose Compose as `docker-compose` instead of `docker compose`. This repo's normal local PostgreSQL port is `5436`, matching `.env.example`. If that port is occupied, adjust the Compose port mapping and update `DATABASE_URL` in `.env`.

## Local Ports

The normal local ports are:

- PostgreSQL: `localhost:5436`
- API: `http://127.0.0.1:4004`
- Web: `http://127.0.0.1:5176`

Avoid using stale defaults like API port `4000` or Vite port `5173` for this repo.

## Setup

Command summary:

```sh
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Runnable local flow:

```sh
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The `.env` file is copied for local configuration. The API and migration command load the nearest `.env` automatically, while the web app reads `VITE_API_URL` through Vite using the repo root env file.

The default `.env.example` values are:

```sh
DATABASE_URL=postgres://specops:specops@localhost:5436/specops
API_HOST=127.0.0.1
API_PORT=4004
VITE_API_URL=http://127.0.0.1:4004
```

The Docker Compose PostgreSQL command is:

```sh
docker compose up -d postgres
```

The database migration command is:

```sh
pnpm db:migrate
```

The development server command is:

```sh
pnpm dev
```

`pnpm dev` starts the API and web apps in parallel. By default, the API uses `http://127.0.0.1:4004`, and the web app uses `http://127.0.0.1:5176`.

## Local Workflow

1. Start PostgreSQL and run migrations.
2. Start the API and web app with `pnpm dev`.
3. Create a project record that points at a local repository path.
4. Initialize a `specops/` folder for that project when needed.
5. Create spec entities from templates or edit existing markdown files directly.
6. Run indexing from the API or web UI to parse markdown and scan source files into PostgreSQL.
7. Review entities, source inventory, outgoing links, backlinks, search results, index runs, and validation messages in the workbench.

Markdown and source files remain the source of truth. PostgreSQL is a cache and workflow store derived from those files, so index data can be discarded and rebuilt from the project.

## AI Prefill

AI Prefill generates reviewable spec proposals from manually selected indexed source files. Generation writes pending proposal rows only; accepting proposals writes canonical markdown under `specops/`.

Ollama is the default local provider:

```sh
ollama serve
ollama pull qwen2.5-coder:7b
```

OpenAI can be enabled by setting `OPENAI_API_KEY` and choosing the OpenAI provider in the UI.

## Validation

Command summary:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

Full DB-backed API and indexer tests require `TEST_DATABASE_URL`. Without it, those tests are skipped locally; in CI, the test suite fails if `TEST_DATABASE_URL` is absent. Use a separate test database whose database name includes `test`, for example:

```sh
export TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test
pnpm typecheck
pnpm test
pnpm --filter web build
```

Full workspace build:

```sh
pnpm build
```
