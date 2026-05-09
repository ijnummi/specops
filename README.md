# SpecOps Workbench

SpecOps Workbench is a local-first specification workbench for creating, editing, indexing, and navigating markdown-native product and engineering specs. Milestone 1 focuses on a usable vertical slice: canonical markdown files under `specops/`, a PostgreSQL-backed derived index, an API, and a web UI for project and spec workflows.

## Architecture

This repository is a pnpm TypeScript monorepo with:

- `apps/web`: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, and CodeMirror UI.
- `apps/api`: Fastify API for projects, markdown initialization, indexing, entities, search, links, and validation messages.
- `apps/worker`: future asynchronous worker entrypoint. In Milestone 1, indexing runs synchronously through the API.
- `packages/domain`, `packages/contracts`, `packages/markdown`, `packages/graph`, and `packages/db`: shared domain types, Zod contracts, markdown parsing, graph helpers, and Drizzle/PostgreSQL persistence.
- `packages/repo-scanner`, `packages/taskgen`, and `packages/ai-prefill`: future-facing package stubs for later milestones.

Markdown is canonical. PostgreSQL stores a rebuildable cache of indexed entities, links, index runs, and validation messages. If database cache data is deleted, it can be rebuilt by indexing the markdown files again.

## Prerequisites

- Node.js 20 or newer.
- pnpm 9.12.3 or compatible via Corepack.
- Docker with Docker Compose for local PostgreSQL.
- A shell environment that can copy `.env.example` to `.env`.

Some environments expose Compose as `docker-compose` instead of `docker compose`. If port `5432` is already occupied, adjust the Compose port mapping or update `DATABASE_URL` in `.env` to point at the available PostgreSQL port.

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
set -a; source .env; set +a
pnpm db:migrate
pnpm dev
```

The `.env` file is copied for local configuration, but the database migration and API process read settings from `process.env`. Load `.env` into the current shell before running `pnpm db:migrate` or `pnpm dev`, or pass the values inline:

```sh
DATABASE_URL=postgres://specops:specops@localhost:5432/specops pnpm db:migrate
DATABASE_URL=postgres://specops:specops@localhost:5432/specops pnpm dev
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

`pnpm dev` starts the API and web apps in parallel. By default, the API uses `http://127.0.0.1:4000` and the web app uses `VITE_API_URL` from `.env`.

## Milestone 1 Workflow

1. Start PostgreSQL and run migrations.
2. Start the API and web app with `pnpm dev`.
3. Create a project record that points at a local repository path.
4. Initialize a `specops/` folder for that project when needed.
5. Create spec entities from templates or edit existing markdown files directly.
6. Run indexing from the API or web UI to parse markdown into PostgreSQL.
7. Review entities, outgoing links, backlinks, search results, index runs, and validation messages in the workbench.

Markdown files remain the source of truth for specs. PostgreSQL is a cache and workflow store derived from those files, so index data can be discarded and rebuilt from markdown.

## Validation

Command summary:

```sh
pnpm typecheck
pnpm test
pnpm --filter web build
```

Full DB-backed API and indexer tests require `TEST_DATABASE_URL`. Without it, those tests are skipped locally; in CI, the test suite fails if `TEST_DATABASE_URL` is absent. Use a separate test database whose database name includes `test`, for example:

```sh
export TEST_DATABASE_URL=postgres://specops:specops@localhost:5432/specops_test
pnpm typecheck
pnpm test
pnpm --filter web build
```

Full workspace build:

```sh
pnpm build
```
