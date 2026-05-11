# AI Prefill v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a review-first AI Prefill workflow that generates pending spec proposals from manually selected source files using Ollama first and OpenAI through the same adapter boundary.

**Architecture:** Contracts define a discriminated proposal model and AI generation request/response schemas. `packages/ai-prefill` owns prompt construction, provider adapters, and provider-output normalization. The API reads selected indexed source files safely, calls the provider, stores pending `ai_spec_entity` proposals in `ai_proposals`, and reuses the proposal review/accept lifecycle. The web app adds a project-level split review inbox with source-file selection, provider controls, proposal review, markdown editing, and batch accept.

**Tech Stack:** TypeScript, pnpm workspaces, Zod, Fastify, Drizzle/PostgreSQL, React, TanStack Router, TanStack Query, Vitest, CodeMirror.

---

## File Structure

Create:

- `packages/ai-prefill/src/types.ts`: provider-facing input/output types and normalized candidate types.
- `packages/ai-prefill/src/prompt.ts`: deterministic prompt packet and source-size guardrails.
- `packages/ai-prefill/src/providers.ts`: Ollama/OpenAI provider implementations and provider factory.
- `packages/ai-prefill/src/normalize.ts`: parse provider JSON into normalized candidates with diagnostics.
- `packages/ai-prefill/src/render.ts`: render normalized candidates into markdown/frontmatter payloads.
- `packages/ai-prefill/src/__tests__/prompt.test.ts`: guardrail and prompt packet tests.
- `packages/ai-prefill/src/__tests__/normalize.test.ts`: valid/invalid provider response tests.
- `packages/ai-prefill/src/__tests__/render.test.ts`: deterministic markdown rendering tests.
- `apps/api/src/services/ai-prefill-service.ts`: project/file validation, source reading, provider call, proposal persistence.
- `apps/api/src/routes/source.ts`: source inventory list/detail routes used by AI Prefill source selection.
- `apps/web/src/routes/ai-prefill.tsx`: split review inbox page.
- `apps/web/src/routes/ai-prefill.test.tsx`: route-level UI tests.

Modify:

- `packages/ai-prefill/package.json`: add `zod` and `yaml` dependencies.
- `packages/ai-prefill/src/index.ts`: export package API.
- `packages/contracts/src/proposals.ts`: add AI proposal schemas, request/response schemas, proposal type filter.
- `packages/contracts/src/proposals.test.ts`: cover AI proposal contracts and proposal-type filter.
- `apps/api/package.json`: add `@specops/ai-prefill`.
- `apps/api/src/config.ts`: add AI provider defaults.
- `apps/api/src/routes/proposals.ts`: add AI generation route and proposal-type filter.
- `apps/api/src/routes/source.ts`: add source inventory routes.
- `apps/api/src/services/proposal-service.ts`: generalize mapping, parsing, conflict checks, patch, and accept for `source_spec_entity` and `ai_spec_entity`.
- `apps/api/src/server.ts`: register source inventory routes.
- `apps/api/src/__tests__/routes.test.ts`: DB-backed AI prefill and proposal lifecycle tests.
- `apps/web/src/api/queries.ts`: add source-file queries, AI generation mutation, and proposal type filtering.
- `apps/web/src/app.tsx`: add `/projects/$projectId/ai-prefill` route.
- `apps/web/src/components/project-actions.tsx`: link project actions to AI Prefill.

---

### Task 1: Extend Proposal Contracts

**Files:**
- Modify: `packages/contracts/src/proposals.ts`
- Modify: `packages/contracts/src/proposals.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that prove AI proposals and proposal type filters parse correctly:

```ts
import {
  aiPrefillGenerateRequestSchema,
  aiSpecEntityProposalEvidenceSchema,
  aiSpecEntityProposalPayloadSchema,
  proposalDetailSchema,
  proposalListQuerySchema,
  proposalSummarySchema
} from "./proposals.js";

it("parses AI prefill generation requests", () => {
  expect(
    aiPrefillGenerateRequestSchema.parse({
      sourceFileIds: ["source-file-1"],
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      temperature: 0.1
    })
  ).toEqual({
    sourceFileIds: ["source-file-1"],
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    temperature: 0.1
  });
});

it("parses proposal list queries with proposal type filters", () => {
  expect(
    proposalListQuerySchema.parse({
      status: "pending",
      proposalType: "ai_spec_entity"
    })
  ).toEqual({
    status: "pending",
    proposalType: "ai_spec_entity"
  });
});

it("parses AI spec entity proposal payloads and evidence", () => {
  const payload = aiSpecEntityProposalPayloadSchema.parse(aiPayload());
  const evidence = aiSpecEntityProposalEvidenceSchema.parse(aiEvidence());

  expect(payload.entityId).toBe("uc.manage-projects");
  expect(payload.proposedLinks[0]).toMatchObject({
    linkType: "uses",
    targetEntityId: "interface.project-service",
    targetExists: true
  });
  expect(evidence.provider).toBe("ollama");
});

it("parses AI proposal details as a discriminated proposal detail", () => {
  const parsed = proposalDetailSchema.parse({
    ...proposalSummary(),
    proposalType: "ai_spec_entity",
    entityType: "use_case",
    payload: aiPayload(),
    evidence: aiEvidence()
  });

  expect(parsed.proposalType).toBe("ai_spec_entity");
  expect(parsed.payload.type).toBe("use_case");
});

function aiPayload() {
  return {
    entityId: "uc.manage-projects",
    type: "use_case",
    title: "Manage projects",
    status: "draft",
    filePath: "use-cases/uc.manage-projects.md",
    generatedMarkdown: "# Manage projects",
    markdown: "# Manage projects",
    sourceFiles: ["apps/api/src/routes/projects.ts"],
    proposedLinks: [
      {
        linkType: "uses",
        targetEntityId: "interface.project-service",
        targetExists: true,
        rationale: "The selected route delegates project behavior to the project service."
      }
    ]
  };
}

function aiEvidence() {
  return {
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    promptVersion: "ai-prefill-v1",
    selectedSourceFiles: [
      {
        file: "apps/api/src/routes/projects.ts",
        contentHash: "hash-1",
        excerptStartLine: 1,
        excerptEndLine: 80
      }
    ],
    claims: [
      {
        text: "Project routes expose create and list operations.",
        sourceFiles: ["apps/api/src/routes/projects.ts"]
      }
    ],
    warnings: []
  };
}
```

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```bash
pnpm --filter @specops/contracts test -- proposals.test.ts
```

Expected: FAIL because `aiPrefillGenerateRequestSchema`, `aiSpecEntityProposalPayloadSchema`, `aiSpecEntityProposalEvidenceSchema`, and `proposalType=ai_spec_entity` are not implemented.

- [ ] **Step 3: Implement contract schemas**

In `packages/contracts/src/proposals.ts`, extend proposal types and detail schemas:

```ts
export const proposalTypeSchema = z.enum(["source_spec_entity", "ai_spec_entity"]);

export const aiProviderSchema = z.enum(["ollama", "openai"]);

export const aiSpecEntityProposalPayloadSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["use_case", "domain_entity", "interface"]),
  title: z.string().min(1),
  status: z.literal("draft"),
  filePath: z.string().min(1),
  generatedMarkdown: z.string().min(1),
  markdown: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)),
  proposedLinks: z.array(
    z.object({
      linkType: z.string().min(1),
      targetEntityId: z.string().min(1),
      targetExists: z.boolean(),
      rationale: z.string().min(1)
    })
  )
});

export const aiSpecEntityProposalEvidenceSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1),
  promptVersion: z.literal("ai-prefill-v1"),
  selectedSourceFiles: z.array(
    z.object({
      file: z.string().min(1),
      contentHash: z.string().min(1),
      excerptStartLine: z.number().int().min(1),
      excerptEndLine: z.number().int().min(1)
    })
  ),
  claims: z.array(
    z.object({
      text: z.string().min(1),
      sourceFiles: z.array(z.string().min(1))
    })
  ),
  warnings: z.array(z.string().min(1))
});

export const aiPrefillGenerateRequestSchema = z.object({
  sourceFileIds: z.array(z.string().min(1)).nonempty(),
  provider: aiProviderSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.1)
});

export const aiPrefillDiagnosticSchema = z.object({
  level: z.enum(["warning", "info"]),
  message: z.string().min(1)
});

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  proposalType: proposalTypeSchema.optional()
});
```

Then change detail schema into a discriminated union:

```ts
const proposalSummaryBaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  proposalType: proposalTypeSchema,
  status: proposalStatusSchema,
  title: z.string(),
  entityId: z.string(),
  entityType: z.enum(["use_case", "domain_entity", "interface"]),
  filePath: z.string(),
  confidence: z.number().nullable(),
  conflict: proposalConflictSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

export const proposalSummarySchema = proposalSummaryBaseSchema;

export const sourceSpecEntityProposalDetailSchema = proposalSummaryBaseSchema.extend({
  proposalType: z.literal("source_spec_entity"),
  entityType: z.enum(["domain_entity", "interface"]),
  payload: sourceSpecEntityProposalPayloadSchema,
  evidence: sourceSpecEntityProposalEvidenceSchema
});

export const aiSpecEntityProposalDetailSchema = proposalSummaryBaseSchema.extend({
  proposalType: z.literal("ai_spec_entity"),
  entityType: z.enum(["use_case", "domain_entity", "interface"]),
  payload: aiSpecEntityProposalPayloadSchema,
  evidence: aiSpecEntityProposalEvidenceSchema
});

export const proposalDetailSchema = z.discriminatedUnion("proposalType", [
  sourceSpecEntityProposalDetailSchema,
  aiSpecEntityProposalDetailSchema
]);
```

Export the inferred types:

```ts
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type AiSpecEntityProposalPayload = z.infer<typeof aiSpecEntityProposalPayloadSchema>;
export type AiSpecEntityProposalEvidence = z.infer<typeof aiSpecEntityProposalEvidenceSchema>;
export type AiPrefillGenerateRequest = z.infer<typeof aiPrefillGenerateRequestSchema>;
export type AiPrefillDiagnostic = z.infer<typeof aiPrefillDiagnosticSchema>;
```

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```bash
pnpm --filter @specops/contracts test -- proposals.test.ts
pnpm --filter @specops/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/proposals.ts packages/contracts/src/proposals.test.ts
git commit -m "feat: add ai prefill proposal contracts"
```

---

### Task 2: Build `@specops/ai-prefill` Core Package

**Files:**
- Modify: `packages/ai-prefill/package.json`
- Create: `packages/ai-prefill/src/types.ts`
- Create: `packages/ai-prefill/src/prompt.ts`
- Create: `packages/ai-prefill/src/providers.ts`
- Create: `packages/ai-prefill/src/normalize.ts`
- Create: `packages/ai-prefill/src/render.ts`
- Modify: `packages/ai-prefill/src/index.ts`
- Create: `packages/ai-prefill/src/__tests__/prompt.test.ts`
- Create: `packages/ai-prefill/src/__tests__/normalize.test.ts`
- Create: `packages/ai-prefill/src/__tests__/render.test.ts`

- [ ] **Step 1: Add package tests first**

Create tests for prompt guardrails, normalization, and rendering.

`packages/ai-prefill/src/__tests__/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildAiPrefillPromptPacket } from "../prompt.js";

describe("buildAiPrefillPromptPacket", () => {
  it("includes selected source files, existing entities, and allowed types", () => {
    const packet = buildAiPrefillPromptPacket({
      project: { name: "SpecOps", description: "Spec workbench" },
      selectedFiles: [
        {
          id: "file-1",
          path: "apps/api/src/routes/projects.ts",
          contentHash: "hash-1",
          language: "typescript",
          kind: "source",
          text: "export async function routes() {}",
          startLine: 1,
          endLine: 1,
          imports: [],
          exports: [{ exportedName: "routes", exportKind: "function", sourceSpecifier: null }],
          symbols: [{ name: "routes", symbolKind: "function", isExported: true, line: 1 }]
        }
      ],
      existingEntities: [
        { entityId: "interface.project-service", type: "interface", title: "Project Service" }
      ],
      allowedEntityTypes: ["use_case", "domain_entity", "interface"],
      allowedLinkTypes: ["uses", "implements"],
      limits: { maxFiles: 5, maxTotalBytes: 20_000 }
    });

    expect(packet.promptVersion).toBe("ai-prefill-v1");
    expect(packet.messages[1]!.content).toContain("apps/api/src/routes/projects.ts");
    expect(packet.messages[1]!.content).toContain("interface.project-service");
    expect(packet.selectedSourceFiles[0]).toMatchObject({ file: "apps/api/src/routes/projects.ts" });
  });

  it("rejects requests above file and byte limits before provider calls", () => {
    expect(() =>
      buildAiPrefillPromptPacket({
        project: { name: "SpecOps", description: null },
        selectedFiles: [
          {
            id: "file-1",
            path: "a.ts",
            contentHash: "hash-1",
            language: "typescript",
            kind: "source",
            text: "x".repeat(25),
            startLine: 1,
            endLine: 1,
            imports: [],
            exports: [],
            symbols: []
          }
        ],
        existingEntities: [],
        allowedEntityTypes: ["use_case"],
        allowedLinkTypes: ["uses"],
        limits: { maxFiles: 1, maxTotalBytes: 10 }
      })
    ).toThrow("Selected source content exceeds AI Prefill limit");
  });
});
```

`packages/ai-prefill/src/__tests__/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeProviderResponse } from "../normalize.js";

describe("normalizeProviderResponse", () => {
  it("returns valid candidates and diagnostics for invalid candidates", () => {
    const normalized = normalizeProviderResponse({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      text: JSON.stringify({
        proposals: [
          {
            entityId: "uc.manage-projects",
            type: "use_case",
            title: "Manage projects",
            summary: "Users can create and inspect local projects.",
            sourceFiles: ["apps/api/src/routes/projects.ts"],
            claims: [
              {
                text: "Project routes expose project creation.",
                sourceFiles: ["apps/api/src/routes/projects.ts"]
              }
            ],
            proposedLinks: [
              {
                linkType: "uses",
                targetEntityId: "interface.project-service",
                rationale: "The route delegates to project service methods."
              }
            ],
            confidence: 0.82
          },
          { entityId: "", type: "use_case", title: "" }
        ]
      }),
      selectedSourceFiles: ["apps/api/src/routes/projects.ts"],
      existingEntityIds: new Set(["interface.project-service"])
    });

    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0]!.proposedLinks[0]).toMatchObject({ targetExists: true });
    expect(normalized.diagnostics[0]!.level).toBe("warning");
  });

  it("throws a provider output error for non-json responses", () => {
    expect(() =>
      normalizeProviderResponse({
        provider: "ollama",
        model: "qwen2.5-coder:7b",
        text: "not json",
        selectedSourceFiles: ["a.ts"],
        existingEntityIds: new Set()
      })
    ).toThrow("AI provider returned invalid JSON");
  });
});
```

`packages/ai-prefill/src/__tests__/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderAiSpecEntityProposal } from "../render.js";

describe("renderAiSpecEntityProposal", () => {
  it("renders deterministic markdown and payload fields", () => {
    const proposal = renderAiSpecEntityProposal({
      candidate: {
        entityId: "uc.manage-projects",
        type: "use_case",
        title: "Manage projects",
        summary: "Users can create and inspect local projects.",
        sourceFiles: ["apps/api/src/routes/projects.ts"],
        claims: [
          {
            text: "Project routes expose project creation.",
            sourceFiles: ["apps/api/src/routes/projects.ts"]
          }
        ],
        proposedLinks: [
          {
            linkType: "uses",
            targetEntityId: "interface.project-service",
            targetExists: true,
            rationale: "The route delegates to project service methods."
          }
        ],
        confidence: 0.82
      },
      evidence: {
        provider: "ollama",
        model: "qwen2.5-coder:7b",
        promptVersion: "ai-prefill-v1",
        selectedSourceFiles: [
          { file: "apps/api/src/routes/projects.ts", contentHash: "hash-1", excerptStartLine: 1, excerptEndLine: 80 }
        ],
        claims: [
          { text: "Project routes expose project creation.", sourceFiles: ["apps/api/src/routes/projects.ts"] }
        ],
        warnings: []
      }
    });

    expect(proposal.payload.filePath).toBe("use-cases/uc.manage-projects.md");
    expect(proposal.payload.generatedMarkdown).toContain("id: uc.manage-projects");
    expect(proposal.payload.generatedMarkdown).toContain("interface.project-service");
    expect(proposal.title).toBe("Manage projects");
  });
});
```

- [ ] **Step 2: Run package tests and verify failure**

Run:

```bash
pnpm --filter @specops/ai-prefill test
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Add package dependency and types**

In `packages/ai-prefill/package.json`, add:

```json
"dependencies": {
  "zod": "^4.4.3"
}
```

Create `packages/ai-prefill/src/types.ts`:

```ts
export type AiPrefillProviderName = "ollama" | "openai";
export type AiPrefillEntityType = "use_case" | "domain_entity" | "interface";

export type AiPrefillSourceFile = {
  id: string;
  path: string;
  contentHash: string;
  language: string | null;
  kind: string;
  text: string;
  startLine: number;
  endLine: number;
  imports: Array<{ specifier: string; importKind: string; importedNames: string[]; resolvedPath: string | null }>;
  exports: Array<{ exportedName: string; exportKind: string; sourceSpecifier: string | null }>;
  symbols: Array<{ name: string; symbolKind: string; isExported: boolean; line: number | null }>;
};

export type AiPrefillExistingEntity = {
  entityId: string;
  type: string;
  title: string;
};

export type AiPrefillPromptMessage = {
  role: "system" | "user";
  content: string;
};

export type AiPrefillPromptPacket = {
  promptVersion: "ai-prefill-v1";
  messages: AiPrefillPromptMessage[];
  selectedSourceFiles: Array<{
    file: string;
    contentHash: string;
    excerptStartLine: number;
    excerptEndLine: number;
  }>;
};

export type AiPrefillLimits = {
  maxFiles: number;
  maxTotalBytes: number;
};

export type AiPrefillCandidate = {
  entityId: string;
  type: AiPrefillEntityType;
  title: string;
  summary: string;
  sourceFiles: string[];
  claims: Array<{ text: string; sourceFiles: string[] }>;
  proposedLinks: Array<{
    linkType: string;
    targetEntityId: string;
    targetExists: boolean;
    rationale: string;
  }>;
  confidence: number | null;
};

export type AiPrefillDiagnostic = {
  level: "warning" | "info";
  message: string;
};

export type AiPrefillProviderInput = {
  packet: AiPrefillPromptPacket;
  model: string;
  temperature: number;
};

export type AiPrefillProviderResult = {
  provider: AiPrefillProviderName;
  model: string;
  text: string;
};

export type AiPrefillProvider = {
  generateSpecProposals(input: AiPrefillProviderInput): Promise<AiPrefillProviderResult>;
};
```

- [ ] **Step 4: Implement prompt builder**

Create `packages/ai-prefill/src/prompt.ts`:

```ts
import type {
  AiPrefillEntityType,
  AiPrefillExistingEntity,
  AiPrefillLimits,
  AiPrefillPromptPacket,
  AiPrefillSourceFile
} from "./types.js";

export function buildAiPrefillPromptPacket(input: {
  project: { name: string; description: string | null };
  selectedFiles: AiPrefillSourceFile[];
  existingEntities: AiPrefillExistingEntity[];
  allowedEntityTypes: AiPrefillEntityType[];
  allowedLinkTypes: string[];
  limits: AiPrefillLimits;
}): AiPrefillPromptPacket {
  if (input.selectedFiles.length === 0) {
    throw new Error("Select at least one source file for AI Prefill");
  }
  if (input.selectedFiles.length > input.limits.maxFiles) {
    throw new Error("Selected source file count exceeds AI Prefill limit");
  }

  const totalBytes = input.selectedFiles.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0);
  if (totalBytes > input.limits.maxTotalBytes) {
    throw new Error("Selected source content exceeds AI Prefill limit");
  }

  const system = [
    "You generate reviewable SpecOps markdown proposal candidates.",
    "Return strict JSON only.",
    "Do not propose direct file writes.",
    "Every claim must cite selected source file paths.",
    "Prefer fewer high-confidence proposals over many weak proposals."
  ].join("\n");

  const user = JSON.stringify(
    {
      project: input.project,
      allowedEntityTypes: input.allowedEntityTypes,
      allowedLinkTypes: input.allowedLinkTypes,
      existingEntities: input.existingEntities,
      selectedFiles: input.selectedFiles.map((file) => ({
        path: file.path,
        contentHash: file.contentHash,
        language: file.language,
        kind: file.kind,
        excerptStartLine: file.startLine,
        excerptEndLine: file.endLine,
        imports: file.imports,
        exports: file.exports,
        symbols: file.symbols,
        text: file.text
      })),
      responseSchema: {
        proposals: [
          {
            entityId: "uc.example",
            type: "use_case",
            title: "Example",
            summary: "One paragraph grounded in source evidence.",
            sourceFiles: ["path/to/source.ts"],
            claims: [{ text: "Claim text", sourceFiles: ["path/to/source.ts"] }],
            proposedLinks: [
              { linkType: "uses", targetEntityId: "interface.example", rationale: "Why this link is supported" }
            ],
            confidence: 0.8
          }
        ]
      }
    },
    null,
    2
  );

  return {
    promptVersion: "ai-prefill-v1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    selectedSourceFiles: input.selectedFiles.map((file) => ({
      file: file.path,
      contentHash: file.contentHash,
      excerptStartLine: file.startLine,
      excerptEndLine: file.endLine
    }))
  };
}
```

- [ ] **Step 5: Implement normalization**

Create `packages/ai-prefill/src/normalize.ts`:

```ts
import { z } from "zod";

import type {
  AiPrefillCandidate,
  AiPrefillDiagnostic,
  AiPrefillProviderName
} from "./types.js";

const providerCandidateSchema = z.object({
  entityId: z.string().min(1),
  type: z.enum(["use_case", "domain_entity", "interface"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)).nonempty(),
  claims: z.array(
    z.object({
      text: z.string().min(1),
      sourceFiles: z.array(z.string().min(1)).nonempty()
    })
  ),
  proposedLinks: z.array(
    z.object({
      linkType: z.string().min(1),
      targetEntityId: z.string().min(1),
      rationale: z.string().min(1)
    })
  ).default([]),
  confidence: z.number().min(0).max(1).nullable().default(null)
});

const providerResponseSchema = z.object({
  proposals: z.array(z.unknown())
});

export function normalizeProviderResponse(input: {
  provider: AiPrefillProviderName;
  model: string;
  text: string;
  selectedSourceFiles: string[];
  existingEntityIds: Set<string>;
}): { candidates: AiPrefillCandidate[]; diagnostics: AiPrefillDiagnostic[] } {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.text);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }

  const response = providerResponseSchema.parse(parsedJson);
  const selected = new Set(input.selectedSourceFiles);
  const diagnostics: AiPrefillDiagnostic[] = [];
  const candidates: AiPrefillCandidate[] = [];

  response.proposals.forEach((raw, index) => {
    const parsed = providerCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push({ level: "warning", message: `Rejected proposal ${index + 1}: invalid shape` });
      return;
    }

    const sourceFiles = parsed.data.sourceFiles.filter((file) => selected.has(file));
    if (sourceFiles.length === 0) {
      diagnostics.push({ level: "warning", message: `Rejected proposal ${index + 1}: no selected source evidence` });
      return;
    }

    candidates.push({
      ...parsed.data,
      sourceFiles,
      proposedLinks: parsed.data.proposedLinks.map((link) => ({
        ...link,
        targetExists: input.existingEntityIds.has(link.targetEntityId)
      }))
    });
  });

  return { candidates, diagnostics };
}
```

- [ ] **Step 6: Implement rendering**

Create `packages/ai-prefill/src/render.ts`:

```ts
import YAML from "yaml";

import type {
  AiPrefillCandidate
} from "./types.js";

type AiEvidence = {
  provider: "ollama" | "openai";
  model: string;
  promptVersion: "ai-prefill-v1";
  selectedSourceFiles: Array<{
    file: string;
    contentHash: string;
    excerptStartLine: number;
    excerptEndLine: number;
  }>;
  claims: Array<{ text: string; sourceFiles: string[] }>;
  warnings: string[];
};

const typeDirectories: Record<AiPrefillCandidate["type"], string> = {
  use_case: "use-cases",
  domain_entity: "domain",
  interface: "interfaces"
};

export function renderAiSpecEntityProposal(input: {
  candidate: AiPrefillCandidate;
  evidence: AiEvidence;
}) {
  const filePath = `${typeDirectories[input.candidate.type]}/${input.candidate.entityId}.md`;
  const frontmatter = {
    id: input.candidate.entityId,
    type: input.candidate.type,
    title: input.candidate.title,
    status: "draft",
    links: linksObject(input.candidate.proposedLinks),
    source_files: input.candidate.sourceFiles
  };
  const markdown = [
    "---",
    YAML.stringify(frontmatter).trim(),
    "---",
    "",
    `# ${input.candidate.title}`,
    "",
    input.candidate.summary,
    "",
    "## Source Evidence",
    "",
    ...input.candidate.claims.flatMap((claim) => [
      `- ${claim.text}`,
      ...claim.sourceFiles.map((file) => `  - \`${file}\``)
    ]),
    "",
    "## Proposed Links",
    "",
    ...input.candidate.proposedLinks.map(
      (link) => `- \`${link.linkType}\` -> \`${link.targetEntityId}\`: ${link.rationale}`
    )
  ].join("\n");

  return {
    proposalType: "ai_spec_entity" as const,
    title: input.candidate.title,
    confidence: input.candidate.confidence,
    payload: {
      entityId: input.candidate.entityId,
      type: input.candidate.type,
      title: input.candidate.title,
      status: "draft" as const,
      filePath,
      generatedMarkdown: markdown,
      markdown,
      sourceFiles: input.candidate.sourceFiles,
      proposedLinks: input.candidate.proposedLinks
    },
    evidence: input.evidence
  };
}

function linksObject(links: AiPrefillCandidate["proposedLinks"]) {
  const grouped: Record<string, string[]> = {};
  for (const link of links) {
    grouped[link.linkType] = [...(grouped[link.linkType] ?? []), link.targetEntityId].sort();
  }
  return grouped;
}
```

Also add `yaml` dependency to `packages/ai-prefill/package.json`.

- [ ] **Step 7: Implement providers and exports**

Create `packages/ai-prefill/src/providers.ts`:

```ts
import type {
  AiPrefillProvider,
  AiPrefillProviderInput,
  AiPrefillProviderName,
  AiPrefillProviderResult
} from "./types.js";

export function createAiPrefillProvider(input: {
  provider: AiPrefillProviderName;
  ollamaBaseUrl: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  timeoutMs: number;
}): AiPrefillProvider {
  if (input.provider === "ollama") {
    return new OllamaPrefillProvider(input.ollamaBaseUrl, input.timeoutMs);
  }
  return new OpenAiPrefillProvider(
    input.openAiBaseUrl ?? "https://api.openai.com/v1",
    input.openAiApiKey ?? "",
    input.timeoutMs
  );
}

class OllamaPrefillProvider implements AiPrefillProvider {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async generateSpecProposals(input: AiPrefillProviderInput): Promise<AiPrefillProviderResult> {
    const response = await fetchWithTimeout(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: input.packet.messages,
        stream: false,
        options: { temperature: input.temperature }
      })
    }, this.timeoutMs);
    const json = await response.json() as { message?: { content?: string } };
    return { provider: "ollama", model: input.model, text: json.message?.content ?? "" };
  }
}

class OpenAiPrefillProvider implements AiPrefillProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {}

  async generateSpecProposals(input: AiPrefillProviderInput): Promise<AiPrefillProviderResult> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI AI Prefill");
    }
    const response = await fetchWithTimeout(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.packet.messages,
        temperature: input.temperature,
        response_format: { type: "json_object" }
      })
    }, this.timeoutMs);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { provider: "openai", model: input.model, text: json.choices?.[0]?.message?.content ?? "" };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
```

Update `packages/ai-prefill/src/index.ts`:

```ts
export * from "./types.js";
export * from "./prompt.js";
export * from "./providers.js";
export * from "./normalize.js";
export * from "./render.js";
```

- [ ] **Step 8: Run package tests, typecheck, and build**

Run:

```bash
pnpm --filter @specops/ai-prefill test
pnpm --filter @specops/ai-prefill typecheck
pnpm --filter @specops/ai-prefill build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ai-prefill
git commit -m "feat: add ai prefill package"
```

---

### Task 3: Generalize Proposal Service for AI Proposals

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/services/proposal-service.ts`
- Modify: `apps/api/src/routes/proposals.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Add failing API tests for proposal type filtering and AI accept**

In `apps/api/src/__tests__/routes.test.ts`, add tests near existing proposal tests:

```ts
it("filters proposals by proposal type", async () => {
  const project = await createTestProject();
  await pool.query(
    "insert into ai_proposals (project_id, proposal_type, title, payload_json, evidence_json, confidence, status) values ($1, $2, $3, $4, $5, $6, $7), ($1, $8, $9, $10, $11, $12, $13)",
    [
      project.id,
      "ai_spec_entity",
      "Manage projects",
      aiPayload(),
      aiEvidence(),
      0.82,
      "pending",
      "source_spec_entity",
      "ProjectService",
      sourcePayload(),
      sourceEvidence(),
      0.7,
      "pending"
    ]
  );

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/proposals?proposalType=ai_spec_entity`
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject([{ proposalType: "ai_spec_entity", entityId: "uc.manage-projects" }]);
});

it("accepts AI spec entity proposals as canonical markdown", async () => {
  const project = await createTestProject();
  const inserted = await pool.query<{ id: string }>(
    "insert into ai_proposals (project_id, proposal_type, title, payload_json, evidence_json, confidence, status) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [project.id, "ai_spec_entity", "Manage projects", aiPayload(), aiEvidence(), 0.82, "pending"]
  );

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/proposals/accept`,
    payload: { proposalIds: [inserted.rows[0]!.id] }
  });

  expect(response.statusCode).toBe(200);
  expect(await readFile(path.join(project.specopsPath, "use-cases/uc.manage-projects.md"), "utf8")).toContain(
    "id: uc.manage-projects"
  );
  const statuses = await pool.query("select status from ai_proposals where id = $1", [inserted.rows[0]!.id]);
  expect(statuses.rows[0]!.status).toBe("accepted");
});
```

Use local helper functions in the test file:

```ts
function aiPayload() {
  const markdown = [
    "---",
    "id: uc.manage-projects",
    "type: use_case",
    "title: Manage projects",
    "status: draft",
    "---",
    "",
    "# Manage projects"
  ].join("\n");
  return {
    entityId: "uc.manage-projects",
    type: "use_case",
    title: "Manage projects",
    status: "draft",
    filePath: "use-cases/uc.manage-projects.md",
    generatedMarkdown: markdown,
    markdown,
    sourceFiles: ["apps/api/src/routes/projects.ts"],
    proposedLinks: []
  };
}

function aiEvidence() {
  return {
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    promptVersion: "ai-prefill-v1",
    selectedSourceFiles: [
      { file: "apps/api/src/routes/projects.ts", contentHash: "hash-1", excerptStartLine: 1, excerptEndLine: 80 }
    ],
    claims: [{ text: "Project routes expose project creation.", sourceFiles: ["apps/api/src/routes/projects.ts"] }],
    warnings: []
  };
}
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL because the route does not filter by proposal type and service parsing only accepts `source_spec_entity`.

- [ ] **Step 3: Add API dependency**

In `apps/api/package.json`, add:

```json
"@specops/ai-prefill": "workspace:*"
```

- [ ] **Step 4: Generalize proposal list filtering**

In `apps/api/src/routes/proposals.ts`, parse `proposalType`:

```ts
app.get("/projects/:projectId/proposals", async (request) => {
  const { projectId } = projectParamsSchema.parse(request.params);
  const { status, proposalType } = proposalListQuerySchema.parse(request.query);
  return proposalService.listProposals(projectId, { status, proposalType });
});
```

Change `listProposals` signature in `proposal-service.ts`:

```ts
async function listProposals(
  projectId: string,
  filters: { status?: ProposalStatus; proposalType?: ProposalType } = {}
): Promise<ProposalSummaryDto[]> {
  const project = await projectService.getProject(projectId);
  const conditions = [eq(aiProposals.projectId, projectId)];
  if (filters.status) conditions.push(eq(aiProposals.status, filters.status));
  if (filters.proposalType) conditions.push(eq(aiProposals.proposalType, filters.proposalType));

  const rows = await db
    .select()
    .from(aiProposals)
    .where(and(...conditions))
    .orderBy(asc(aiProposals.createdAt), asc(aiProposals.title), asc(aiProposals.id));

  return mapSummaries(rows, project);
}
```

- [ ] **Step 5: Add discriminated payload/evidence parsing**

In `proposal-service.ts`, replace single payload parsing with:

```ts
function parsePayload(row: ProposalRow): SourceSpecEntityProposalPayload | AiSpecEntityProposalPayload {
  if (row.proposalType === "source_spec_entity") {
    return sourceSpecEntityProposalPayloadSchema.parse(row.payloadJson);
  }
  if (row.proposalType === "ai_spec_entity") {
    return aiSpecEntityProposalPayloadSchema.parse(row.payloadJson);
  }
  throw new BadRequestError("Unsupported proposal type", { proposalType: row.proposalType });
}

function parseEvidence(row: ProposalRow): SourceSpecEntityProposalEvidence | AiSpecEntityProposalEvidence {
  if (row.proposalType === "source_spec_entity") {
    return sourceSpecEntityProposalEvidenceSchema.parse(row.evidenceJson);
  }
  if (row.proposalType === "ai_spec_entity") {
    return aiSpecEntityProposalEvidenceSchema.parse(row.evidenceJson);
  }
  throw new BadRequestError("Unsupported proposal type", { proposalType: row.proposalType });
}
```

Import the new contract types and schemas.

- [ ] **Step 6: Generalize summary/detail mapping**

Update mapping functions:

```ts
function mapSummary(row: ProposalRow, conflict: ProposalConflictDto): ProposalSummaryDto {
  const payload = parsePayload(row);
  return {
    id: row.id,
    projectId: row.projectId,
    proposalType: row.proposalType as ProposalType,
    status: row.status as ProposalStatus,
    title: row.title,
    entityId: payload.entityId,
    entityType: payload.type,
    filePath: payload.filePath,
    confidence: row.confidence,
    conflict,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null
  };
}

function mapDetail(row: ProposalRow, conflict: ProposalConflictDto): ProposalDetailDto {
  const summary = mapSummary(row, conflict);
  return {
    ...summary,
    payload: parsePayload(row),
    evidence: parseEvidence(row)
  } as ProposalDetailDto;
}
```

- [ ] **Step 7: Allow AI proposal accept validation**

Keep the existing accept algorithm, but remove hardcoded `eq(aiProposals.proposalType, sourceSpecEntityProposalType)` from the selected-row query. Validate each selected row by `parsePayload(row)` and the existing markdown parser identity checks.

The selected rows query should become:

```ts
const rows = await db
  .select()
  .from(aiProposals)
  .where(and(eq(aiProposals.projectId, projectId), inArray(aiProposals.id, uniqueProposalIds)));
```

When computing accepted status, use common payload fields:

```ts
const status =
  item.payload.markdown === item.payload.generatedMarkdown ? "accepted" : "edited_and_accepted";
```

- [ ] **Step 8: Run API tests**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json apps/api/src/routes/proposals.ts apps/api/src/services/proposal-service.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: generalize proposals for ai prefill"
```

---

### Task 4: Add AI Prefill API Service and Route

**Files:**
- Modify: `apps/api/src/config.ts`
- Create: `apps/api/src/services/ai-prefill-service.ts`
- Create: `apps/api/src/routes/source.ts`
- Modify: `apps/api/src/routes/proposals.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing AI generation route tests**

In `apps/api/src/__tests__/routes.test.ts`, add tests with an injectable fake provider. Extend `registerProposalRoutes` options so tests can pass an `aiPrefillProviderFactory` function into the route plugin:

```ts
type RouteOptions = {
  db: Db;
  aiPrefillProviderFactory?: (request: AiPrefillGenerateRequest) => AiPrefillProvider;
};
```

The app setup in the test file should pass:

```ts
aiPrefillProviderFactory: (request) => ({
  async generateSpecProposals() {
    if (request.model === "provider-fails") {
      throw new Error("Provider failed during test");
    }
    return {
      provider: request.provider,
      model: request.model,
      text: JSON.stringify({
        proposals: [
          {
            entityId: "uc.manage-projects",
            type: "use_case",
            title: "Manage projects",
            summary: "Users can create and inspect local projects.",
            sourceFiles: ["apps/api/src/routes/projects.ts"],
            claims: [
              {
                text: "Project routes expose project creation.",
                sourceFiles: ["apps/api/src/routes/projects.ts"]
              }
            ],
            proposedLinks: [],
            confidence: 0.82
          }
        ]
      })
    };
  }
})
```

Test behavior:

```ts
it("generates AI proposals from selected source files without writing markdown", async () => {
  const project = await createIndexedProjectWithSourceFile({
    path: "apps/api/src/routes/projects.ts",
    content: "export async function projectRoutes() { return 'projects'; }"
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/proposals/ai-prefill`,
    payload: {
      sourceFileIds: [project.sourceFileId],
      provider: "ollama",
      model: "fake-local-model",
      temperature: 0.1
    }
  });

  expect(response.statusCode).toBe(201);
  expect(response.json().proposals).toMatchObject([
    {
      proposalType: "ai_spec_entity",
      entityId: "uc.manage-projects",
      status: "pending"
    }
  ]);
  await expect(
    readFile(path.join(project.specopsPath, "use-cases/uc.manage-projects.md"), "utf8")
  ).rejects.toMatchObject({ code: "ENOENT" });
});
```

Add a provider failure test:

```ts
it("writes no AI proposals when provider generation fails", async () => {
  const project = await createIndexedProjectWithSourceFile({
    path: "apps/api/src/routes/projects.ts",
    content: "export const projectRoutes = true;"
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/proposals/ai-prefill`,
    payload: {
      sourceFileIds: [project.sourceFileId],
      provider: "ollama",
      model: "provider-fails"
    }
  });

  expect(response.statusCode).toBe(500);
  const rows = await pool.query("select * from ai_proposals where project_id = $1 and proposal_type = 'ai_spec_entity'", [project.id]);
  expect(rows.rowCount).toBe(0);
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
```

Expected: FAIL because `/proposals/ai-prefill` does not exist.

- [ ] **Step 3: Add config defaults**

In `apps/api/src/config.ts`, extend the config schema:

```ts
AI_PREFILL_OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
AI_PREFILL_OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
OPENAI_API_KEY: z.string().optional(),
AI_PREFILL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
AI_PREFILL_MAX_FILES: z.coerce.number().int().min(1).max(20).default(5),
AI_PREFILL_MAX_TOTAL_BYTES: z.coerce.number().int().min(1000).default(60_000)
```

Export normalized camelCase properties matching existing config style:

```ts
aiPrefill: {
  ollamaBaseUrl: env.AI_PREFILL_OLLAMA_BASE_URL,
  openAiBaseUrl: env.AI_PREFILL_OPENAI_BASE_URL,
  openAiApiKey: env.OPENAI_API_KEY,
  timeoutMs: env.AI_PREFILL_TIMEOUT_MS,
  maxFiles: env.AI_PREFILL_MAX_FILES,
  maxTotalBytes: env.AI_PREFILL_MAX_TOTAL_BYTES
}
```

- [ ] **Step 4: Implement AI Prefill service**

Create `apps/api/src/services/ai-prefill-service.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildAiPrefillPromptPacket,
  createAiPrefillProvider,
  normalizeProviderResponse,
  renderAiSpecEntityProposal,
  type AiPrefillProvider
} from "@specops/ai-prefill";
import type {
  AiPrefillGenerateRequest,
  AiPrefillDiagnostic
} from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  sourceExports,
  sourceFiles,
  sourceImports,
  sourceSymbols,
  specEntities
} from "@specops/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { BadRequestError } from "../lib/http-errors.js";
import { assertAbsolutePath, assertInsideDirectory, assertRealPathInsideDirectory } from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

export type AiPrefillServiceOptions = {
  providerFactory?: (request: AiPrefillGenerateRequest) => AiPrefillProvider;
  config: {
    ollamaBaseUrl: string;
    openAiBaseUrl: string;
    openAiApiKey?: string;
    timeoutMs: number;
    maxFiles: number;
    maxTotalBytes: number;
  };
};

export function createAiPrefillService(db: Db, options: AiPrefillServiceOptions) {
  const projectService = createProjectService(db);

  return {
    async generate(projectId: string, request: AiPrefillGenerateRequest) {
      const project = await projectService.getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);

      const selectedRows = await db
        .select()
        .from(sourceFiles)
        .where(and(eq(sourceFiles.projectId, projectId), inArray(sourceFiles.id, request.sourceFileIds)))
        .orderBy(asc(sourceFiles.path));

      if (selectedRows.length !== request.sourceFileIds.length) {
        throw new BadRequestError("Selected source files must belong to the project");
      }

      const selectedFiles = [];
      for (const row of selectedRows) {
        const fullPath = assertInsideDirectory(repoPath, path.join(repoPath, row.path));
        const realPath = await assertRealPathInsideDirectory(repoPath, fullPath);
        const text = await readFile(realPath, "utf8");
        selectedFiles.push({
          id: row.id,
          path: row.path,
          contentHash: row.contentHash,
          language: row.language,
          kind: row.kind,
          text,
          startLine: 1,
          endLine: text.split(/\r?\n/).length,
          imports: await importsForFile(projectId, row.id),
          exports: await exportsForFile(projectId, row.id),
          symbols: await symbolsForFile(projectId, row.id)
        });
      }

      const existingEntities = await db
        .select({ entityId: specEntities.entityId, type: specEntities.type, title: specEntities.title })
        .from(specEntities)
        .where(eq(specEntities.projectId, projectId))
        .orderBy(asc(specEntities.entityId));

      const packet = buildAiPrefillPromptPacket({
        project: { name: project.name, description: project.description },
        selectedFiles,
        existingEntities,
        allowedEntityTypes: ["use_case", "domain_entity", "interface"],
        allowedLinkTypes: ["depends_on", "implements", "refines", "uses", "exposes", "tested_by", "documents", "generated_from", "touches", "related_to"],
        limits: { maxFiles: options.config.maxFiles, maxTotalBytes: options.config.maxTotalBytes }
      });

      const provider = options.providerFactory
        ? options.providerFactory(request)
        : createAiPrefillProvider({
            provider: request.provider,
            ollamaBaseUrl: options.config.ollamaBaseUrl,
            openAiBaseUrl: options.config.openAiBaseUrl,
            openAiApiKey: options.config.openAiApiKey,
            timeoutMs: options.config.timeoutMs
          });
      const providerResult = await provider.generateSpecProposals({
        packet,
        model: request.model,
        temperature: request.temperature
      });
      const normalized = normalizeProviderResponse({
        provider: request.provider,
        model: request.model,
        text: providerResult.text,
        selectedSourceFiles: selectedRows.map((row) => row.path),
        existingEntityIds: new Set(existingEntities.map((entity) => entity.entityId))
      });
      if (normalized.candidates.length === 0) {
        throw new BadRequestError("AI provider returned no valid proposals", { diagnostics: normalized.diagnostics });
      }

      const evidenceBase = {
        provider: request.provider,
        model: request.model,
        promptVersion: packet.promptVersion,
        selectedSourceFiles: packet.selectedSourceFiles,
        warnings: normalized.diagnostics.map((diagnostic) => diagnostic.message)
      } as const;
      const rendered = normalized.candidates.map((candidate) =>
        renderAiSpecEntityProposal({
          candidate,
          evidence: {
            ...evidenceBase,
            claims: candidate.claims
          }
        })
      );

      const rows = await db.transaction(async (tx) => {
        await tx
          .update(aiProposals)
          .set({ status: "obsolete", reviewedAt: new Date() })
          .where(and(eq(aiProposals.projectId, projectId), eq(aiProposals.proposalType, "ai_spec_entity"), eq(aiProposals.status, "pending")));
        return tx.insert(aiProposals).values(
          rendered.map((proposal) => ({
            projectId,
            proposalType: proposal.proposalType,
            title: proposal.title,
            payloadJson: proposal.payload,
            evidenceJson: proposal.evidence,
            confidence: proposal.confidence,
            status: "pending"
          }))
        ).returning();
      });

      return {
        proposals: rows,
        diagnostics: normalized.diagnostics satisfies AiPrefillDiagnostic[]
      };
    }
  };

  async function importsForFile(projectId: string, sourceFileId: string) {
    return db.select().from(sourceImports).where(and(eq(sourceImports.projectId, projectId), eq(sourceImports.sourceFileId, sourceFileId)));
  }

  async function exportsForFile(projectId: string, sourceFileId: string) {
    return db.select().from(sourceExports).where(and(eq(sourceExports.projectId, projectId), eq(sourceExports.sourceFileId, sourceFileId)));
  }

  async function symbolsForFile(projectId: string, sourceFileId: string) {
    return db.select({
      name: sourceSymbols.name,
      symbolKind: sourceSymbols.symbolKind,
      isExported: sourceSymbols.isExported,
      line: sourceSymbols.line
    }).from(sourceSymbols).where(and(eq(sourceSymbols.projectId, projectId), eq(sourceSymbols.sourceFileId, sourceFileId)));
  }
}
```

Return `ProposalSummaryDto[]` from `ai-prefill-service.ts` by importing an exported helper from `proposal-service.ts`:

```ts
export async function mapProposalRowsToSummaries(input: {
  rows: ProposalRow[];
  project: ProjectDto;
}): Promise<ProposalSummaryDto[]> {
  return Promise.all(
    input.rows.map(async (row) => mapSummary(row, await conflictForPayload(input.project, parsePayload(row))))
  );
}
```

Then use it in `ai-prefill-service.ts`:

```ts
return {
  proposals: await mapProposalRowsToSummaries({ rows, project }),
  diagnostics: normalized.diagnostics
};
```

- [ ] **Step 5: Register route**

In `apps/api/src/routes/proposals.ts`, instantiate AI service and add:

```ts
app.post("/projects/:projectId/proposals/ai-prefill", async (request, reply) => {
  const { projectId } = projectParamsSchema.parse(request.params);
  const input = aiPrefillGenerateRequestSchema.parse(request.body);
  const result = await aiPrefillService.generate(projectId, input);
  return reply.code(201).send(result);
});
```

Import `aiPrefillGenerateRequestSchema` and create the service with API config.

- [ ] **Step 6: Add source inventory routes for source selection**

Create `apps/api/src/routes/source.ts`:

```ts
import { sourceFileListQuerySchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createProjectService } from "../services/project-service.js";
import { createSourceScanService } from "../services/source-scan-service.js";

type RouteOptions = {
  db: Db;
};

const projectParamsSchema = z.object({
  projectId: z.string().min(1)
});

const sourceFileParamsSchema = z.object({
  projectId: z.string().min(1),
  sourceFileId: z.string().min(1)
});

export const registerSourceRoutes: FastifyPluginAsync<RouteOptions> = async (app, { db }) => {
  const projectService = createProjectService(db);
  const sourceScanService = createSourceScanService(db);

  app.get("/projects/:projectId/source-files", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const query = sourceFileListQuerySchema.parse(request.query);
    await projectService.getProject(projectId);
    return sourceScanService.listSourceFiles(projectId, query);
  });

  app.get("/projects/:projectId/source-files/:sourceFileId", async (request) => {
    const { projectId, sourceFileId } = sourceFileParamsSchema.parse(request.params);
    await projectService.getProject(projectId);
    return sourceScanService.getSourceFileDetail(projectId, sourceFileId);
  });
};
```

In `apps/api/src/server.ts`, import and register:

```ts
import { registerSourceRoutes } from "./routes/source.js";
```

```ts
app.register(registerSourceRoutes, { prefix: "/api", db });
```

- [ ] **Step 7: Run route tests and typecheck**

Run:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test -- routes.test.ts
pnpm --filter api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/services/ai-prefill-service.ts apps/api/src/routes/proposals.ts apps/api/src/routes/source.ts apps/api/src/server.ts apps/api/src/__tests__/routes.test.ts
git commit -m "feat: generate ai prefill proposals"
```

---

### Task 5: Add Web API Bindings and Route Shell

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/routes/ai-prefill.tsx`
- Create: `apps/web/src/routes/ai-prefill.test.tsx`

- [ ] **Step 1: Write failing route shell test**

Create `apps/web/src/routes/ai-prefill.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiPrefillPage } from "./ai-prefill.js";

vi.mock("../api/queries.js", async () => {
  const actual = await vi.importActual<typeof import("../api/queries.js")>("../api/queries.js");
  return {
    ...actual,
    sourceFilesQuery: () => ({
      queryKey: ["source-files"],
      queryFn: async () => [
        {
          id: "source-file-1",
          projectId: "project-1",
          path: "apps/api/src/routes/projects.ts",
          language: "typescript",
          kind: "source",
          sizeBytes: 1234,
          contentHash: "hash-1",
          lastSeenAt: "2026-05-11T10:00:00.000Z",
          importCount: 2,
          exportCount: 1,
          symbolCount: 3
        }
      ]
    }),
    proposalsQuery: () => ({
      queryKey: ["proposals"],
      queryFn: async () => []
    })
  };
});

describe("AiPrefillPage", () => {
  it("renders source selection, provider controls, and proposal review columns", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AiPrefillPage projectId="project-1" />
      </QueryClientProvider>
    );

    expect(await screen.findByText("AI Prefill")).toBeInTheDocument();
    expect(await screen.findByText("apps/api/src/routes/projects.ts")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(screen.getByText("Pending proposals")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run web test and verify failure**

Run:

```bash
pnpm --filter web test -- ai-prefill.test.tsx
```

Expected: FAIL because `AiPrefillPage` and `sourceFilesQuery` do not exist.

- [ ] **Step 3: Add API query helpers**

In `apps/web/src/api/queries.ts`, import new types:

```ts
AiPrefillGenerateRequest,
AiPrefillGenerateResponse,
SourceFileListQuery,
SourceFileSummaryDto
```

Add keys and helpers:

```ts
sourceFiles: (projectId: string, input: SourceFileListQuery = {}) =>
  ["projects", projectId, "source-files", input] as const,
```

```ts
export function sourceFilesQuery(projectId: string, input: SourceFileListQuery = {}) {
  const search = new URLSearchParams();
  if (input.language) search.set("language", input.language);
  if (input.kind) search.set("kind", input.kind);
  if (input.q) search.set("q", input.q);
  if (input.limit) search.set("limit", String(input.limit));
  if (input.offset) search.set("offset", String(input.offset));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return queryOptions({
    queryKey: queryKeys.sourceFiles(projectId, input),
    queryFn: () =>
      apiGet<SourceFileSummaryDto[]>(
        `/api/projects/${encodeURIComponent(projectId)}/source-files${suffix}`
      )
  });
}

export function generateAiPrefillProposals(projectId: string, input: AiPrefillGenerateRequest) {
  return apiSend<AiPrefillGenerateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/proposals/ai-prefill`,
    { method: "POST", body: input }
  );
}
```

Update `proposalsQuery` to include `proposalType`:

```ts
if (input.proposalType) {
  search.set("proposalType", input.proposalType);
}
```

- [ ] **Step 4: Create route shell**

Create `apps/web/src/routes/ai-prefill.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";

import {
  generateAiPrefillProposals,
  proposalsQuery,
  queryKeys,
  sourceFilesQuery
} from "../api/queries.js";

export function AiPrefillPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<"ollama" | "openai">("ollama");
  const [model, setModel] = useState("qwen2.5-coder:7b");
  const [selectedSourceFileIds, setSelectedSourceFileIds] = useState<Set<string>>(() => new Set());
  const sourceFiles = useQuery(sourceFilesQuery(projectId, { limit: 100, offset: 0 }));
  const proposals = useQuery(proposalsQuery(projectId, { proposalType: "ai_spec_entity" }));
  const selectedCount = selectedSourceFileIds.size;
  const selectedSize = useMemo(
    () =>
      (sourceFiles.data ?? [])
        .filter((file) => selectedSourceFileIds.has(file.id))
        .reduce((sum, file) => sum + file.sizeBytes, 0),
    [selectedSourceFileIds, sourceFiles.data]
  );
  const generateMutation = useMutation({
    mutationFn: () =>
      generateAiPrefillProposals(projectId, {
        provider,
        model,
        sourceFileIds: [...selectedSourceFileIds],
        temperature: 0.1
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) });
    }
  });

  return (
    <main className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">AI Prefill</h1>
          <p className="text-sm text-slate-600">Generate reviewable spec proposals from selected source files.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="grid gap-1 text-xs font-medium text-slate-700">
            Provider
            <select
              aria-label="Provider"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={provider}
              onChange={(event) => setProvider(event.target.value as "ollama" | "openai")}
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-700">
            Model
            <input
              aria-label="Model"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button-primary self-end"
            disabled={selectedCount === 0 || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Generate
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[360px_360px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Source files</h2>
            <p className="text-xs text-slate-500">{selectedCount} selected / {selectedSize} bytes</p>
          </header>
          <div className="min-h-0 overflow-auto p-2">
            {(sourceFiles.data ?? []).map((file) => (
              <label key={file.id} className="entity-row grid-cols-[auto_minmax(0,1fr)]">
                <input
                  type="checkbox"
                  checked={selectedSourceFileIds.has(file.id)}
                  onChange={() =>
                    setSelectedSourceFileIds((current) => {
                      const next = new Set(current);
                      if (next.has(file.id)) next.delete(file.id);
                      else next.add(file.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{file.path}</span>
                  <span className="block text-xs text-slate-500">{file.kind} / {file.language ?? "unknown"} / {file.symbolCount} symbols</span>
                </span>
              </label>
            ))}
          </div>
        </aside>
        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Pending proposals</h2>
          </header>
          <div className="p-3 text-sm text-slate-600">
            {(proposals.data ?? []).length === 0 ? "No AI proposals yet." : `${proposals.data!.length} AI proposals`}
          </div>
        </aside>
        <section className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-slate-800">Proposal detail</h2>
          <p className="mt-2 text-sm text-slate-600">Select a proposal to review.</p>
          <button type="button" className="button-secondary mt-3" disabled>
            <Check className="h-4 w-4" aria-hidden="true" />
            Accept selected
          </button>
        </section>
      </div>
      {generateMutation.error ? (
        <p className="mt-2 text-sm text-red-700">{generateMutation.error.message}</p>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 5: Add route**

In `apps/web/src/app.tsx`, import and register:

```tsx
import { AiPrefillPage } from "./routes/ai-prefill.js";
```

```tsx
const aiPrefillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai-prefill",
  component: () => {
    const { projectId } = aiPrefillRoute.useParams();
    return <AiPrefillPage projectId={projectId} />;
  }
});
```

Add `aiPrefillRoute` to `routeTree`.

- [ ] **Step 6: Run web test and typecheck**

Run:

```bash
pnpm --filter web test -- ai-prefill.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/app.tsx apps/web/src/routes/ai-prefill.tsx apps/web/src/routes/ai-prefill.test.tsx
git commit -m "feat: add ai prefill route shell"
```

---

### Task 6: Complete AI Prefill Review UI

**Files:**
- Modify: `apps/web/src/routes/ai-prefill.tsx`
- Modify: `apps/web/src/routes/ai-prefill.test.tsx`
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/components/project-actions.tsx` or `apps/web/src/components/project-overview-dashboard.tsx`

- [ ] **Step 1: Add failing UI tests for proposal review**

Extend `ai-prefill.test.tsx` so mocked proposals return one `ai_spec_entity` detail and user interactions are covered:

```tsx
it("reviews, edits, rejects, and accepts AI proposals", async () => {
  const user = userEvent.setup();
  renderAiPrefillPageWithMocks({
    proposals: [aiProposalSummary()],
    proposalDetail: aiProposalDetail()
  });

  await user.click(await screen.findByText("Manage projects"));
  expect(await screen.findByText("AI evidence")).toBeInTheDocument();
  expect(screen.getByText("qwen2.5-coder:7b")).toBeInTheDocument();
  expect(screen.getByText("Project routes expose project creation.")).toBeInTheDocument();

  await user.click(screen.getByLabelText("Select Manage projects"));
  await user.click(screen.getByRole("button", { name: /accept selected/i }));

  expect(acceptProposalsMock).toHaveBeenCalledWith("project-1", { proposalIds: ["proposal-1"] });
});
```

Use helpers:

```ts
function aiProposalSummary() {
  return {
    id: "proposal-1",
    projectId: "project-1",
    proposalType: "ai_spec_entity",
    status: "pending",
    title: "Manage projects",
    entityId: "uc.manage-projects",
    entityType: "use_case",
    filePath: "use-cases/uc.manage-projects.md",
    confidence: 0.82,
    conflict: { status: "none" },
    createdAt: "2026-05-11T10:00:00.000Z",
    reviewedAt: null
  };
}
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter web test -- ai-prefill.test.tsx
```

Expected: FAIL because full review behavior is missing.

- [ ] **Step 3: Add mutations if missing**

In `apps/web/src/api/queries.ts`, ensure these existing helpers are exported and accept AI proposals unchanged:

```ts
export function patchProposal(projectId: string, proposalId: string, input: ProposalPatchRequest) {
  return apiSend<ProposalDetailDto>(
    `/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`,
    { method: "PATCH", body: input }
  );
}

export function acceptProposals(projectId: string, input: AcceptProposalsRequest) {
  return apiSend<AcceptProposalsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/proposals/accept`,
    { method: "POST", body: input }
  );
}
```

- [ ] **Step 4: Implement proposal list/detail behavior**

In `AiPrefillPage`, mirror the source-import page state model:

```ts
const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
const [checkedProposalIds, setCheckedProposalIds] = useState<Set<string>>(() => new Set());
const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, { markdown: string; savedMarkdown: string }>>({});
const selectedDetail = useQuery({
  ...proposalQuery(projectId, selectedProposalId ?? ""),
  enabled: selectedProposalId !== null
});
```

Use `proposalsQuery(projectId, { proposalType: "ai_spec_entity", status: statusFilter })`.

Render proposal rows with:

```tsx
<input
  type="checkbox"
  aria-label={`Select ${proposal.title}`}
  checked={checkedProposalIds.has(proposal.id)}
  disabled={proposal.status !== "pending"}
  onChange={() => toggleCheckedProposal(proposal.id)}
/>
```

Render detail only for `selectedDetail.data?.proposalType === "ai_spec_entity"`:

```tsx
<section className="panel-section">
  <h3 className="section-heading">AI evidence</h3>
  <p className="text-xs text-slate-600">
    {selectedDetail.data.evidence.provider} / {selectedDetail.data.evidence.model} / {selectedDetail.data.evidence.promptVersion}
  </p>
  <div className="mt-2 grid gap-2">
    {selectedDetail.data.evidence.claims.map((claim) => (
      <div key={claim.text} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
        <p className="font-medium text-slate-900">{claim.text}</p>
        {claim.sourceFiles.map((file) => (
          <p key={file} className="mt-1 truncate text-slate-600">{file}</p>
        ))}
      </div>
    ))}
  </div>
</section>
```

Render proposed links:

```tsx
<section className="panel-section">
  <h3 className="section-heading">Proposed links</h3>
  {selectedDetail.data.payload.proposedLinks.length === 0 ? (
    <p className="text-sm text-slate-500">No proposed links.</p>
  ) : (
    selectedDetail.data.payload.proposedLinks.map((link) => (
      <div key={`${link.linkType}:${link.targetEntityId}`} className="rounded border border-slate-200 p-2 text-xs">
        <span className="font-medium">{link.linkType}</span> -> <span>{link.targetEntityId}</span>
        <p className="mt-1 text-slate-600">{link.rationale}</p>
      </div>
    ))
  )}
</section>
```

- [ ] **Step 5: Add save/reject/accept mutations**

Use the same invalidation set as `SourceImportPage`:

```ts
await Promise.all([
  queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.projectHealth(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
  queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
]);
```

- [ ] **Step 6: Add project action link**

In the project action component, add:

```tsx
<Link
  to="/projects/$projectId/ai-prefill"
  params={{ projectId: project.id }}
  className="button-secondary"
>
  <Sparkles className="h-4 w-4" aria-hidden="true" />
  AI Prefill
</Link>
```

Import `Sparkles` from `lucide-react`.

- [ ] **Step 7: Run web tests and build**

Run:

```bash
pnpm --filter web test -- ai-prefill.test.tsx
pnpm --filter web test -- project-actions.test.tsx ai-prefill.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/ai-prefill.tsx apps/web/src/routes/ai-prefill.test.tsx apps/web/src/api/queries.ts apps/web/src/components/project-actions.tsx
git commit -m "feat: complete ai prefill review ui"
```

---

### Task 7: End-to-End Validation and Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: any tests touched by previous tasks

- [ ] **Step 1: Document environment variables**

In `.env.example`, add:

```sh
AI_PREFILL_OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_PREFILL_OPENAI_BASE_URL=https://api.openai.com/v1
AI_PREFILL_TIMEOUT_MS=60000
AI_PREFILL_MAX_FILES=5
AI_PREFILL_MAX_TOTAL_BYTES=60000
# OPENAI_API_KEY=
```

In `README.md`, add a short AI Prefill section:

```md
## AI Prefill

AI Prefill generates reviewable spec proposals from manually selected indexed source files. Generation writes pending proposal rows only; accepted proposals write canonical markdown under `specops/`.

Ollama is the default local provider:

```sh
ollama serve
ollama pull qwen2.5-coder:7b
```

OpenAI can be enabled by setting `OPENAI_API_KEY` and choosing the OpenAI provider in the UI.
```
```

- [ ] **Step 2: Run full focused validation**

Run:

```bash
pnpm --filter @specops/contracts test
pnpm --filter @specops/ai-prefill test
pnpm --filter api typecheck
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS.

If PostgreSQL is running and `TEST_DATABASE_URL` is available:

```bash
TEST_DATABASE_URL=postgres://specops:specops@localhost:5436/specops_test pnpm --filter api test
```

Expected: PASS. If the test DB is unavailable, record that DB-backed tests were not run.

- [ ] **Step 3: Run workspace validation**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: PASS, with documented skips only for DB-backed tests when `TEST_DATABASE_URL` is absent.

- [ ] **Step 4: Commit docs and final fixes**

```bash
git add README.md .env.example
git commit -m "docs: document ai prefill configuration"
```

---

## Self-Review Notes

Spec coverage:

- Manual source-file selection is covered by Tasks 5 and 6.
- Ollama and OpenAI provider adapter boundary is covered by Task 2 and Task 4.
- Proposal persistence, review, edit, reject, accept, and re-index are covered by Tasks 3, 4, and 6.
- Canonical markdown write safety is covered by Task 3 and final API validation.
- Project-level split review inbox is covered by Tasks 5 and 6.
- Tests are assigned at package, contract, API, and web levels.

Type consistency:

- Proposal type is consistently `ai_spec_entity`.
- Provider literals are consistently `ollama` and `openai`.
- Prompt version is consistently `ai-prefill-v1`.
- Payload fields match the design spec: `entityId`, `type`, `title`, `status`, `filePath`, `generatedMarkdown`, `markdown`, `sourceFiles`, `proposedLinks`.

Execution notes:

- Use small commits per task.
- Do not edit canonical markdown during generation.
- Do not skip the all-or-nothing accept behavior.
- Preserve the existing source import route and proposal lifecycle.
