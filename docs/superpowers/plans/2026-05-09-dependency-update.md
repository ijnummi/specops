# Dependency Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update external project dependencies to current stable versions while isolating high-risk ecosystem migrations into separately verifiable phases.

**Architecture:** This is a pnpm TypeScript workspace with root tooling, web app dependencies, API/database dependencies, and shared package dependencies. Target selection is based on the maturity of the stable major line, not the publication date of the newest patch inside that line. Each phase updates one dependency family, runs focused checks first, then runs full workspace gates before committing.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, Vite, React, Tailwind CSS, Fastify, Drizzle ORM, PostgreSQL, Zod.

---

## Current Baseline

As of 2026-05-09:

- Workspace root: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- App manifests: `apps/api/package.json`, `apps/web/package.json`, `apps/worker/package.json`
- Package manifests: `packages/*/package.json`
- Baseline checks pass:
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `pnpm build` passes with the existing Vite large-chunk warning for `apps/web`
- `pnpm audit --prod --json` currently reports:
  - High: `drizzle-orm <0.45.2`
  - Moderate: transitive `esbuild <=0.24.2` through `drizzle-kit`

## Target Policy

Use the latest stable package version when the stable major line is mature enough for normal adoption. Do not block an update merely because the latest patch was published recently.

Use the most commonly used mature line only when the stable major line itself is newly released, has unusually high blast radius, or conflicts with the project runtime.

Recommended targets:

| Dependency family | Target | Reason |
| --- | --- | --- |
| pnpm | `10.33.4` | `pnpm@11.0.0` was first published on 2026-04-28; keep package-manager migration on the mature 10 line unless the team explicitly wants pnpm 11 now |
| Node types | `@types/node@^24.12.3` | Match the project’s Node 24 runtime instead of adopting Node 25 types |
| TypeScript | `typescript@^6.0.3` | TypeScript 6 stable line started on 2026-03-23 |
| Vite | `vite@^8.0.11`, `@vitejs/plugin-react@^6.0.1` | Vite 8 stable line started on 2026-03-12; newest patch date is not a blocker |
| Vitest | `vitest@^4.1.5` | Vitest 4 stable line started on 2025-10-22 |
| React | `react@^19.2.6`, `react-dom@^19.2.6`, `@types/react@^19.2.14`, `@types/react-dom@^19.2.3` | React 19 stable line started on 2024-12-05 |
| Tailwind | `tailwindcss@^4.3.0` plus Tailwind 4 PostCSS migration | Tailwind 4 stable line started on 2025-01-21 |
| Drizzle | `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10` | Required to clear the high-severity Drizzle advisory |
| Fastify | `fastify@^5.8.5`, `@fastify/cors@^11.2.0` | Fastify 5 is already in use; isolate CORS plugin major |
| PostgreSQL client | `pg@^8.20.0`, `@types/pg@^8.20.0` | Latest stable same-major line |
| Validation | `zod@^4.4.3` | Zod 4 stable line started on 2025-07-09 |
| UI/editor utilities | Latest stable for `@codemirror/lang-markdown`, `@uiw/react-codemirror`, `lucide-react`, TanStack packages | Low runtime coupling, verified in web phase |
| Build utilities | Latest stable for `tsx`, `yaml`, `postcss`, `autoprefixer` | Same-major or mature utility updates |

## Verification Gates

Run these after every phase unless the phase specifies a narrower first check:

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm build
pnpm audit --prod
```

For web-facing phases, also run:

```bash
pnpm --filter web build
pnpm --filter web dev
```

Open `http://127.0.0.1:5173` and smoke-test project list, project detail, entity editor markdown, validation panel, and agent task preview.

For API/database phases, also run with a local database:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm --filter api test
pnpm --filter api dev
```

Smoke-test:

```bash
curl http://127.0.0.1:3000/health
```

## Phase 0: Freeze Baseline

**Files:**
- Read: `package.json`
- Read: `apps/api/package.json`
- Read: `apps/web/package.json`
- Read: `packages/db/package.json`
- Read: `packages/contracts/package.json`
- Read: `packages/markdown/package.json`
- Read: `pnpm-lock.yaml`

- [ ] **Step 1: Confirm working tree**

```bash
git status --short --branch
```

Expected: unrelated local changes are documented before updates begin.

- [ ] **Step 2: Capture outdated and audit state**

```bash
pnpm outdated -r --format json > /tmp/specops-pnpm-outdated-before.json
pnpm audit --prod --json > /tmp/specops-pnpm-audit-before.json
```

Expected: commands may exit non-zero because outdated packages and audit findings exist.

- [ ] **Step 3: Re-run baseline checks**

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

Expected: all pass before dependency edits.

## Phase 1: Security-Critical Database Refresh

**Files:**
- Modify: `apps/api/package.json`
- Modify: `packages/db/package.json`
- Modify: `pnpm-lock.yaml`

Rationale: `drizzle-orm` has a high-severity advisory below `0.45.2`. Updating Drizzle first reduces security exposure and should also clear the transitive `esbuild` audit finding if `drizzle-kit` no longer pulls vulnerable esbuild versions.

- [ ] **Step 1: Update Drizzle and PostgreSQL packages**

```bash
pnpm --filter api add drizzle-orm@^0.45.2 pg@^8.20.0
pnpm --filter api add -D @types/pg@^8.20.0
pnpm --filter @specops/db add drizzle-orm@^0.45.2 drizzle-kit@^0.31.10 pg@^8.20.0
pnpm --filter @specops/db add -D @types/pg@^8.20.0
```

- [ ] **Step 2: Verify database package**

```bash
pnpm --filter @specops/db typecheck
pnpm --filter @specops/db test
pnpm --filter api typecheck
pnpm --filter api test
pnpm audit --prod
```

Expected: typecheck/test pass; Drizzle advisory is gone.

- [ ] **Step 3: Verify migrations**

```bash
docker compose up -d postgres
pnpm db:migrate
```

Expected: migrations run without Drizzle config/schema errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json packages/db/package.json pnpm-lock.yaml
git commit -m "chore: update database dependencies"
```

## Phase 2: Low-Risk Runtime and Utility Refresh

**Files:**
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/markdown/package.json`
- Modify: `packages/taskgen/package.json`
- Modify: `pnpm-lock.yaml`

Rationale: These are same-major or low-surface updates. Keep TypeScript, React, Zod, Vite, Vitest, Tailwind, and package-manager changes out of this phase.

- [ ] **Step 1: Update shared runtime utilities**

```bash
pnpm add -w tsx@^4.21.0
pnpm --filter api add fastify@^5.8.5 yaml@^2.8.4
pnpm --filter @specops/markdown add gray-matter@^4.0.3 yaml@^2.8.4
pnpm --filter @specops/taskgen add yaml@^2.8.4
pnpm --filter web add yaml@^2.8.4
```

- [ ] **Step 2: Update editor and icon utilities**

```bash
pnpm --filter web add @codemirror/lang-markdown@^6.5.0 @uiw/react-codemirror@^4.25.9 lucide-react@^1.14.0
```

- [ ] **Step 3: Verify**

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json apps/api/package.json apps/web/package.json packages/markdown/package.json packages/taskgen/package.json pnpm-lock.yaml
git commit -m "chore: update runtime utility dependencies"
```

## Phase 3: Package Manager and Node Type Alignment

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

Rationale: Keep package-manager changes separate because they can rewrite lockfile metadata. Use mature pnpm 10 for the main update. Add a final optional pnpm 11 trial only after all dependency migrations pass.

- [ ] **Step 1: Update package manager field and Node types**

```bash
corepack prepare pnpm@10.33.4 --activate
pnpm add -w -D @types/node@^24.12.3
```

Edit `package.json`:

```json
"packageManager": "pnpm@10.33.4"
```

- [ ] **Step 2: Regenerate lockfile with pnpm 10**

```bash
pnpm install
```

- [ ] **Step 3: Verify**

```bash
pnpm -v
pnpm -r typecheck
pnpm -r test
pnpm build
```

Expected: `pnpm -v` prints `10.33.4`; all checks pass.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update pnpm and node types"
```

## Phase 4: Vite 8 and Vitest 4 Toolchain

**Files:**
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify if required: `vitest.config.ts`
- Modify if required: `apps/web/vite.config.ts`
- Modify: `pnpm-lock.yaml`

Rationale: Vite 8 and `@vitejs/plugin-react` 6 stable lines started on 2026-03-12, so use the latest Vite 8 patch. Keep this isolated because build tooling touches every package through tests and web builds.

- [ ] **Step 1: Update Vitest and Vite latest stable lines**

```bash
pnpm add -w -D vitest@^4.1.5
pnpm --filter web add -D vite@^8.0.11 @vitejs/plugin-react@^6.0.1 postcss@^8.5.14 autoprefixer@^10.5.0
```

- [ ] **Step 2: Run focused toolchain checks**

```bash
pnpm --filter web test
pnpm --filter web build
pnpm -r test
```

Expected: tests and web build pass. If Vitest or Vite config options changed, update `vitest.config.ts` or `apps/web/vite.config.ts` minimally and rerun.

- [ ] **Step 3: Run full verification**

```bash
pnpm -r typecheck
pnpm build
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json apps/web/package.json vitest.config.ts apps/web/vite.config.ts pnpm-lock.yaml
git commit -m "chore: update vite and vitest"
```

## Phase 5: TypeScript 6

**Files:**
- Modify: `package.json`
- Modify if required: `tsconfig.base.json`
- Modify if required: package source files surfaced by TypeScript 6 diagnostics
- Modify: `pnpm-lock.yaml`

Rationale: TypeScript major upgrades can expose new diagnostics. Keep this isolated so any source edits are clearly attributable.

- [ ] **Step 1: Update TypeScript**

```bash
pnpm add -w -D typescript@^6.0.3
```

- [ ] **Step 2: Run typecheck only**

```bash
pnpm -r typecheck
```

Expected: pass, or fail with TypeScript 6 diagnostics only.

- [ ] **Step 3: Fix TypeScript 6 diagnostics**

Make minimal source or `tsconfig.base.json` changes. Do not change runtime behavior unless a compile error reveals an actual bug.

- [ ] **Step 4: Verify**

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json pnpm-lock.yaml apps packages
git commit -m "chore: update typescript"
```

## Phase 6: React 19 and TanStack Refresh

**Files:**
- Modify: `apps/web/package.json`
- Modify if required: `apps/web/src/main.tsx`
- Modify if required: `apps/web/src/app.tsx`
- Modify if required: `apps/web/src/routes/*.tsx`
- Modify if required: `apps/web/src/components/*.tsx`
- Modify: `pnpm-lock.yaml`

Rationale: React 19 has been stable since 2024-12-05. TanStack packages are same-major and should be verified with the web UI in the same phase.

- [ ] **Step 1: Update React and TanStack packages**

```bash
pnpm --filter web add react@^19.2.6 react-dom@^19.2.6 @tanstack/react-query@^5.100.9 @tanstack/react-router@^1.169.2
pnpm --filter web add -D @types/react@^19.2.14 @types/react-dom@^19.2.3
```

- [ ] **Step 2: Run focused checks**

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
```

Expected: pass, or fail only with React 19 type/runtime migration issues.

- [ ] **Step 3: Smoke-test web app**

```bash
pnpm --filter web dev
```

Open `http://127.0.0.1:5173` and verify:

- Project list renders.
- Project detail route renders.
- Entity markdown display renders.
- Entity editor markdown still edits and previews content.
- Agent task preview state tests match visible behavior.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/src pnpm-lock.yaml
git commit -m "chore: update react web dependencies"
```

## Phase 7: Zod 4 Migration

**Files:**
- Modify: `apps/api/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/markdown/package.json`
- Modify if required: `apps/api/src/**/*.ts`
- Modify if required: `packages/contracts/src/**/*.ts`
- Modify if required: `packages/markdown/src/**/*.ts`
- Modify: `pnpm-lock.yaml`

Rationale: Zod is shared across API, contracts, and markdown parsing. Keep this phase focused because Zod 4 can alter type inference and error formatting.

- [ ] **Step 1: Update all Zod consumers together**

```bash
pnpm --filter api add zod@^4.4.3
pnpm --filter @specops/contracts add zod@^4.4.3
pnpm --filter @specops/markdown add zod@^4.4.3
```

- [ ] **Step 2: Run focused checks**

```bash
pnpm --filter @specops/contracts test
pnpm --filter @specops/markdown test
pnpm --filter api test
pnpm --filter @specops/contracts typecheck
pnpm --filter @specops/markdown typecheck
pnpm --filter api typecheck
```

Expected: pass, or fail only around Zod schema APIs, inferred types, or error snapshots.

- [ ] **Step 3: Fix Zod 4 incompatibilities**

Focus on schema construction, parsing, and validation error expectations. Avoid changing API response contracts unless Zod 4 forces a deliberate compatibility decision.

- [ ] **Step 4: Run full verification**

```bash
pnpm -r typecheck
pnpm -r test
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json packages/contracts/package.json packages/markdown/package.json apps/api/src packages/contracts/src packages/markdown/src pnpm-lock.yaml
git commit -m "chore: migrate to zod 4"
```

## Phase 8: Fastify CORS Major

**Files:**
- Modify: `apps/api/package.json`
- Modify if required: `apps/api/src/server.ts`
- Modify if required: `apps/api/src/index.ts`
- Modify if required: `apps/api/src/__tests__/routes.test.ts`
- Modify: `pnpm-lock.yaml`

Rationale: Fastify is already on major 5, but `@fastify/cors` has a major jump from 10 to 11. Isolate server plugin behavior and route tests.

- [ ] **Step 1: Update CORS plugin**

```bash
pnpm --filter api add @fastify/cors@^11.2.0
```

- [ ] **Step 2: Verify API**

```bash
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api build
```

- [ ] **Step 3: Smoke-test server**

```bash
pnpm --filter api dev
curl http://127.0.0.1:3000/health
```

Expected: health endpoint returns success and CORS registration does not throw during startup.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/src pnpm-lock.yaml
git commit -m "chore: update fastify cors"
```

## Phase 9: Tailwind 4 Migration

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/postcss.config.js`
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/**/*.tsx` if class names need migration
- Modify: `pnpm-lock.yaml`

Rationale: Tailwind 4 stable line started on 2025-01-21, so target the latest stable Tailwind 4 release. Keep it separate because Tailwind 4 changes the CSS pipeline and can create visual regressions even when tests pass.

- [ ] **Step 1: Update Tailwind 4 packages**

```bash
pnpm --filter web add -D tailwindcss@^4.3.0 @tailwindcss/postcss@latest
```

- [ ] **Step 2: Update PostCSS config**

Replace `apps/web/postcss.config.js` with:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Build CSS**

```bash
pnpm --filter web build
```

Expected: Vite build succeeds and Tailwind classes are present in `apps/web/dist/assets/*.css`.

- [ ] **Step 4: Fix Tailwind 4 class or config incompatibilities**

If the build fails, update `apps/web/src/styles.css`, `apps/web/tailwind.config.ts`, or affected `apps/web/src/**/*.tsx` files based on the actual Tailwind 4 diagnostic. Keep class changes mechanical and route-scoped.

- [ ] **Step 5: Verify web behavior**

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm --filter web dev
```

Open `http://127.0.0.1:5173` and verify:

- Layout spacing and colors are preserved.
- Buttons and forms render correctly.
- Markdown editor and preview panels retain usable sizing.
- Validation and link panels do not overflow on desktop width.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/postcss.config.js apps/web/tailwind.config.ts apps/web/src pnpm-lock.yaml
git commit -m "chore: migrate to tailwind 4"
```

## Phase 10: Final Audit and Optional pnpm 11 Trial

**Files:**
- Modify if required: `package.json`
- Modify if required: workspace package manifests
- Modify: `pnpm-lock.yaml`
- Create if needed: `docs/dependency-update-notes.md`

- [ ] **Step 1: Check remaining outdated packages**

```bash
pnpm outdated -r
```

Expected: only consciously deferred packages remain. The expected deferrals are `pnpm@11.x` and `@types/node@25.x`.

- [ ] **Step 2: Check audit**

```bash
pnpm audit --prod
```

Expected: no high or critical findings. Moderate findings require explicit documented acceptance or a follow-up issue.

- [ ] **Step 3: Run final verification**

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
pnpm build
```

Expected: all pass from a clean install.

- [ ] **Step 4: Optional pnpm 11 trial**

Run this only after all previous phases pass:

```bash
corepack prepare pnpm@11.0.9 --activate
pnpm install
pnpm -v
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
pnpm build
```

If all checks pass and the team accepts the newer package manager line, edit `package.json`:

```json
"packageManager": "pnpm@11.0.9"
```

Then commit:

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update pnpm 11"
```

- [ ] **Step 5: Document deferred latest versions**

Record the reason for each deferred latest line:

- `pnpm@11.x` if not adopted: package-manager major first published on 2026-04-28.
- `@types/node@25.x`: does not match the Node 24 runtime.

## Rollback Strategy

- Revert one phase commit at a time rather than reverting the full branch.
- If `pnpm install` changes too much after a package-manager update, revert Phase 3 and retry with `pnpm@9.15.9` before continuing.
- If Vite 8 causes web build issues, revert Phase 4 and split Vitest 4 from Vite 8.
- If TypeScript 6 exposes broad diagnostics, keep previous phase commits and defer only Phase 5.
- If React 19 causes runtime issues, keep TanStack updates only if they pass independently, then defer React 19 with a follow-up issue.
- If Zod 4 changes API validation responses, either update tests and contracts deliberately in Phase 7 or defer Zod at `3.25.76`.
- If Tailwind 4 creates visual regressions, revert only Phase 9 and keep all earlier dependency updates.

## Completion Criteria

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm -r typecheck` succeeds.
- `pnpm -r test` succeeds.
- `pnpm build` succeeds.
- `pnpm audit --prod` has no high or critical findings.
- `pnpm outdated -r` shows only documented deferrals.
