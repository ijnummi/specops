# Source Import Proposal Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a review-first source import wizard that turns TypeScript scanner facts into pending proposals, lets users review/edit/reject them, and writes only accepted proposal markdown into canonical `specops/` files.

**Architecture:** Add shared proposal contracts, expose proposal-friendly source-bootstrap generation, then implement a Fastify proposal service backed by the existing `ai_proposals` table. The web app gets a project-level import route with a batch proposal list/detail review UI, while the existing direct source bootstrap endpoint remains available outside the normal project action.

**Tech Stack:** TypeScript, Fastify, Zod, Drizzle/PostgreSQL, React, TanStack Router, TanStack Query, CodeMirror, Vitest.

---

## File Structure

Create or modify these files:

- Create `packages/contracts/src/proposals.ts`: shared Zod schemas and DTO types for proposal payloads, evidence, summaries, details, patch requests, and accept requests/responses.
- Modify `packages/contracts/src/index.ts`: export proposal contracts.
- Modify `packages/source-bootstrap/src/generate.ts`: add proposal DTO generation while keeping `generateBootstrapSpecFiles` compatible.
- Modify `packages/source-bootstrap/src/index.ts`: export new proposal generation types/functions.
- Modify `packages/source-bootstrap/src/generate.test.ts`: cover proposal payload/evidence stability.
- Create `apps/api/src/services/proposal-service.ts`: proposal generation, listing, detail, patch/reject, and all-or-nothing accept logic.
- Create `apps/api/src/routes/proposals.ts`: Fastify routes for project proposal endpoints.
- Modify `apps/api/src/server.ts`: register proposal routes.
- Modify `apps/api/src/__tests__/routes.test.ts`: DB-backed API coverage for proposal lifecycle and accept safety.
- Modify `apps/web/src/api/queries.ts`: proposal query keys and API functions.
- Modify `apps/web/src/app.tsx`: add `/projects/$projectId/import/source` route.
- Modify `apps/web/src/components/project-actions.tsx`: replace primary direct bootstrap action with import link; keep init and re-index.
- Modify `apps/web/src/routes/project-detail.tsx`: remove normal bootstrap mutation/action wiring.
- Create `apps/web/src/routes/source-import.tsx`: batch review page.
- Create `apps/web/src/routes/source-import.test.tsx`: render and interaction tests for source import page.
- Modify `apps/web/src/routes/project-detail.test.tsx` and `apps/web/src/components/project-actions.test.tsx`: update expectations from direct bootstrap to import link.

## Task 1: Contracts And Proposal-Friendly Generator

**Files:**
- Create: `packages/contracts/src/proposals.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/source-bootstrap/src/generate.ts`
- Modify: `packages/source-bootstrap/src/index.ts`
- Test: `packages/source-bootstrap/src/generate.test.ts`
- Test: `packages/contracts/src/proposals.test.ts`

- [ ] **Step 1: Write contract tests**

Create `packages/contracts/src/proposals.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  acceptProposalsRequestSchema,
  proposalDetailSchema,
  proposalListQuerySchema,
  proposalPatchRequestSchema,
  proposalSummarySchema,
  sourceSpecEntityProposalPayloadSchema
} from "./proposals.js";

describe("proposal contracts", () => {
  it("accepts source spec entity proposal payloads and summaries", () => {
    const payload = sourceSpecEntityProposalPayloadSchema.parse({
      entityId: "interface.decision-service",
      type: "interface",
      title: "DecisionService",
      status: "draft",
      filePath: "interfaces/decision-service.md",
      generatedMarkdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
      markdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
      sourceFiles: ["src/services/decision-service.ts"],
      symbols: [
        {
          name: "DecisionService",
          kind: "class",
          exported: true,
          file: "src/services/decision-service.ts",
          line: 4
        }
      ]
    });

    expect(payload.entityId).toBe("interface.decision-service");

    expect(
      proposalSummarySchema.parse({
        id: "proposal-1",
        projectId: "project-1",
        proposalType: "source_spec_entity",
        status: "pending",
        title: "DecisionService",
        entityId: "interface.decision-service",
        entityType: "interface",
        filePath: "interfaces/decision-service.md",
        confidence: 0.7,
        conflict: { status: "none" },
        createdAt: "2026-05-11T10:00:00.000Z",
        reviewedAt: null
      }).conflict.status
    ).toBe("none");
  });

  it("accepts detail, patch, list, and accept request shapes", () => {
    expect(proposalListQuerySchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(proposalPatchRequestSchema.parse({ markdown: "# Edited" })).toEqual({
      markdown: "# Edited"
    });
    expect(proposalPatchRequestSchema.parse({ status: "rejected" })).toEqual({
      status: "rejected"
    });
    expect(acceptProposalsRequestSchema.parse({ proposalIds: ["proposal-1"] })).toEqual({
      proposalIds: ["proposal-1"]
    });
    expect(
      proposalDetailSchema.parse({
        id: "proposal-1",
        projectId: "project-1",
        proposalType: "source_spec_entity",
        status: "pending",
        title: "DecisionService",
        entityId: "interface.decision-service",
        entityType: "interface",
        filePath: "interfaces/decision-service.md",
        confidence: 0.7,
        conflict: { status: "none" },
        createdAt: "2026-05-11T10:00:00.000Z",
        reviewedAt: null,
        payload: {
          entityId: "interface.decision-service",
          type: "interface",
          title: "DecisionService",
          status: "draft",
          filePath: "interfaces/decision-service.md",
          generatedMarkdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
          markdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
          sourceFiles: ["src/services/decision-service.ts"],
          symbols: []
        },
        evidence: {
          scanner: "typescript",
          sourceFiles: []
        }
      }).payload.entityId
    ).toBe("interface.decision-service");
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run:

```bash
pnpm --filter @specops/contracts test -- proposals.test.ts
```

Expected: FAIL because `packages/contracts/src/proposals.ts` does not exist.

- [ ] **Step 3: Implement proposal contracts**

Create `packages/contracts/src/proposals.ts`:

```ts
import { z } from "zod";

import { indexRunSchema } from "./indexing.js";

export const proposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "edited_and_accepted",
  "rejected",
  "obsolete"
]);

export const proposalTypeSchema = z.enum(["source_spec_entity"]);

export const sourceSpecEntityProposalPayloadSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["domain_entity", "interface"]),
  title: z.string().min(1),
  status: z.literal("draft"),
  filePath: z.string().min(1),
  generatedMarkdown: z.string().min(1),
  markdown: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)),
  symbols: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.string().min(1),
      exported: z.boolean(),
      file: z.string().min(1),
      line: z.number().nullable()
    })
  )
});

export const sourceSpecEntityProposalEvidenceSchema = z.object({
  scanner: z.literal("typescript"),
  sourceFiles: z.array(
    z.object({
      file: z.string().min(1),
      symbolName: z.string().min(1),
      symbolKind: z.string().min(1),
      exported: z.boolean(),
      line: z.number().nullable()
    })
  )
});

export const proposalConflictSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("file_exists"), filePath: z.string() }),
  z.object({ status: z.literal("entity_exists"), entityId: z.string() }),
  z.object({ status: z.literal("unavailable"), message: z.string() })
]);

export const proposalSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  proposalType: proposalTypeSchema,
  status: proposalStatusSchema,
  title: z.string(),
  entityId: z.string(),
  entityType: z.string(),
  filePath: z.string(),
  confidence: z.number().nullable(),
  conflict: proposalConflictSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

export const proposalDetailSchema = proposalSummarySchema.extend({
  payload: sourceSpecEntityProposalPayloadSchema,
  evidence: sourceSpecEntityProposalEvidenceSchema
});

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional()
});

export const proposalPatchRequestSchema = z
  .object({
    markdown: z.string().min(1).optional(),
    status: z.literal("rejected").optional()
  })
  .refine((input) => input.markdown !== undefined || input.status !== undefined, {
    message: "markdown or status is required"
  });

export const acceptProposalsRequestSchema = z.object({
  proposalIds: z.array(z.string().min(1)).min(1)
});

export const acceptProposalsResponseSchema = z.object({
  acceptedProposalIds: z.array(z.string()),
  indexRun: indexRunSchema
});

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type ProposalType = z.infer<typeof proposalTypeSchema>;
export type SourceSpecEntityProposalPayload = z.infer<
  typeof sourceSpecEntityProposalPayloadSchema
>;
export type SourceSpecEntityProposalEvidence = z.infer<
  typeof sourceSpecEntityProposalEvidenceSchema
>;
export type ProposalConflictDto = z.infer<typeof proposalConflictSchema>;
export type ProposalSummaryDto = z.infer<typeof proposalSummarySchema>;
export type ProposalDetailDto = z.infer<typeof proposalDetailSchema>;
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;
export type ProposalPatchRequest = z.infer<typeof proposalPatchRequestSchema>;
export type AcceptProposalsRequest = z.infer<typeof acceptProposalsRequestSchema>;
export type AcceptProposalsResponse = z.infer<typeof acceptProposalsResponseSchema>;
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./agent-tasks.js";
export * from "./change-impact.js";
export * from "./entities.js";
export * from "./impact.js";
export * from "./indexing.js";
export * from "./projects.js";
export * from "./proposals.js";
export * from "./source.js";
export * from "./validation.js";
```

- [ ] **Step 4: Run contract tests**

Run:

```bash
pnpm --filter @specops/contracts test -- proposals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write source-bootstrap proposal generation tests**

Append to `packages/source-bootstrap/src/generate.test.ts`:

```ts
import { generateBootstrapSpecProposals } from "./generate.js";

it("generates source spec entity proposal payloads and evidence", () => {
  const proposals = generateBootstrapSpecProposals(scanResult());

  expect(proposals.map((proposal) => proposal.payload.filePath)).toEqual([
    "domain/decision-link.md",
    "domain/decision.md",
    "domain/workspace.md",
    "interfaces/decision-service.md",
    "interfaces/reminder-scheduler.md"
  ]);
  expect(proposals[3]).toMatchObject({
    proposalType: "source_spec_entity",
    title: "DecisionService",
    confidence: 0.7,
    payload: {
      entityId: "interface.decision-service",
      type: "interface",
      filePath: "interfaces/decision-service.md",
      sourceFiles: ["src/services/decision-service.ts"]
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: [
        {
          file: "src/services/decision-service.ts",
          symbolName: "DecisionService",
          symbolKind: "class",
          exported: true,
          line: 4
        }
      ]
    }
  });
});
```

- [ ] **Step 6: Run source-bootstrap test to verify it fails**

Run:

```bash
pnpm --filter @specops/source-bootstrap test -- generate.test.ts
```

Expected: FAIL because `generateBootstrapSpecProposals` is not exported.

- [ ] **Step 7: Implement proposal-friendly generator**

Modify `packages/source-bootstrap/src/generate.ts` by adding these exports near the existing types and function:

```ts
export type BootstrapSpecProposal = {
  proposalType: "source_spec_entity";
  title: string;
  confidence: number;
  payload: {
    entityId: string;
    type: "domain_entity" | "interface";
    title: string;
    status: "draft";
    filePath: string;
    generatedMarkdown: string;
    markdown: string;
    sourceFiles: string[];
    symbols: Array<{
      name: string;
      kind: string;
      exported: boolean;
      file: string;
      line: number | null;
    }>;
  };
  evidence: {
    scanner: "typescript";
    sourceFiles: Array<{
      file: string;
      symbolName: string;
      symbolKind: string;
      exported: boolean;
      line: number | null;
    }>;
  };
};

export function generateBootstrapSpecProposals(scan: ScanRepositoryResult): BootstrapSpecProposal[] {
  return generateBootstrapSpecFiles(scan).map((file) => ({
    proposalType: "source_spec_entity",
    title: file.title,
    confidence: 0.7,
    payload: {
      entityId: file.entityId,
      type: file.type,
      title: file.title,
      status: "draft",
      filePath: file.path,
      generatedMarkdown: file.content,
      markdown: file.content,
      sourceFiles: [...new Set(file.evidence.map((item) => item.sourceFile))],
      symbols: file.evidence.map((item) => ({
        name: item.symbolName,
        kind: item.symbolKind,
        exported: item.exported,
        file: item.sourceFile,
        line: item.line
      }))
    },
    evidence: {
      scanner: "typescript",
      sourceFiles: file.evidence.map((item) => ({
        file: item.sourceFile,
        symbolName: item.symbolName,
        symbolKind: item.symbolKind,
        exported: item.exported,
        line: item.line
      }))
    }
  }));
}
```

Modify `packages/source-bootstrap/src/index.ts`:

```ts
export * from "./annotate.js";
export { generateBootstrapSpecFiles, generateBootstrapSpecProposals, slugifySourceSymbol } from "./generate.js";
export type {
  BootstrapGeneratedSpecFile,
  BootstrapSourceEvidence,
  BootstrapSpecProposal
} from "./generate.js";
```

- [ ] **Step 8: Run generator tests**

Run:

```bash
pnpm --filter @specops/source-bootstrap test -- generate.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit contracts and generator**

Run:

```bash
git add packages/contracts/src/index.ts packages/contracts/src/proposals.ts packages/contracts/src/proposals.test.ts packages/source-bootstrap/src/generate.ts packages/source-bootstrap/src/generate.test.ts packages/source-bootstrap/src/index.ts
git commit -m "feat: add source import proposal contracts"
```

## Task 2: Proposal Service Generation, Listing, Detail, And Patch

**Files:**
- Create: `apps/api/src/services/proposal-service.ts`
- Create: `apps/api/src/routes/proposals.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add API tests for generation/list/detail/patch**

In `apps/api/src/__tests__/routes.test.ts`, add focused tests near the existing source bootstrap tests:

```ts
  it("generates source import proposals without writing markdown files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as Array<{ title: string; status: string; filePath: string }>;
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "DecisionService",
          status: "pending",
          filePath: "interfaces/decision-service.md"
        })
      ])
    );
    expect(await fileExists(path.join(project.specopsPath, "interfaces", "decision-service.md"))).toBe(false);
  });

  it("obsoletes prior pending source import proposals on regeneration", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);

    await app.inject({ method: "POST", url: `/api/projects/${project.id}/proposals/source-import` });
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/proposals/source-import` });

    const pending = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=pending`
    });
    const obsolete = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals?status=obsolete`
    });

    expect(pending.statusCode).toBe(200);
    expect(obsolete.statusCode).toBe(200);
    expect((pending.json() as unknown[]).length).toBeGreaterThan(0);
    expect((obsolete.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it("returns proposal detail and persists edited markdown", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const proposal = (generated.json() as Array<{ id: string; title: string }>).find(
      (item) => item.title === "DecisionService"
    )!;

    const detail = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });
    const original = detail.json() as { payload: { markdown: string } };
    const editedMarkdown = original.payload.markdown.replace(
      "Initial spec generated from exported source symbol",
      "Reviewed spec generated from exported source symbol"
    );
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`,
      payload: { markdown: editedMarkdown }
    });

    expect(detail.statusCode).toBe(200);
    expect(patch.statusCode).toBe(200);
    expect(patch.json().payload.markdown).toContain("Reviewed spec generated");
  });

  it("rejects a pending source import proposal", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const proposal = (generated.json() as Array<{ id: string }>)[0]!;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`,
      payload: { status: "rejected" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: proposal.id, status: "rejected" });
    expect(response.json().reviewedAt).toEqual(expect.any(String));
  });
```

Add this helper near existing route test helpers if it does not already exist:

```ts
async function writeSampleSourceProject(repoPath: string) {
  await mkdir(path.join(repoPath, "src", "services"), { recursive: true });
  await writeFile(
    path.join(repoPath, "src", "domain.ts"),
    [
      "export interface Decision {",
      "  id: string;",
      "}",
      "",
      "export type Workspace = {",
      "  id: string;",
      "};",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(repoPath, "src", "services", "decision-service.ts"),
    [
      "import type { Decision } from '../domain';",
      "",
      "export class DecisionService {",
      "  list(): Decision[] {",
      "    return [];",
      "  }",
      "}",
      ""
    ].join("\n")
  );
}
```

- [ ] **Step 2: Run API tests to verify they fail**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "source import proposal"
```

Expected: FAIL because proposal routes are not registered.

- [ ] **Step 3: Implement proposal service read/generate/patch**

Create `apps/api/src/services/proposal-service.ts` with this initial service shape:

```ts
import path from "node:path";
import { access } from "node:fs/promises";

import {
  proposalPatchRequestSchema,
  proposalStatusSchema,
  sourceSpecEntityProposalEvidenceSchema,
  sourceSpecEntityProposalPayloadSchema,
  type ProposalDetailDto,
  type ProposalStatus,
  type ProposalSummaryDto
} from "@specops/contracts";
import type { Db } from "@specops/db";
import { aiProposals, specEntities } from "@specops/db";
import { generateBootstrapSpecProposals } from "@specops/source-bootstrap";
import { scanRepository } from "@specops/repo-scanner";
import { and, asc, eq } from "drizzle-orm";

import { BadRequestError, ConflictError, NotFoundError } from "../lib/http-errors.js";
import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

const sourceSpecEntityProposalType = "source_spec_entity" as const;

export function createProposalService(db: Db) {
  const projectService = createProjectService(db);

  return {
    async generateSourceImportProposals(projectId: string): Promise<ProposalSummaryDto[]> {
      const project = await projectService.getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
      assertInsideDirectory(repoPath, specopsPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);
      await assertExistingParentInsideDirectory(repoPath, specopsPath);

      const scan = await scanRepository({ repoPath });
      if (scan.files.length === 0) {
        throw new BadRequestError("No supported source files found");
      }

      const generated = generateBootstrapSpecProposals(scan);
      if (generated.length === 0) {
        throw new BadRequestError("No eligible exported source symbols found");
      }

      await db
        .update(aiProposals)
        .set({ status: "obsolete", reviewedAt: new Date() })
        .where(
          and(
            eq(aiProposals.projectId, projectId),
            eq(aiProposals.proposalType, sourceSpecEntityProposalType),
            eq(aiProposals.status, "pending")
          )
        );

      const inserted = await db
        .insert(aiProposals)
        .values(
          generated.map((proposal) => ({
            projectId,
            proposalType: proposal.proposalType,
            title: proposal.title,
            payloadJson: proposal.payload,
            evidenceJson: proposal.evidence,
            confidence: proposal.confidence,
            status: "pending"
          }))
        )
        .returning();

      return Promise.all(inserted.map((row) => mapSummary(db, row)));
    },

    async listProposals(projectId: string, status?: ProposalStatus): Promise<ProposalSummaryDto[]> {
      await projectService.getProject(projectId);
      const filters = [eq(aiProposals.projectId, projectId)];
      if (status) filters.push(eq(aiProposals.status, status));
      const rows = await db
        .select()
        .from(aiProposals)
        .where(and(...filters))
        .orderBy(asc(aiProposals.createdAt), asc(aiProposals.title));
      return Promise.all(rows.map((row) => mapSummary(db, row)));
    },

    async getProposal(projectId: string, proposalId: string): Promise<ProposalDetailDto> {
      await projectService.getProject(projectId);
      const row = await getProposalRow(projectId, proposalId);
      return mapDetail(db, row);
    },

    async patchProposal(
      projectId: string,
      proposalId: string,
      input: unknown
    ): Promise<ProposalDetailDto> {
      await projectService.getProject(projectId);
      const patch = proposalPatchRequestSchema.parse(input);
      const row = await getProposalRow(projectId, proposalId);
      if (row.status !== "pending") {
        throw new ConflictError("Only pending proposals can be edited or rejected");
      }

      const payload = sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
      const nextPayload =
        patch.markdown === undefined ? payload : { ...payload, markdown: patch.markdown };
      const nextStatus = patch.status ?? row.status;
      const [updated] = await db
        .update(aiProposals)
        .set({
          payloadJson: nextPayload,
          status: nextStatus,
          reviewedAt: nextStatus === "rejected" ? new Date() : row.reviewedAt
        })
        .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.id, proposalId)))
        .returning();

      if (!updated) throw new NotFoundError("Proposal not found", { projectId, proposalId });
      return mapDetail(db, updated);
    }
  };

  async function getProposalRow(projectId: string, proposalId: string) {
    const [row] = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.id, proposalId)))
      .limit(1);
    if (!row) throw new NotFoundError("Proposal not found", { projectId, proposalId });
    return row;
  }
}

async function mapSummary(db: Db, row: typeof aiProposals.$inferSelect): Promise<ProposalSummaryDto> {
  const payload = sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
  return {
    id: row.id,
    projectId: row.projectId,
    proposalType: sourceSpecEntityProposalType,
    status: proposalStatusSchema.parse(row.status),
    title: row.title,
    entityId: payload.entityId,
    entityType: payload.type,
    filePath: payload.filePath,
    confidence: row.confidence,
    conflict: await readConflict(db, row.projectId, payload),
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null
  };
}

async function mapDetail(db: Db, row: typeof aiProposals.$inferSelect): Promise<ProposalDetailDto> {
  const summary = await mapSummary(db, row);
  return {
    ...summary,
    payload: sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson),
    evidence: sourceSpecEntityProposalEvidenceSchema.parse(row.evidenceJson)
  };
}

async function readConflict(
  db: Db,
  projectId: string,
  payload: { entityId: string; filePath: string }
) {
  const [existingEntity] = await db
    .select({ id: specEntities.id })
    .from(specEntities)
    .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, payload.entityId)))
    .limit(1);
  if (existingEntity) return { status: "entity_exists" as const, entityId: payload.entityId };

  return { status: "none" as const };
}
```

This first pass checks indexed entity conflicts. Task 3 adds authoritative filesystem conflict checks during accept.

- [ ] **Step 4: Implement proposal routes**

Create `apps/api/src/routes/proposals.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { acceptProposalsRequestSchema, proposalListQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";

import { createProposalService } from "../services/proposal-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const proposalParamsSchema = z.object({
  projectId: z.string().min(1),
  proposalId: z.string().min(1)
});

export const registerProposalRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const proposalService = createProposalService(db);

  app.post("/projects/:projectId/proposals/source-import", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const proposals = await proposalService.generateSourceImportProposals(projectId);
    return reply.code(201).send(proposals);
  });

  app.get("/projects/:projectId/proposals", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = proposalListQuerySchema.parse(request.query);
    return proposalService.listProposals(projectId, query.status);
  });

  app.get("/projects/:projectId/proposals/:proposalId", async (request) => {
    const { projectId, proposalId } = proposalParamsSchema.parse(request.params);
    return proposalService.getProposal(projectId, proposalId);
  });

  app.patch("/projects/:projectId/proposals/:proposalId", async (request) => {
    const { projectId, proposalId } = proposalParamsSchema.parse(request.params);
    return proposalService.patchProposal(projectId, proposalId, request.body);
  });

  app.post("/projects/:projectId/proposals/accept", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = acceptProposalsRequestSchema.parse(request.body);
    return proposalService.acceptProposals(projectId, input);
  });
};
```

Temporarily add this stub method inside `createProposalService` so the route typechecks until Task 3:

```ts
async acceptProposals(): Promise<never> {
  throw new BadRequestError("Proposal acceptance is not implemented");
}
```

Modify `apps/api/src/server.ts`:

```ts
import { registerProposalRoutes } from "./routes/proposals.js";
```

and register it:

```ts
app.register(registerProposalRoutes, { prefix: "/api", db });
```

- [ ] **Step 5: Run generation/list/detail/patch tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "source import proposal"
```

Expected: PASS for generation/list/detail/patch tests. Accept tests are not added until Task 3.

- [ ] **Step 6: Commit proposal service read flow**

Run:

```bash
git add apps/api/src/services/proposal-service.ts apps/api/src/routes/proposals.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: add source import proposal API"
```

## Task 3: All-Or-Nothing Proposal Accept

**Files:**
- Modify: `apps/api/src/services/proposal-service.ts`
- Test: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add accept safety tests**

Add tests to `apps/api/src/__tests__/routes.test.ts`:

```ts
  it("accepts selected source import proposals, writes markdown, and re-indexes", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const proposal = (generated.json() as Array<{ id: string; title: string }>).find(
      (item) => item.title === "DecisionService"
    )!;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      acceptedProposalIds: [proposal.id],
      indexRun: { status: "succeeded" }
    });
    const markdownPath = path.join(project.specopsPath, "interfaces", "decision-service.md");
    expect(await readFile(markdownPath, "utf8")).toContain("id: interface.decision-service");
  });

  it("marks edited accepted proposals as edited_and_accepted", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const proposal = (generated.json() as Array<{ id: string; title: string }>).find(
      (item) => item.title === "DecisionService"
    )!;
    const detail = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });
    const markdown = detail.json().payload.markdown.replace("# DecisionService", "# DecisionService\n\nReviewed.");
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`,
      payload: { markdown }
    });

    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [proposal.id] }
    });
    const accepted = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/proposals/${proposal.id}`
    });

    expect(accepted.json().status).toBe("edited_and_accepted");
  });

  it("refuses accept when the target file exists without writing any selected files", async () => {
    app = buildServer(testDatabaseUrl!);
    const project = await createProjectViaApi();
    await writeSampleSourceProject(project.repoPath);
    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/source-import`
    });
    const proposals = generated.json() as Array<{ id: string; title: string; filePath: string }>;
    const decision = proposals.find((item) => item.title === "Decision")!;
    const service = proposals.find((item) => item.title === "DecisionService")!;
    const existingPath = path.join(project.specopsPath, decision.filePath);
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "---\nid: domain.decision\n---\n\n# Existing\n");

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/proposals/accept`,
      payload: { proposalIds: [decision.id, service.id] }
    });

    expect(response.statusCode).toBe(409);
    expect(await fileExists(path.join(project.specopsPath, service.filePath))).toBe(false);
  });
```

- [ ] **Step 2: Run accept tests to verify they fail**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "accept"
```

Expected: FAIL because accept is still a stub.

- [ ] **Step 3: Implement accept in proposal service**

Replace the accept stub in `apps/api/src/services/proposal-service.ts` with:

```ts
async acceptProposals(
  projectId: string,
  input: { proposalIds: string[] }
): Promise<{ acceptedProposalIds: string[]; indexRun: Awaited<ReturnType<ReturnType<typeof createIndexerService>["indexProject"]>> }> {
  const project = await projectService.getProject(projectId);
  const repoPath = assertAbsolutePath("repoPath", project.repoPath);
  const specopsPath = assertAbsolutePath("specopsPath", project.specopsPath);
  assertInsideDirectory(repoPath, specopsPath);
  await assertRealPathInsideDirectory(repoPath, repoPath);
  await assertExistingParentInsideDirectory(repoPath, specopsPath);
  const realSpecopsPath = await assertRealPathInsideDirectory(repoPath, specopsPath);

  const rows = await db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.proposalType, sourceSpecEntityProposalType)));
  const selectedRows = input.proposalIds.map((proposalId) => {
    const row = rows.find((candidate) => candidate.id === proposalId);
    if (!row) throw new NotFoundError("Proposal not found", { projectId, proposalId });
    return row;
  });

  const seenEntityIds = new Set<string>();
  const seenPaths = new Set<string>();
  const prepared: Array<{
    row: typeof aiProposals.$inferSelect;
    payload: SourceSpecEntityProposalPayload;
    targetPath: string;
    generatedMarkdown: string;
  }> = [];

  for (const row of selectedRows) {
    if (row.status !== "pending") {
      throw new ConflictError("Only pending proposals can be accepted", { proposalId: row.id });
    }
    const payload = sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
    const parsed = parseSpecMarkdown(payload.filePath, payload.markdown);
    if (parsed.messages.some((message) => message.level === "error") || !parsed.entity) {
      throw new BadRequestError("Invalid proposal markdown", { proposalId: row.id, messages: parsed.messages });
    }
    if (parsed.entity.entityId !== payload.entityId || parsed.entity.type !== payload.type) {
      throw new BadRequestError("Proposal markdown identity mismatch", { proposalId: row.id });
    }
    if (seenEntityIds.has(payload.entityId) || seenPaths.has(payload.filePath)) {
      throw new ConflictError("Selected proposals contain duplicate target identity", {
        entityId: payload.entityId,
        filePath: payload.filePath
      });
    }
    seenEntityIds.add(payload.entityId);
    seenPaths.add(payload.filePath);

    const [existingEntity] = await db
      .select({ id: specEntities.id })
      .from(specEntities)
      .where(and(eq(specEntities.projectId, projectId), eq(specEntities.entityId, payload.entityId)))
      .limit(1);
    if (existingEntity) {
      throw new ConflictError("Target entity already exists", { entityId: payload.entityId });
    }

    const targetPath = assertInsideDirectory(realSpecopsPath, path.join(realSpecopsPath, payload.filePath));
    await assertExistingParentInsideDirectory(realSpecopsPath, targetPath);
    try {
      await access(targetPath);
      throw new ConflictError("Target markdown file already exists", { filePath: payload.filePath });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    prepared.push({
      row,
      payload,
      targetPath,
      generatedMarkdown: payload.generatedMarkdown
    });
  }

  const writtenPaths: string[] = [];
  try {
    for (const item of prepared) {
      await mkdir(path.dirname(item.targetPath), { recursive: true });
      await writeFile(item.targetPath, item.payload.markdown, { flag: "wx" });
      writtenPaths.push(item.targetPath);
    }
    const indexRun = await createIndexerService(db).indexProject(projectId);
    for (const item of prepared) {
      await db
        .update(aiProposals)
        .set({
          status: item.payload.markdown === item.generatedMarkdown ? "accepted" : "edited_and_accepted",
          reviewedAt: new Date()
        })
        .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.id, item.row.id)));
    }
    return { acceptedProposalIds: prepared.map((item) => item.row.id), indexRun };
  } catch (error) {
    await Promise.all(writtenPaths.map((writtenPath) => rm(writtenPath, { force: true })));
    throw error;
  }
}
```

Add the required imports:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { parseSpecMarkdown } from "@specops/markdown";
import type { SourceSpecEntityProposalPayload } from "@specops/contracts";
import { createIndexerService } from "./indexer-service.js";
```

Add helper:

```ts
function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
```

During implementation, avoid duplicate `fs/promises` imports by merging `access`, `mkdir`, `rm`, and `writeFile` into one import.

- [ ] **Step 4: Run accept tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "accept"
```

Expected: PASS.

- [ ] **Step 5: Run all proposal-related API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "proposal"
```

Expected: PASS.

- [ ] **Step 6: Commit accept flow**

Run:

```bash
git add apps/api/src/services/proposal-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: accept source import proposals"
```

## Task 4: Web API Client, Routing, And Project Action Placement

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/project-actions.tsx`
- Modify: `apps/web/src/routes/project-detail.tsx`
- Test: `apps/web/src/components/project-actions.test.tsx`
- Test: `apps/web/src/routes/project-detail.test.tsx`

- [ ] **Step 1: Update project action tests first**

Change expectations in `apps/web/src/components/project-actions.test.tsx` from `Bootstrap from source` to `Import from source`, and assert the import action uses a link target supplied by props:

```tsx
expect(html).toContain("Import from source");
expect(html).not.toContain("Bootstrap from source");
```

Update mocked props to include:

```tsx
importPath="/projects/project-1/import/source"
```

In `apps/web/src/routes/project-detail.test.tsx`, update the ProjectActions mock expectation so it renders `Import from source` and remove direct bootstrap click assertions from the normal project detail route.

- [ ] **Step 2: Run web tests to verify they fail**

Run:

```bash
pnpm --filter web test -- project-actions.test.tsx project-detail.test.tsx
```

Expected: FAIL because `ProjectActions` still expects bootstrap mutation props.

- [ ] **Step 3: Add proposal client functions**

Modify `apps/web/src/api/queries.ts` imports to include proposal types:

```ts
  AcceptProposalsRequest,
  AcceptProposalsResponse,
  ProposalDetailDto,
  ProposalListQuery,
  ProposalPatchRequest,
  ProposalSummaryDto,
```

Add query keys:

```ts
  proposals: (projectId: string, input: ProposalListQuery = {}) =>
    ["projects", projectId, "proposals", input] as const,
  proposal: (projectId: string, proposalId: string) =>
    ["projects", projectId, "proposals", proposalId] as const,
```

Add API functions:

```ts
export function proposalsQuery(projectId: string, input: ProposalListQuery = {}) {
  const search = new URLSearchParams();
  if (input.status) search.set("status", input.status);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return queryOptions({
    queryKey: queryKeys.proposals(projectId, input),
    queryFn: () =>
      apiGet<ProposalSummaryDto[]>(`/api/projects/${encodeURIComponent(projectId)}/proposals${suffix}`)
  });
}

export function proposalQuery(projectId: string, proposalId: string) {
  return queryOptions({
    queryKey: queryKeys.proposal(projectId, proposalId),
    queryFn: () =>
      apiGet<ProposalDetailDto>(
        `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`
      )
  });
}

export function generateSourceImportProposals(projectId: string) {
  return apiSend<ProposalSummaryDto[]>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/source-import`
  );
}

export function patchProposal(projectId: string, proposalId: string, input: ProposalPatchRequest) {
  return apiSend<ProposalDetailDto>(
    "PATCH",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`,
    input
  );
}

export function acceptProposals(projectId: string, input: AcceptProposalsRequest) {
  return apiSend<AcceptProposalsResponse>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/proposals/accept`,
    input
  );
}
```

- [ ] **Step 4: Update project actions component**

Modify `apps/web/src/components/project-actions.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { FolderSearch, FolderSync, Play, RotateCw } from "lucide-react";

export type ProjectActionsProps = {
  projectId: string;
  isInitializing: boolean;
  isIndexing: boolean;
  isProjectActionPending: boolean;
  onInitialize: () => void;
  onReindex: () => void;
};
```

Replace the bootstrap button with:

```tsx
<Link
  to="/projects/$projectId/import/source"
  params={{ projectId }}
  className="button-secondary"
>
  <FolderSearch className="h-4 w-4" aria-hidden="true" />
  Import from source
</Link>
```

Keep `Init specops` and `Re-index` buttons unchanged.

- [ ] **Step 5: Update project detail action wiring**

Modify `apps/web/src/routes/project-detail.tsx`:

- Remove `bootstrapFromSource` import.
- Remove `bootstrapMutation`.
- Compute `isProjectActionPending = initializeMutation.isPending || indexMutation.isPending`.
- Pass `projectId`, `isInitializing`, `isIndexing`, `isProjectActionPending`, `onInitialize`, and `onReindex` to `ProjectActions`.

- [ ] **Step 6: Add source import route shell**

Create `apps/web/src/routes/source-import.tsx`:

```tsx
import { Link } from "@tanstack/react-router";

export function SourceImportPage({ projectId }: { projectId: string }) {
  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Import from source</h1>
          <p className="truncate text-sm text-slate-600">Review source-derived spec proposals.</p>
        </div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ q: undefined }}
          className="button-secondary"
        >
          Back to project
        </Link>
      </div>
    </main>
  );
}
```

Modify `apps/web/src/app.tsx`:

```ts
import { SourceImportPage } from "./routes/source-import.js";
```

Add route:

```tsx
const sourceImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/import/source",
  component: () => {
    const { projectId } = sourceImportRoute.useParams();
    return <SourceImportPage projectId={projectId} />;
  }
});
```

Add `sourceImportRoute` to `routeTree`.

- [ ] **Step 7: Run web action/routing tests**

Run:

```bash
pnpm --filter web test -- project-actions.test.tsx project-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit web route and action placement**

Run:

```bash
git add apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/components/project-actions.tsx apps/web/src/routes/project-detail.tsx apps/web/src/routes/source-import.tsx apps/web/src/components/project-actions.test.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "feat: route source imports through proposal wizard"
```

## Task 5: Source Import Review UI

**Files:**
- Modify: `apps/web/src/routes/source-import.tsx`
- Test: `apps/web/src/routes/source-import.test.tsx`

- [ ] **Step 1: Write source import route tests**

Create `apps/web/src/routes/source-import.test.tsx` with mocked queries/mutations:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SourceImportPage } from "./source-import.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  )
}));

vi.mock("../components/markdown-editor.js", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />
}));

const proposals = [
  {
    id: "proposal-1",
    projectId: "project-1",
    proposalType: "source_spec_entity",
    status: "pending",
    title: "DecisionService",
    entityId: "interface.decision-service",
    entityType: "interface",
    filePath: "interfaces/decision-service.md",
    confidence: 0.7,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null
  }
];

vi.mock("../api/queries.js", () => ({
  acceptProposals: vi.fn(),
  generateSourceImportProposals: vi.fn(),
  patchProposal: vi.fn(),
  proposalQuery: () => ({
    queryKey: ["proposal"],
    queryFn: async () => ({
      ...proposals[0],
      payload: {
        entityId: "interface.decision-service",
        type: "interface",
        title: "DecisionService",
        status: "draft",
        filePath: "interfaces/decision-service.md",
        generatedMarkdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
        markdown: "---\nid: interface.decision-service\n---\n\n# DecisionService\n",
        sourceFiles: ["src/services/decision-service.ts"],
        symbols: []
      },
      evidence: {
        scanner: "typescript",
        sourceFiles: [
          {
            file: "src/services/decision-service.ts",
            symbolName: "DecisionService",
            symbolKind: "class",
            exported: true,
            line: 3
          }
        ]
      }
    })
  }),
  proposalsQuery: () => ({
    queryKey: ["proposals"],
    queryFn: async () => proposals
  }),
  queryKeys: {
    proposals: () => ["proposals"],
    proposal: () => ["proposal"],
    entities: () => ["entities"],
    validation: () => ["validation"],
    indexRuns: () => ["index-runs"],
    project: () => ["project"],
    projectHealth: () => ["project-health"],
    projectOverview: () => ["project-overview"]
  }
}));

describe("SourceImportPage", () => {
  it("renders proposal list and empty detail state during SSR", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    queryClient.setQueryData(["proposals"], proposals);

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <SourceImportPage projectId="project-1" />
      </QueryClientProvider>
    );

    expect(html).toContain("Import from source");
    expect(html).toContain("DecisionService");
    expect(html).toContain("interfaces/decision-service.md");
    expect(html).toContain("Generate proposals");
    expect(html).toContain("Accept selected");
  });
});
```

- [ ] **Step 2: Run source import UI test to verify it fails**

Run:

```bash
pnpm --filter web test -- source-import.test.tsx
```

Expected: FAIL because the route shell does not render proposals.

- [ ] **Step 3: Implement source import review page**

Replace `apps/web/src/routes/source-import.tsx` with a full page that:

- calls `useQuery(proposalsQuery(projectId, { status: "pending" }))`,
- tracks `selectedProposalId`,
- tracks a `Set<string>` of checked proposal IDs,
- loads selected detail with `proposalQuery`,
- shows `MarkdownEditor` for selected detail markdown,
- saves markdown through `patchProposal`,
- rejects selected proposal through `patchProposal(projectId, id, { status: "rejected" })`,
- accepts selected proposals through `acceptProposals(projectId, { proposalIds })`,
- invalidates proposal, project, health, overview, entity, validation, and index run queries after accept.

Use this component skeleton:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, FileSearch, RotateCw, X } from "lucide-react";

import {
  acceptProposals,
  generateSourceImportProposals,
  patchProposal,
  proposalQuery,
  proposalsQuery,
  queryKeys
} from "../api/queries.js";
import { MarkdownEditor } from "../components/markdown-editor.js";

export function SourceImportPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [markdown, setMarkdown] = useState("");
  const proposals = useQuery(proposalsQuery(projectId, { status: "pending" }));
  const detail = useQuery({
    ...proposalQuery(projectId, selectedProposalId ?? ""),
    enabled: Boolean(selectedProposalId)
  });

  useEffect(() => {
    if (!selectedProposalId && proposals.data?.[0]) {
      setSelectedProposalId(proposals.data[0].id);
    }
  }, [proposals.data, selectedProposalId]);

  useEffect(() => {
    setMarkdown(detail.data?.payload.markdown ?? "");
  }, [detail.data?.id, detail.data?.payload.markdown]);

  const selectedIds = useMemo(() => [...checkedIds], [checkedIds]);
  const invalidateProposals = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.proposals(projectId, { status: "pending" }) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) })
    ]);
  };

  const generateMutation = useMutation({
    mutationFn: () => generateSourceImportProposals(projectId),
    onSuccess: async () => {
      setCheckedIds(new Set());
      setSelectedProposalId(null);
      await invalidateProposals();
    }
  });
  const saveMarkdownMutation = useMutation({
    mutationFn: () => patchProposal(projectId, selectedProposalId ?? "", { markdown }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposal(projectId, updated.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposals(projectId, { status: "pending" }) });
    }
  });
  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => patchProposal(projectId, proposalId, { status: "rejected" }),
    onSuccess: async () => {
      setCheckedIds(new Set());
      setSelectedProposalId(null);
      await invalidateProposals();
    }
  });
  const acceptMutation = useMutation({
    mutationFn: () => acceptProposals(projectId, { proposalIds: selectedIds }),
    onSuccess: async () => {
      setCheckedIds(new Set());
      setSelectedProposalId(null);
      await invalidateProposals();
    }
  });

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <div className="mb-4 flex min-w-0 shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Import from source</h1>
          <p className="truncate text-sm text-slate-600">Review source-derived spec proposals.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="button-secondary"
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            {generateMutation.isPending ? <RotateCw className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
            Generate proposals
          </button>
          <Link to="/projects/$projectId" params={{ projectId }} search={{ q: undefined }} className="button-secondary">
            Back to project
          </Link>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 className="section-heading">Pending proposals</h2>
            <span className="text-xs text-slate-500">{proposals.data?.length ?? 0}</span>
          </div>
          <div className="min-h-0 overflow-auto p-2">
            {proposals.isLoading ? (
              <p className="p-2 text-sm text-slate-500">Loading proposals...</p>
            ) : proposals.error ? (
              <ErrorPanel message={proposals.error.message} />
            ) : proposals.data && proposals.data.length > 0 ? (
              <div className="grid gap-1">
                {proposals.data.map((proposal) => (
                  <button
                    key={proposal.id}
                    type="button"
                    className={`entity-row text-left ${proposal.id === selectedProposalId ? "border-slate-300 bg-slate-100" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}
                    onClick={() => setSelectedProposalId(proposal.id)}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        aria-label={`Select ${proposal.title}`}
                        type="checkbox"
                        checked={checkedIds.has(proposal.id)}
                        onChange={(event) => {
                          event.stopPropagation();
                          const next = new Set(checkedIds);
                          if (event.target.checked) next.add(proposal.id);
                          else next.delete(proposal.id);
                          setCheckedIds(next);
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{proposal.title}</span>
                        <span className="block truncate text-xs text-slate-500">{proposal.filePath}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-2 text-sm text-slate-500">No pending proposals.</p>
            )}
          </div>
          <div className="border-t border-slate-200 p-3">
            <button
              type="button"
              className="button-primary w-full"
              disabled={selectedIds.length === 0 || acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              <Check className="h-4 w-4" />
              Accept selected
            </button>
            {acceptMutation.error ? <p className="mt-2 text-xs text-red-700">{acceptMutation.error.message}</p> : null}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-4">
          {!selectedProposalId ? (
            <p className="text-sm text-slate-500">Select a proposal.</p>
          ) : detail.isLoading ? (
            <p className="text-sm text-slate-500">Loading proposal...</p>
          ) : detail.error ? (
            <ErrorPanel message={detail.error.message} />
          ) : detail.data ? (
            <div className="grid gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-900">{detail.data.title}</h2>
                  <p className="truncate text-xs text-slate-500">{detail.data.entityId} / {detail.data.filePath}</p>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => rejectMutation.mutate(detail.data.id)}
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </div>
              <MarkdownEditor value={markdown} height="420px" minHeight="320px" onChange={setMarkdown} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={saveMarkdownMutation.isPending || markdown === detail.data.payload.markdown}
                  onClick={() => saveMarkdownMutation.mutate()}
                >
                  Save markdown edit
                </button>
              </div>
              <div>
                <h3 className="section-heading mb-2">Source Evidence</h3>
                <ul className="grid gap-2">
                  {detail.data.evidence.sourceFiles.map((item) => (
                    <li key={`${item.file}:${item.symbolName}:${item.line ?? "none"}`} className="rounded border border-slate-200 p-2 text-xs text-slate-700">
                      <span className="font-medium">{item.symbolName}</span> in <span>{item.file}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</div>;
}
```

This is intentionally utilitarian. Refine only where tests or typecheck require adjustment.

- [ ] **Step 4: Run source import UI test**

Run:

```bash
pnpm --filter web test -- source-import.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit source import UI**

Run:

```bash
git add apps/web/src/routes/source-import.tsx apps/web/src/routes/source-import.test.tsx
git commit -m "feat: add source import review UI"
```

## Task 6: Final Verification And Polish

**Files:**
- Review all changed files from prior tasks.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @specops/contracts test -- proposals.test.ts
pnpm --filter @specops/source-bootstrap test -- generate.test.ts
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts -t "proposal"
pnpm --filter web test -- source-import.test.tsx project-actions.test.tsx project-detail.test.tsx
```

Expected: all commands PASS. If `TEST_DATABASE_URL` is unavailable, document that DB-backed API tests were not run and run the non-DB commands.

- [ ] **Step 2: Run workspace verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: all commands PASS. Existing DB-backed tests may skip locally unless `TEST_DATABASE_URL` is set; do not call the full verification complete unless the command output confirms pass or intentional skip behavior.

- [ ] **Step 3: Inspect the normal project action surface**

Start the app if needed:

```bash
pnpm dev
```

Open `http://127.0.0.1:5176`, choose a project, and verify:

- project action bar shows `Init specops`, `Import from source`, and `Re-index`,
- project action bar does not show `Bootstrap from source`,
- `Import from source` opens `/projects/<projectId>/import/source`,
- source import page can generate pending proposals for a project with exported TypeScript symbols,
- accepting one proposal writes the corresponding markdown and returns to a fresh pending proposal list.

- [ ] **Step 4: Commit final fixes if any**

If Step 1-3 required fixes, commit them:

```bash
git add packages/contracts/src/index.ts packages/contracts/src/proposals.ts packages/contracts/src/proposals.test.ts packages/source-bootstrap/src/generate.ts packages/source-bootstrap/src/generate.test.ts packages/source-bootstrap/src/index.ts apps/api/src/services/proposal-service.ts apps/api/src/routes/proposals.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/components/project-actions.tsx apps/web/src/routes/project-detail.tsx apps/web/src/routes/source-import.tsx apps/web/src/routes/source-import.test.tsx apps/web/src/components/project-actions.test.tsx apps/web/src/routes/project-detail.test.tsx
git commit -m "fix: polish source import proposal wizard"
```

Skip this commit if no fixes were needed.

- [ ] **Step 5: Record final status**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: working tree is clean except for intentional untracked local files. Recent commits include the source import proposal wizard slices.
