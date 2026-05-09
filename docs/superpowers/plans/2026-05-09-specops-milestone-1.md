# SpecOps Workbench Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Milestone 1 markdown-native SpecOps Workbench vertical slice in the current repository.

**Architecture:** Use a pnpm TypeScript monorepo with React web, Fastify API, PostgreSQL/Drizzle database package, and focused shared packages for domain types, contracts, markdown parsing, graph helpers, and testing fixtures. Markdown under configured `specops/` folders remains canonical; PostgreSQL is a rebuildable cache and workflow store.

**Tech Stack:** pnpm, TypeScript, React, Vite, TanStack Router, TanStack Query, CodeMirror 6, Tailwind CSS, Fastify, Zod, Drizzle ORM, PostgreSQL, Vitest, Docker Compose.

---

## File Structure

Create and maintain these files.

### Root

- Create: `.gitignore` - excludes dependency, build, database, and browser-companion artifacts.
- Create: `.env.example` - local development environment variables.
- Create: `package.json` - workspace scripts and shared dev dependencies.
- Create: `pnpm-workspace.yaml` - pnpm workspace package globs.
- Create: `tsconfig.base.json` - common TypeScript compiler options.
- Create: `vitest.config.ts` - shared Vitest configuration.
- Create: `docker-compose.yml` - PostgreSQL service.
- Modify: `README.md` - setup and Milestone 1 workflow.

### Applications

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/lib/http-errors.ts`
- Create: `apps/api/src/lib/path-safety.ts`
- Create: `apps/api/src/services/project-service.ts`
- Create: `apps/api/src/services/indexer-service.ts`
- Create: `apps/api/src/services/specops-initializer.ts`
- Create: `apps/api/src/routes/projects.ts`
- Create: `apps/api/src/routes/entities.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/routes/validation.ts`
- Create: `apps/api/src/routes/index-runs.ts`
- Create: `apps/api/src/__tests__/indexer-service.test.ts`

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/routes/root.tsx`
- Create: `apps/web/src/routes/projects.tsx`
- Create: `apps/web/src/routes/project-detail.tsx`
- Create: `apps/web/src/components/project-create-form.tsx`
- Create: `apps/web/src/components/project-card.tsx`
- Create: `apps/web/src/components/workbench-layout.tsx`
- Create: `apps/web/src/components/entity-list.tsx`
- Create: `apps/web/src/components/entity-create-form.tsx`
- Create: `apps/web/src/components/entity-detail.tsx`
- Create: `apps/web/src/components/markdown-editor.tsx`
- Create: `apps/web/src/components/link-panels.tsx`
- Create: `apps/web/src/components/validation-panel.tsx`

- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`

### Packages

- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/types.ts`

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/projects.ts`
- Create: `packages/contracts/src/entities.ts`
- Create: `packages/contracts/src/indexing.ts`
- Create: `packages/contracts/src/validation.ts`

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/migrations/0000_initial.sql`

- Create: `packages/markdown/package.json`
- Create: `packages/markdown/tsconfig.json`
- Create: `packages/markdown/src/index.ts`
- Create: `packages/markdown/src/types.ts`
- Create: `packages/markdown/src/discover.ts`
- Create: `packages/markdown/src/parse.ts`
- Create: `packages/markdown/src/links.ts`
- Create: `packages/markdown/src/validate.ts`
- Create: `packages/markdown/src/templates.ts`
- Create: `packages/markdown/src/init-specops.ts`
- Create: `packages/markdown/src/__tests__/parse.test.ts`
- Create: `packages/markdown/src/__tests__/discover.test.ts`
- Create: `packages/markdown/src/__tests__/init-specops.test.ts`

- Create: `packages/graph/package.json`
- Create: `packages/graph/tsconfig.json`
- Create: `packages/graph/src/index.ts`
- Create: `packages/graph/src/links.ts`
- Create: `packages/graph/src/__tests__/links.test.ts`

- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`

- Create: `packages/testing/package.json`
- Create: `packages/testing/tsconfig.json`
- Create: `packages/testing/src/index.ts`
- Create: `packages/testing/src/fs-fixtures.ts`

- Create: `packages/repo-scanner/package.json`
- Create: `packages/repo-scanner/tsconfig.json`
- Create: `packages/repo-scanner/src/index.ts`
- Create: `packages/taskgen/package.json`
- Create: `packages/taskgen/tsconfig.json`
- Create: `packages/taskgen/src/index.ts`
- Create: `packages/ai-prefill/package.json`
- Create: `packages/ai-prefill/tsconfig.json`
- Create: `packages/ai-prefill/src/index.ts`

### Initial Canonical Specs

- Create: `specops/project.yaml`
- Create: `specops/decisions/adr-001-markdown-is-source-of-truth.md`
- Create: `specops/decisions/adr-002-postgresql-is-derived-cache.md`
- Create: `specops/decisions/adr-003-flexible-spec-graph.md`
- Create: `specops/domain/project.md`
- Create: `specops/domain/spec-entity.md`
- Create: `specops/domain/spec-link.md`
- Create: `specops/domain/spec-file.md`
- Create: `specops/domain/index-run.md`
- Create: `specops/domain/validation-message.md`
- Create: `specops/interfaces/project-registry-service.md`
- Create: `specops/interfaces/markdown-indexer.md`
- Create: `specops/interfaces/spec-entity-service.md`
- Create: `specops/interfaces/graph-query-service.md`
- Create: `specops/use-cases/uc.create-project.md`
- Create: `specops/use-cases/uc.initialize-specops-folder.md`
- Create: `specops/use-cases/uc.index-spec-files.md`
- Create: `specops/use-cases/uc.edit-spec-entity.md`
- Create: `specops/use-cases/uc.link-spec-entities.md`
- Create: `specops/use-cases/uc.generate-agent-task.md`
- Create: `specops/templates/use-case.template.md`
- Create: `specops/templates/domain-entity.template.md`
- Create: `specops/templates/interface.template.md`
- Create: `specops/templates/data-model.template.md`
- Create: `specops/templates/ui-view.template.md`
- Create: `specops/templates/agent-task.template.md`
- Create: `specops/templates/adr.template.md`

---

## Task 1: Bootstrap Workspace

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `docker-compose.yml`
- Create: package manifests and `tsconfig.json` files for all apps and packages
- Modify: `README.md`

- [ ] **Step 1: Create root workspace configuration**

Create `.gitignore`:

```gitignore
node_modules/
dist/
build/
coverage/
.env
.DS_Store
.superpowers/
*.tsbuildinfo
apps/web/.vite/
```

Create `.env.example`:

```dotenv
DATABASE_URL=postgres://specops:specops@localhost:5432/specops
API_HOST=127.0.0.1
API_PORT=4000
VITE_API_URL=http://127.0.0.1:4000
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@specops/contracts": ["packages/contracts/src/index.ts"],
      "@specops/db": ["packages/db/src/index.ts"],
      "@specops/domain": ["packages/domain/src/index.ts"],
      "@specops/markdown": ["packages/markdown/src/index.ts"],
      "@specops/graph": ["packages/graph/src/index.ts"],
      "@specops/config": ["packages/config/src/index.ts"],
      "@specops/testing": ["packages/testing/src/index.ts"]
    }
  }
}
```

Create `package.json`:

```json
{
  "name": "specops-workbench",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --parallel --filter api --filter web dev",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "db:migrate": "pnpm --filter @specops/db migrate"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  },
  "packageManager": "pnpm@9.12.3"
}
```

- [ ] **Step 2: Create shared Vitest and Docker configuration**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"]
  }
});
```

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: specops-postgres
    environment:
      POSTGRES_USER: specops
      POSTGRES_PASSWORD: specops
      POSTGRES_DB: specops
    ports:
      - "5432:5432"
    volumes:
      - specops_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U specops -d specops"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  specops_postgres_data:
```

- [ ] **Step 3: Create package manifests**

Each package manifest should use this pattern, adjusted for the package name and dependencies:

```json
{
  "name": "@specops/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

Each package `tsconfig.json` should use:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Use app-specific dependencies:

- `apps/api`: `@fastify/cors`, `fastify`, `zod`, `@specops/contracts`, `@specops/db`, `@specops/domain`, `@specops/markdown`, `@specops/graph`
- `apps/web`: `@vitejs/plugin-react`, `vite`, `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-router`, `@codemirror/lang-markdown`, `@uiw/react-codemirror`, `lucide-react`, `tailwindcss`, `postcss`, `autoprefixer`, `@specops/contracts`
- `packages/db`: `drizzle-orm`, `drizzle-kit`, `pg`
- `packages/markdown`: `gray-matter`, `yaml`, `zod`, `@specops/domain`
- `packages/contracts`: `zod`

- [ ] **Step 4: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile is created and packages install without dependency resolution errors.

- [ ] **Step 5: Verify bootstrap**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: both commands complete successfully. Packages without tests should pass through `vitest run --passWithNoTests`.

- [ ] **Step 6: Commit bootstrap**

Run:

```bash
git add .gitignore .env.example package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts docker-compose.yml apps packages README.md
git commit -m "chore: bootstrap SpecOps workspace"
```

Expected: commit contains only workspace scaffolding and dependency lockfile changes.

---

## Task 2: Add Domain Types And Contracts

**Files:**
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/contracts/src/projects.ts`
- Create: `packages/contracts/src/entities.ts`
- Create: `packages/contracts/src/indexing.ts`
- Create: `packages/contracts/src/validation.ts`
- Create: `packages/contracts/src/index.ts`

- [ ] **Step 1: Add domain types**

Create `packages/domain/src/types.ts`:

```ts
export type ValidationLevel = "error" | "warning" | "info";

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoPath: string;
  specopsPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecEntity = {
  id: string;
  projectId: string;
  entityId: string;
  type: string;
  title: string;
  status: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecLink = {
  id: string;
  projectId: string;
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
  confidence: number | null;
  createdAt: string;
};

export type IndexRun = {
  id: string;
  projectId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  entityCount: number;
  linkCount: number;
  errorCount: number;
  warningCount: number;
  gitCommit: string | null;
};

export type ValidationMessage = {
  id: string;
  projectId: string;
  indexRunId: string | null;
  filePath: string | null;
  entityId: string | null;
  level: ValidationLevel;
  code: string;
  message: string;
  createdAt: string;
};
```

Create `packages/domain/src/index.ts`:

```ts
export type {
  IndexRun,
  Project,
  SpecEntity,
  SpecLink,
  ValidationLevel,
  ValidationMessage
} from "./types.js";
```

- [ ] **Step 2: Add Zod contract schemas**

Create `packages/contracts/src/projects.ts`:

```ts
import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  repoPath: z.string(),
  specopsPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  specopsPath: z.string().min(1)
});

export const updateProjectRequestSchema = createProjectRequestSchema.partial();

export type ProjectDto = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
```

Create `packages/contracts/src/entities.ts`:

```ts
import { z } from "zod";

export const specEntitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  entityId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  filePath: z.string(),
  frontmatter: z.record(z.unknown()),
  bodyMarkdown: z.string(),
  bodyText: z.string(),
  contentHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const specLinkSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  linkType: z.string(),
  source: z.string(),
  confidence: z.number().nullable(),
  createdAt: z.string()
});

export const createEntityRequestSchema = z.object({
  entityId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.string().default("draft")
});

export const updateEntityMarkdownRequestSchema = z.object({
  markdown: z.string()
});

export type SpecEntityDto = z.infer<typeof specEntitySchema>;
export type SpecLinkDto = z.infer<typeof specLinkSchema>;
export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;
export type UpdateEntityMarkdownRequest = z.infer<typeof updateEntityMarkdownRequestSchema>;
```

Create `packages/contracts/src/indexing.ts`:

```ts
import { z } from "zod";

export const indexRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  entityCount: z.number(),
  linkCount: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  gitCommit: z.string().nullable()
});

export type IndexRunDto = z.infer<typeof indexRunSchema>;
```

Create `packages/contracts/src/validation.ts`:

```ts
import { z } from "zod";

export const validationLevelSchema = z.enum(["error", "warning", "info"]);

export const validationMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  indexRunId: z.string().nullable(),
  filePath: z.string().nullable(),
  entityId: z.string().nullable(),
  level: validationLevelSchema,
  code: z.string(),
  message: z.string(),
  createdAt: z.string()
});

export type ValidationMessageDto = z.infer<typeof validationMessageSchema>;
```

Create `packages/contracts/src/index.ts`:

```ts
export * from "./entities.js";
export * from "./indexing.js";
export * from "./projects.js";
export * from "./validation.js";
```

- [ ] **Step 3: Verify contracts**

Run:

```bash
pnpm --filter @specops/domain typecheck
pnpm --filter @specops/contracts typecheck
```

Expected: both commands pass.

- [ ] **Step 4: Commit domain and contracts**

Run:

```bash
git add packages/domain packages/contracts
git commit -m "feat: add domain types and API contracts"
```

Expected: commit contains only domain and contracts package source.

---

## Task 3: Add Database Schema And Migrations

**Files:**
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/migrations/0000_initial.sql`

- [ ] **Step 1: Define Drizzle schema**

Create `packages/db/src/schema.ts` with tables matching the design. Use UUID primary keys with `gen_random_uuid()`, timestamps with `now()`, and indexes for project/entity lookups.

Key constraints:

- `projects.slug` unique
- `spec_files(project_id, path)` unique
- `spec_entities(project_id, entity_id)` unique
- `spec_links(project_id, from_entity_id, to_entity_id, link_type, source)` unique

- [ ] **Step 2: Add database client**

Create `packages/db/src/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type Db = ReturnType<typeof createDb>;

export function createPool(connectionString: string) {
  return new Pool({ connectionString });
}

export function createDb(connectionString: string) {
  const pool = createPool(connectionString);
  return drizzle(pool, { schema });
}
```

Create `packages/db/src/index.ts`:

```ts
export * from "./client.js";
export * from "./schema.js";
```

- [ ] **Step 3: Add migration SQL**

Create `packages/db/migrations/0000_initial.sql` with `CREATE EXTENSION IF NOT EXISTS pgcrypto;` and all tables from the design. Include `ON DELETE CASCADE` foreign keys from project-derived records to `projects`.

- [ ] **Step 4: Add migration runner**

Create `packages/db/src/migrate.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const sql = await readFile(join(__dirname, "../migrations/0000_initial.sql"), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
}
```

- [ ] **Step 5: Verify database package**

Run:

```bash
docker compose up -d postgres
pnpm --filter @specops/db typecheck
pnpm --filter @specops/db migrate
```

Expected: PostgreSQL starts and migration completes without SQL errors.

- [ ] **Step 6: Commit database schema**

Run:

```bash
git add packages/db docker-compose.yml
git commit -m "feat: add database schema and migrations"
```

Expected: commit contains database schema, migration, and database package support files.

---

## Task 4: Implement Markdown Parser And Templates With Tests

**Files:**
- Create: `packages/markdown/src/types.ts`
- Create: `packages/markdown/src/discover.ts`
- Create: `packages/markdown/src/links.ts`
- Create: `packages/markdown/src/parse.ts`
- Create: `packages/markdown/src/validate.ts`
- Create: `packages/markdown/src/templates.ts`
- Create: `packages/markdown/src/init-specops.ts`
- Create: `packages/markdown/src/index.ts`
- Create: `packages/markdown/src/__tests__/parse.test.ts`
- Create: `packages/markdown/src/__tests__/discover.test.ts`
- Create: `packages/markdown/src/__tests__/init-specops.test.ts`

- [ ] **Step 1: Write parser tests**

Create tests covering:

- valid frontmatter and body parsing
- missing required fields
- malformed frontmatter
- typed link extraction from nested frontmatter arrays
- invalid link values ignored with validation warning

Use assertions like:

```ts
import { describe, expect, it } from "vitest";
import { parseSpecMarkdown } from "../parse.js";

describe("parseSpecMarkdown", () => {
  it("parses required frontmatter and body", () => {
    const result = parseSpecMarkdown("use-cases/uc.demo.md", `---
id: uc.demo
type: use_case
title: Demo
status: draft
links:
  domain:
    - domain.project
---

# Demo
`);

    expect(result.entity?.entityId).toBe("uc.demo");
    expect(result.entity?.title).toBe("Demo");
    expect(result.links).toEqual([
      {
        fromEntityId: "uc.demo",
        toEntityId: "domain.project",
        linkType: "domain",
        source: "frontmatter:links.domain"
      }
    ]);
    expect(result.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @specops/markdown test
```

Expected: tests fail because parser modules are not implemented.

- [ ] **Step 3: Implement markdown types and parser**

Implement `parseSpecMarkdown(filePath, markdown)` so it returns:

```ts
export type ParsedSpecEntity = {
  entityId: string;
  type: string;
  title: string;
  status: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  bodyText: string;
  filePath: string;
};

export type ParsedSpecLink = {
  fromEntityId: string;
  toEntityId: string;
  linkType: string;
  source: string;
};

export type ParseResult = {
  filePath: string;
  entity: ParsedSpecEntity | null;
  links: ParsedSpecLink[];
  messages: Array<{
    level: "error" | "warning" | "info";
    code: string;
    message: string;
    filePath: string;
    entityId: string | null;
  }>;
};
```

Rules:

- missing `id`, `type`, `title`, or `status` produces an error
- malformed frontmatter produces an error and returns no entity
- valid links are extracted from `frontmatter.links`
- body text strips markdown punctuation conservatively for search
- empty body produces an info message

- [ ] **Step 4: Implement discovery and templates**

Implement:

- `discoverMarkdownFiles(specopsPath)` using `fs/promises` recursive directory traversal
- `createEntityMarkdown(input)` for deterministic new entity markdown
- `initialSpecopsFiles()` returning path/content pairs for starter specs and templates
- `initializeSpecopsFolder(specopsPath)` creating directories and missing files without overwriting existing files

- [ ] **Step 5: Verify markdown package**

Run:

```bash
pnpm --filter @specops/markdown test
pnpm --filter @specops/markdown typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit markdown package**

Run:

```bash
git add packages/markdown
git commit -m "feat: add markdown parsing and specops templates"
```

Expected: commit contains markdown package source and tests.

---

## Task 5: Implement Graph Helpers With Tests

**Files:**
- Create: `packages/graph/src/links.ts`
- Create: `packages/graph/src/index.ts`
- Create: `packages/graph/src/__tests__/links.test.ts`

- [ ] **Step 1: Write graph tests**

Create tests for:

- outgoing links by entity
- backlinks by entity
- broken link detection
- orphan entity detection

Use assertions like:

```ts
import { describe, expect, it } from "vitest";
import { findBacklinks, findBrokenLinks } from "../links.js";

const entities = [
  { entityId: "uc.demo" },
  { entityId: "domain.project" }
];

const links = [
  { fromEntityId: "uc.demo", toEntityId: "domain.project", linkType: "domain", source: "frontmatter:links.domain" },
  { fromEntityId: "uc.demo", toEntityId: "domain.missing", linkType: "domain", source: "frontmatter:links.domain" }
];

describe("graph links", () => {
  it("finds backlinks", () => {
    expect(findBacklinks("domain.project", links)).toHaveLength(1);
  });

  it("finds broken links", () => {
    expect(findBrokenLinks(entities, links)).toEqual([links[1]]);
  });
});
```

- [ ] **Step 2: Implement graph helpers**

Implement pure functions:

- `findOutgoingLinks(entityId, links)`
- `findBacklinks(entityId, links)`
- `findBrokenLinks(entities, links)`
- `findOrphanEntities(entities, links)`

- [ ] **Step 3: Verify graph package**

Run:

```bash
pnpm --filter @specops/graph test
pnpm --filter @specops/graph typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 4: Commit graph helpers**

Run:

```bash
git add packages/graph
git commit -m "feat: add graph link helpers"
```

Expected: commit contains graph package source and tests.

---

## Task 6: Implement API Services And Indexer

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/lib/http-errors.ts`
- Create: `apps/api/src/lib/path-safety.ts`
- Create: `apps/api/src/services/project-service.ts`
- Create: `apps/api/src/services/specops-initializer.ts`
- Create: `apps/api/src/services/indexer-service.ts`
- Create: `apps/api/src/__tests__/indexer-service.test.ts`

- [ ] **Step 1: Write indexer service tests**

Create tests that use a temporary `specops/` folder and a test database or isolated service boundary to verify:

- first index creates files, entities, links, and validation messages
- second index with unchanged files produces the same entity/link counts
- deleting a markdown file removes its derived entity and links
- duplicate IDs produce validation errors
- broken links produce warnings

Use temporary folders from `node:fs/promises` and `node:os`.

- [ ] **Step 2: Add config and path safety helpers**

Create `apps/api/src/config.ts`:

```ts
export type ApiConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

export function loadConfig(env = process.env): ApiConfig {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    databaseUrl: env.DATABASE_URL,
    host: env.API_HOST ?? "127.0.0.1",
    port: Number(env.API_PORT ?? "4000")
  };
}
```

Create `apps/api/src/lib/path-safety.ts`:

```ts
import { resolve, relative } from "node:path";

export function assertInsideDirectory(baseDir: string, targetPath: string) {
  const base = resolve(baseDir);
  const target = resolve(targetPath);
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel === ".." || rel.startsWith("/") || rel === "") {
    if (target !== base) {
      throw new Error(`Path is outside allowed directory: ${targetPath}`);
    }
  }
  return target;
}
```

- [ ] **Step 3: Implement project service**

Implement methods:

- `listProjects()`
- `createProject(input)`
- `getProject(projectId)`
- `updateProject(projectId, input)`
- `getProjectSummary(projectId)` with counts used by UI

Use Drizzle queries and map snake_case database columns to camelCase DTOs.

- [ ] **Step 4: Implement specops initializer service**

Implement `initializeProjectSpecops(projectId)`:

- load project
- ensure `specopsPath` is inside or equal to `repoPath` when practical
- call `initializeSpecopsFolder(specopsPath)`
- return created/skipped file counts

- [ ] **Step 5: Implement indexer service**

Implement `indexProject(projectId)`:

- create running index run
- discover markdown files
- parse all files independently
- compute content hashes with SHA-256
- detect duplicate entity IDs
- upsert `spec_files`
- replace `spec_entities` for parsed valid entities
- replace `spec_links` for parsed valid links
- delete derived records for removed files/entities
- write validation messages for parser output, duplicate IDs, broken links, orphan entities, and empty bodies
- update index run with final counts and `succeeded` or `failed`

- [ ] **Step 6: Verify API service tests**

Run:

```bash
docker compose up -d postgres
pnpm --filter @specops/db migrate
pnpm --filter api test
pnpm --filter api typecheck
```

Expected: indexer tests and typecheck pass.

- [ ] **Step 7: Commit API services**

Run:

```bash
git add apps/api/src/config.ts apps/api/src/lib apps/api/src/services apps/api/src/__tests__
git commit -m "feat: add project and indexing services"
```

Expected: commit contains API service layer and service tests.

---

## Task 7: Implement Fastify Routes

**Files:**
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/routes/projects.ts`
- Create: `apps/api/src/routes/entities.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/routes/validation.ts`
- Create: `apps/api/src/routes/index-runs.ts`

- [ ] **Step 1: Implement Fastify server composition**

Create `apps/api/src/server.ts`:

```ts
import cors from "@fastify/cors";
import Fastify from "fastify";
import { createDb } from "@specops/db";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerIndexRunRoutes } from "./routes/index-runs.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerValidationRoutes } from "./routes/validation.js";

export function buildServer(databaseUrl: string) {
  const app = Fastify({ logger: true });
  const db = createDb(databaseUrl);

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.register(registerProjectRoutes, { prefix: "/api", db });
  app.register(registerEntityRoutes, { prefix: "/api", db });
  app.register(registerSearchRoutes, { prefix: "/api", db });
  app.register(registerValidationRoutes, { prefix: "/api", db });
  app.register(registerIndexRunRoutes, { prefix: "/api", db });

  return app;
}
```

Create `apps/api/src/index.ts`:

```ts
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const server = buildServer(config.databaseUrl);

await server.listen({ host: config.host, port: config.port });
```

- [ ] **Step 2: Implement project routes**

Routes:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/init-specops`
- `POST /api/projects/:projectId/index`

Validate request bodies with contract schemas before calling services.

- [ ] **Step 3: Implement entity routes**

Routes:

- `GET /api/projects/:projectId/entities`
- `GET /api/projects/:projectId/entities/:entityId`
- `POST /api/projects/:projectId/entities`
- `PUT /api/projects/:projectId/entities/:entityId/markdown`
- `GET /api/projects/:projectId/entities/:entityId/outgoing-links`
- `GET /api/projects/:projectId/entities/:entityId/backlinks`

Entity creation should create markdown from `createEntityMarkdown`, write it under the correct type directory, index the project, and return the created entity.

Markdown save should resolve the indexed entity file path, assert the target is inside `specopsPath`, write the markdown file, index the project, and return the refreshed entity.

- [ ] **Step 4: Implement search, validation, and index-run routes**

Routes:

- `GET /api/projects/:projectId/search?q=...`
- `GET /api/projects/:projectId/validation-messages`
- `GET /api/projects/:projectId/index-runs`

Search should match ID, title, type, and body with case-insensitive SQL matching.

- [ ] **Step 5: Verify API routes manually**

Run:

```bash
docker compose up -d postgres
pnpm --filter @specops/db migrate
pnpm --filter api dev
```

Then in another shell:

```bash
curl http://127.0.0.1:4000/health
```

Expected:

```json
{"ok":true}
```

- [ ] **Step 6: Verify API package**

Run:

```bash
pnpm --filter api typecheck
pnpm --filter api test
```

Expected: both commands pass.

- [ ] **Step 7: Commit API routes**

Run:

```bash
git add apps/api/src/server.ts apps/api/src/index.ts apps/api/src/routes
git commit -m "feat: expose SpecOps API routes"
```

Expected: commit contains API route implementations.

---

## Task 8: Add Initial Canonical SpecOps Documents

**Files:**
- Create: files listed in the "Initial Canonical Specs" section

- [ ] **Step 1: Create `specops/project.yaml`**

Use:

```yaml
id: specops-workbench
name: SpecOps Workbench
specops_version: 1
description: Local-first markdown-native workbench for specs-driven AI-assisted software development.
```

- [ ] **Step 2: Create ADR documents**

Each ADR file should use frontmatter:

```yaml
---
id: adr.001-markdown-source-of-truth
type: adr
title: Markdown is the source of truth
status: accepted
---
```

Body sections:

- Context
- Decision
- Consequences

- [ ] **Step 3: Create domain, interface, and use-case specs**

Each spec file must include required frontmatter and useful body sections. Use IDs from the brief:

- `domain.project`
- `domain.spec-entity`
- `domain.spec-link`
- `domain.spec-file`
- `domain.index-run`
- `domain.validation-message`
- `interface.project-registry-service`
- `interface.markdown-indexer`
- `interface.spec-entity-service`
- `interface.graph-query-service`
- `uc.create-project`
- `uc.initialize-specops-folder`
- `uc.index-spec-files`
- `uc.edit-spec-entity`
- `uc.link-spec-entities`
- `uc.generate-agent-task`

Include links between use cases, domain entities, and interfaces so the initial graph is useful for dogfooding.

- [ ] **Step 4: Create templates**

Each template should include `{{id}}`, `{{title}}`, `{{type}}`, and `{{status}}` tokens in frontmatter, plus body headings appropriate to the type.

- [ ] **Step 5: Verify initial docs parse**

Run:

```bash
pnpm --filter @specops/markdown test
```

Expected: markdown package tests still pass. If an initializer test validates starter files, it should include the root `specops/` documents.

- [ ] **Step 6: Commit initial specs**

Run:

```bash
git add specops
git commit -m "docs: add initial SpecOps specs"
```

Expected: commit contains only canonical SpecOps markdown and templates.

---

## Task 9: Implement React Web Workbench

**Files:**
- Create: all `apps/web` files listed in File Structure

- [ ] **Step 1: Create Vite, Tailwind, and app entry**

Create a Vite React app manually in `apps/web`. Configure:

- Vite dev server on port `5173`
- `VITE_API_URL` defaulting to `http://127.0.0.1:4000`
- Tailwind content paths for `index.html` and `src/**/*.{ts,tsx}`

- [ ] **Step 2: Implement API client**

Create `apps/web/src/api/client.ts` with:

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
```

- [ ] **Step 3: Implement project dashboard**

Dashboard behavior:

- fetch projects
- show project cards
- show create-project form
- after creation, navigate to project detail
- show empty state when there are no projects

- [ ] **Step 4: Implement project detail workbench**

Project detail behavior:

- fetch project
- fetch entities
- fetch validation messages
- fetch index runs
- show grouped navigation by common types
- filter/search local entity list by query field
- provide manual "Initialize specops" and "Re-index" buttons

- [ ] **Step 5: Implement entity creation and detail**

Entity behavior:

- create entity by ID, type, title, and status
- fetch selected entity by route param
- render CodeMirror markdown editor
- save full markdown document
- refetch entity, links, backlinks, validation messages after save
- show outgoing and backlink panels

- [ ] **Step 6: Implement UI styling**

Use a restrained workbench style:

- app shell with top bar and two-column project detail layout
- no landing-page hero
- no decorative gradients
- cards only for project cards and repeated list items
- stable editor and panel dimensions
- small-radius controls
- lucide icons for action buttons where useful

- [ ] **Step 7: Verify web app**

Run:

```bash
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: typecheck and production build pass.

- [ ] **Step 8: Commit web app**

Run:

```bash
git add apps/web
git commit -m "feat: add React workbench UI"
```

Expected: commit contains the web application implementation.

---

## Task 10: Add Worker Stub And README

**Files:**
- Create: `apps/worker/src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Add worker stub**

Create `apps/worker/src/index.ts`:

```ts
console.log("SpecOps worker is available for future asynchronous jobs. Milestone 1 indexing runs through the API.");
```

- [ ] **Step 2: Write README**

README must include:

- project mission
- architecture summary
- prerequisites
- setup commands
- Docker Compose PostgreSQL command
- database migration command
- dev server command
- Milestone 1 workflow
- validation commands
- note that markdown is canonical and PostgreSQL is rebuildable cache

Required command block:

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Required validation block:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

- [ ] **Step 3: Verify docs and worker**

Run:

```bash
pnpm --filter worker typecheck
pnpm typecheck
pnpm test
```

Expected: worker typecheck, root typecheck, and tests pass.

- [ ] **Step 4: Commit worker and README**

Run:

```bash
git add apps/worker README.md
git commit -m "docs: document Milestone 1 workflow"
```

Expected: commit contains README and worker stub.

---

## Task 11: End-To-End Milestone 1 Verification

**Files:**
- Modify only files needed to fix defects found during verification.

- [ ] **Step 1: Start database and run migrations**

Run:

```bash
docker compose up -d postgres
pnpm db:migrate
```

Expected: PostgreSQL is healthy and migration succeeds.

- [ ] **Step 2: Run automated validation**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands pass.

- [ ] **Step 3: Start local dev servers**

Run:

```bash
pnpm dev
```

Expected:

- API listens on `http://127.0.0.1:4000`
- web app listens on `http://127.0.0.1:5173`

- [ ] **Step 4: Verify app workflow manually**

In the browser:

1. Open `http://127.0.0.1:5173`.
2. Create a project named `SpecOps Workbench`.
3. Set repo path to the current repository path.
4. Set specops path to the current repository `specops/` path.
5. Initialize `specops/`.
6. Re-index.
7. Open an entity detail page.
8. Edit markdown in CodeMirror.
9. Save.
10. Re-index.
11. Confirm outgoing links and backlinks render.
12. Search for an entity by ID, title, type, and body text.

- [ ] **Step 5: Verify rebuildability**

Delete derived cache records while preserving project registry, then re-index:

```sql
delete from validation_messages;
delete from spec_links;
delete from spec_entities;
delete from spec_files;
delete from index_runs;
```

Expected: re-index repopulates entities, links, files, validation messages, and index runs from markdown.

- [ ] **Step 6: Fix verification defects**

For each defect:

1. Add or update the narrowest test that reproduces it.
2. Run the failing test and confirm it fails.
3. Implement the fix.
4. Run the focused test and confirm it passes.
5. Run the relevant package typecheck.

- [ ] **Step 7: Final validation commit**

Run:

```bash
git status --short
git add .
git commit -m "fix: complete Milestone 1 verification"
```

Expected: final commit contains only fixes required by end-to-end verification.

---

## Self-Review

Spec coverage:

- Repository bootstrap is covered by Task 1.
- Database schema and migrations are covered by Task 3.
- Shared contracts and domain types are covered by Task 2.
- Markdown parsing, validation, discovery, and initialization are covered by Task 4.
- Graph traversal, backlinks, broken links, and orphan checks are covered by Task 5.
- Indexing and rebuildability are covered by Task 6 and Task 11.
- API endpoints are covered by Task 7.
- React UI workflow is covered by Task 9.
- Initial `specops/` documents are covered by Task 8.
- Docker Compose and README are covered by Task 1 and Task 10.
- Milestone 1 non-goals remain excluded.

Placeholder scan:

- The plan contains no unresolved filler markers, vague task names without implementation detail, or future milestone implementation work.

Type consistency:

- Domain DTO names, contract schema names, indexer concepts, and route names are consistent across tasks.
