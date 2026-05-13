import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiSpecEntityProposalEvidence, AiSpecEntityProposalPayload } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  analyzeRuns,
  createDb,
  projects,
  analyzeReviewClaimEvidence,
  sourceSpecAnnotations
} from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAnalyzeReviewAssemblyService } from "../services/analyze-review-assembly-service.js";
import { createProjectService } from "../services/project-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnalyzeReviewAssemblyService", () => {
  const tempRoots: string[] = [];
  const projectIds: string[] = [];
  let db: Db;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }

    await migrateTestDatabase(testDatabaseUrl);
    db = createDb(testDatabaseUrl);
  });

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }

    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("derives one draft assembly per run proposal and is idempotent", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);

    const first = await service.listReviewAssemblies(project.id, run.id);
    const second = await service.listReviewAssemblies(project.id, run.id);

    expect(first.assemblies).toHaveLength(1);
    expect(second.assemblies).toHaveLength(1);
    expect(first.assemblies[0]?.inputs[0]?.proposalId).toBe(proposal.id);
    expect(first.assemblies[0]?.validation.state).toBe("ready");
  });

  it("derives missing proposals when a run is partially initialized", async () => {
    const { db, project, run, proposals } = await createReviewFixture({
      derive: false,
      proposalCount: 2
    });
    const service = createAnalyzeReviewAssemblyService(db);

    await service.createAssembly(project.id, run.id, {
      proposalIds: [proposals[0]!.id]
    });

    const first = await service.listReviewAssemblies(project.id, run.id);
    const second = await service.listReviewAssemblies(project.id, run.id);
    const assignedProposalIds = first.assemblies.flatMap((assembly) =>
      assembly.inputs.map((input) => input.proposalId)
    );

    expect(first.assemblies).toHaveLength(2);
    expect(second.assemblies).toHaveLength(2);
    expect(assignedProposalIds).toEqual(expect.arrayContaining(proposals.map((item) => item.id)));
  });

  it("does not derive a duplicate active assignment from another run in the project", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);
    await service.listReviewAssemblies(project.id, run.id);
    const [secondRun] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: [proposal.id],
        aiProposalCount: 1
      })
      .returning();
    expect(secondRun).toBeDefined();

    const review = await service.listReviewAssemblies(project.id, secondRun!.id);

    expect(review.assemblies.flatMap((item) => item.inputs)).toHaveLength(0);
    expect(review.unassignedInputs.map((input) => input.proposalId)).toContain(proposal.id);
  });

  it("attaches and removes proposal inputs without rederiving removed inputs", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: proposal.id,
      role: "primary"
    });
    let review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.inputs).toHaveLength(1);

    await service.removeInput(project.id, run.id, assembly.id, proposal.id);
    review = await service.listReviewAssemblies(project.id, run.id);
    const listedAgain = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies).toHaveLength(1);
    expect(listedAgain.assemblies).toHaveLength(1);
    expect(review.unassignedInputs.map((input) => input.proposalId)).toContain(proposal.id);
    expect(listedAgain.unassignedInputs.map((input) => input.proposalId)).toContain(proposal.id);
    expect(
      listedAgain.assemblies.flatMap((item) =>
        item.status === "draft" ? item.inputs.map((input) => input.proposalId) : []
      )
    ).not.toContain(proposal.id);
  });

  it("does not rederive a removed input from a multi-input assembly", async () => {
    const { db, project, run, proposals } = await createReviewFixture({
      derive: false,
      proposalCount: 2
    });
    const service = createAnalyzeReviewAssemblyService(db);
    const removedProposal = proposals[0]!;
    const keptProposal = proposals[1]!;
    const assembly = await service.createAssembly(project.id, run.id, {
      proposalIds: [removedProposal.id, keptProposal.id]
    });

    await service.removeInput(project.id, run.id, assembly.id, removedProposal.id);
    const review = await service.listReviewAssemblies(project.id, run.id);
    const listedAgain = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies).toHaveLength(1);
    expect(listedAgain.assemblies).toHaveLength(1);
    expect(listedAgain.unassignedInputs.map((input) => input.proposalId)).toContain(
      removedProposal.id
    );
    expect(
      listedAgain.assemblies.flatMap((item) =>
        item.status === "draft"
          ? item.inputs
              .filter((input) => input.assignmentState === "assigned")
              .map((input) => input.proposalId)
          : []
      )
    ).not.toContain(removedProposal.id);
    expect(
      listedAgain.assemblies.flatMap((item) =>
        item.inputs
          .filter((input) => input.assignmentState === "assigned")
          .map((input) => input.proposalId)
      )
    ).toContain(keptProposal.id);
  });

  it("reattaches a removed input to the same assembly by reviving the tombstone", async () => {
    const { db, project, run, proposals } = await createReviewFixture({
      derive: false,
      proposalCount: 2
    });
    const service = createAnalyzeReviewAssemblyService(db);
    const removedProposal = proposals[0]!;
    const keptProposal = proposals[1]!;
    const assembly = await service.createAssembly(project.id, run.id, {
      proposalIds: [removedProposal.id, keptProposal.id]
    });

    await service.removeInput(project.id, run.id, assembly.id, removedProposal.id);
    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: removedProposal.id,
      role: "primary"
    });
    const review = await service.listReviewAssemblies(project.id, run.id);
    const activeInputs = review.assemblies
      .flatMap((item) => item.inputs)
      .filter((input) => input.assignmentState === "assigned");

    expect(activeInputs.map((input) => input.proposalId)).toEqual(
      expect.arrayContaining([removedProposal.id, keptProposal.id])
    );
    expect(review.unassignedInputs.map((input) => input.proposalId)).not.toContain(
      removedProposal.id
    );
  });

  it("derives active input when a run proposal only has evidence-only inputs", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: proposal.id,
      role: "evidence_only"
    });

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.inputs[0]?.role).toBe("evidence_only");
    expect(review.assemblies.flatMap((item) => item.inputs.map((input) => input.proposalId))).toContain(
      proposal.id
    );
    expect(review.counts.inputs.assigned).toBe(1);
  });

  it("blocks creating a second draft assembly with an actively assigned proposal", async () => {
    const { db, project, run, proposal } = await createReviewFixture();
    const service = createAnalyzeReviewAssemblyService(db);

    await service.listReviewAssemblies(project.id, run.id);

    await expect(
      service.createAssembly(project.id, run.id, {
        proposalIds: [proposal.id]
      })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Proposal is already assigned to an active assembly"
    });
  });

  it("blocks attaching an actively assigned proposal to another draft assembly", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const firstAssembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts",
      entityType: "use_case",
      entityId: "use-case.review-drafts",
      filePath: "use-cases/review-drafts.md",
      summary: "Review generated drafts.",
      proposalIds: []
    });
    const secondAssembly = await service.createAssembly(project.id, run.id, {
      title: "Review drafts follow-up",
      entityType: "use_case",
      entityId: "use-case.review-drafts-follow-up",
      filePath: "use-cases/review-drafts-follow-up.md",
      summary: "Review generated drafts follow-up.",
      proposalIds: []
    });

    await service.attachInput(project.id, run.id, firstAssembly.id, {
      proposalId: proposal.id,
      role: "primary"
    });

    await expect(
      service.attachInput(project.id, run.id, secondAssembly.id, {
        proposalId: proposal.id,
        role: "primary"
      })
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Proposal is already assigned to an active assembly"
    });
  });

  it("uses the first AI claim text when selected source evidence exists", async () => {
    const { db, project, run } = await createReviewFixture({
      claims: [
        {
          text: "First generated claim is kept even when its source file does not overlap.",
          sourceFiles: ["apps/api/src/not-selected.ts"]
        },
        {
          text: "Second generated claim overlaps the selected source file.",
          sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"]
        }
      ]
    });
    const service = createAnalyzeReviewAssemblyService(db);

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.claims[0]?.text).toBe(
      "First generated claim is kept even when its source file does not overlap."
    );
    expect(review.assemblies[0]?.claims[0]?.evidence).toHaveLength(0);
    expect(review.assemblies[0]?.validation.state).toBe("blocker");
  });

  it("does not attach selected AI evidence to a synthetic fact when AI claims are empty", async () => {
    const { db, project, run } = await createReviewFixture({ claims: [] });
    const service = createAnalyzeReviewAssemblyService(db);

    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(review.assemblies[0]?.claims[0]).toMatchObject({
      kind: "hypothesis",
      text: "Review drafts",
      evidence: []
    });
    expect(review.assemblies[0]?.validation.state).toBe("warning");
  });

  it("inserts new claims at the next sort order", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Claims",
      entityType: "use_case",
      entityId: "use-case.claims",
      filePath: "use-cases/claims.md",
      summary: "Claims assembly.",
      proposalIds: []
    });

    const first = await service.createClaim(project.id, run.id, assembly.id, {
      text: "First claim.",
      kind: "hypothesis",
      confidence: 0.4
    });
    const second = await service.createClaim(project.id, run.id, assembly.id, {
      text: "Second claim.",
      kind: "hypothesis",
      confidence: null
    });

    expect(first.sortOrder).toBe(0);
    expect(first.evidence).toEqual([]);
    expect(second.sortOrder).toBe(1);
  });

  it("patches claims and refreshes assembly validation", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Patch claim",
      entityType: "use_case",
      entityId: "use-case.patch-claim",
      filePath: "use-cases/patch-claim.md",
      summary: "Patch claim assembly.",
      proposalIds: []
    });
    const claim = await service.createClaim(project.id, run.id, assembly.id, {
      text: "Fact missing evidence.",
      kind: "fact",
      confidence: 0.7
    });

    const patched = await service.patchClaim(project.id, run.id, assembly.id, claim.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.3,
      sortOrder: 4
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(patched).toMatchObject({
      id: claim.id,
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.3,
      sortOrder: 4,
      evidence: []
    });
    expect(review.assemblies[0]?.validation.state).toBe("warning");
    expect(review.assemblies[0]?.renderedMarkdown).toContain("Needs confirmation.");
  });

  it("verifies evidence proposal and claim ownership", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const firstAssembly = await service.createAssembly(project.id, run.id, {
      title: "First",
      entityType: "use_case",
      entityId: "use-case.first",
      filePath: "use-cases/first.md",
      summary: "First assembly.",
      proposalIds: []
    });
    const secondAssembly = await service.createAssembly(project.id, run.id, {
      title: "Second",
      entityType: "use_case",
      entityId: "use-case.second",
      filePath: "use-cases/second.md",
      summary: "Second assembly.",
      proposalIds: []
    });
    const claim = await service.createClaim(project.id, run.id, firstAssembly.id, {
      text: "Owned by first assembly.",
      kind: "fact",
      confidence: 0.8
    });
    const otherClaim = await service.createClaim(project.id, run.id, secondAssembly.id, {
      text: "Owned by second assembly.",
      kind: "fact",
      confidence: 0.8
    });
    const [outsideRunProposal] = await db
      .insert(aiProposals)
      .values({
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: "Outside run",
        payloadJson: {
          entityId: "use-case.outside-run",
          type: "use_case",
          title: "Outside run",
          status: "draft",
          filePath: "use-cases/outside-run.md",
          generatedMarkdown: "---\nid: use-case.outside-run\n---\n\n# Outside run\n",
          markdown: "---\nid: use-case.outside-run\n---\n\n# Outside run\n",
          sourceFiles: [],
          proposedLinks: []
        },
        evidenceJson: {
          provider: "ollama",
          model: "gemma4",
          promptVersion: "ai-prefill-v1",
          selectedSourceFiles: [],
          claims: [],
          warnings: []
        },
        confidence: 0.5,
        status: "pending"
      })
      .returning();
    expect(outsideRunProposal).toBeDefined();

    await expect(
      service.attachEvidence(project.id, run.id, firstAssembly.id, claim.id, {
        proposalId: outsideRunProposal!.id,
        sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
        symbolName: "attachEvidence",
        startLine: 1,
        endLine: 5,
        provenance: "user",
        confidence: 0.8
      })
    ).rejects.toMatchObject({
      name: "BadRequestError",
      message: "Proposal does not belong to analyze run"
    });

    await expect(
      service.attachEvidence(project.id, run.id, firstAssembly.id, otherClaim.id, {
        proposalId: proposal.id,
        sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
        symbolName: "attachEvidence",
        startLine: 1,
        endLine: 5,
        provenance: "user",
        confidence: 0.8
      })
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "Analyze review claim not found"
    });

    const evidence = await service.attachEvidence(project.id, run.id, firstAssembly.id, claim.id, {
      proposalId: proposal.id,
      sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
      symbolName: "attachEvidence",
      startLine: 1,
      endLine: 5,
      provenance: "user",
      confidence: 0.8
    });

    expect(evidence.proposalId).toBe(proposal.id);
  });

  it("removes evidence and refreshes validation", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Evidence removal",
      entityType: "use_case",
      entityId: "use-case.evidence-removal",
      filePath: "use-cases/evidence-removal.md",
      summary: "Evidence removal assembly.",
      proposalIds: []
    });
    const claim = await service.createClaim(project.id, run.id, assembly.id, {
      text: "Fact with evidence.",
      kind: "fact",
      confidence: 0.8
    });
    const evidence = await service.attachEvidence(project.id, run.id, assembly.id, claim.id, {
      proposalId: proposal.id,
      sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
      symbolName: "removeEvidence",
      startLine: 1,
      endLine: 5,
      provenance: "user",
      confidence: 0.8
    });

    const updatedClaim = await service.removeEvidence(
      project.id,
      run.id,
      assembly.id,
      claim.id,
      evidence.id
    );
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(updatedClaim.evidence).toEqual([]);
    expect(review.assemblies[0]?.claims[0]?.evidence).toEqual([]);
    expect(review.assemblies[0]?.validation.messages[0]?.code).toBe("fact_missing_evidence");
  });

  it("blocks accepting fact claims without evidence and accepts unrelated ready assemblies", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const blocked = await service.createAssembly(project.id, run.id, {
      title: "Blocked",
      entityType: "use_case",
      entityId: "use-case.blocked",
      filePath: "use-cases/blocked.md",
      summary: "Blocked assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, blocked.id, {
      text: "This fact has no evidence.",
      kind: "fact",
      confidence: 0.5
    });

    const ready = await service.createAssembly(project.id, run.id, {
      title: "Ready",
      entityType: "use_case",
      entityId: "use-case.ready",
      filePath: "use-cases/ready.md",
      summary: "Ready assembly.",
      proposalIds: []
    });
    const claim = await service.createClaim(project.id, run.id, ready.id, {
      text: "This fact has evidence.",
      kind: "fact",
      confidence: 0.9
    });
    await service.attachEvidence(project.id, run.id, ready.id, claim.id, {
      proposalId: proposal.id,
      sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
      symbolName: "acceptAssemblies",
      startLine: 1,
      endLine: 20,
      provenance: "user",
      confidence: 0.9
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [blocked.id, ready.id]
    });

    expect(result.acceptedAssemblyIds).toEqual([ready.id]);
    expect(result.failures[0]?.assemblyId).toBe(blocked.id);
    expect(result.failures[0]?.messages[0]?.code).toBe("fact_missing_evidence");
  });

  it("renders hypotheses under a labeled section when accepted", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Hypothesis",
      entityType: "use_case",
      entityId: "use-case.hypothesis",
      filePath: "use-cases/hypothesis.md",
      summary: "Hypothesis assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "This needs user confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });

    expect(result.acceptedAssemblyIds).toEqual([assembly.id]);
    const review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]?.renderedMarkdown).toContain("## Hypotheses and Unknowns");
  });

  it("does not accept discarded tombstone assemblies", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      proposalIds: [proposal.id]
    });

    await service.removeInput(project.id, run.id, assembly.id, proposal.id);

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(result.acceptedAssemblyIds).toEqual([]);
    expect(result.indexRun).toBeNull();
    expect(result.failures[0]?.assemblyId).toBe(assembly.id);
    expect(result.failures[0]?.messages[0]?.code).toBe("assembly_discarded");
    await expect(
      readFile(path.join(project.specopsPath, "use-cases/review-drafts.md"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(review.assemblies[0]?.status).toBe("discarded");
    expect(review.assemblies[0]?.discardedAt).not.toBeNull();
  });

  it("does not follow dangling symlink targets when accepting assemblies", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "specops-api-review-escape-"));
    tempRoots.push(outsideRoot);
    await mkdir(path.join(project.specopsPath, "use-cases"), { recursive: true });
    const escapedPath = path.join(outsideRoot, "escaped.md");
    await symlink(escapedPath, path.join(project.specopsPath, "use-cases/dangling.md"));

    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Dangling symlink",
      entityType: "use_case",
      entityId: "use-case.dangling-symlink",
      filePath: "use-cases/dangling.md",
      summary: "Dangling symlink assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(result.acceptedAssemblyIds).toEqual([]);
    expect(result.failures[0]?.messages[0]?.code).toBe("target_file_exists");
    await expect(readFile(escapedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(review.assemblies[0]?.status).toBe("draft");
  });

  it("cleans up written markdown when acceptance fails after the file write", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db, {
      acceptTestHooks: {
        beforeStatusUpdate: () => {
          throw new Error("Simulated accept status failure");
        }
      }
    });
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Cleanup",
      entityType: "use_case",
      entityId: "use-case.cleanup",
      filePath: "use-cases/cleanup.md",
      summary: "Cleanup assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    await expect(
      service.acceptAssemblies(project.id, run.id, { assemblyIds: [assembly.id] })
    ).rejects.toThrow("Simulated accept status failure");
    const review = await service.listReviewAssemblies(project.id, run.id);

    await expect(
      readFile(path.join(project.specopsPath, "use-cases/cleanup.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(review.assemblies[0]?.status).toBe("draft");
  });

  it("does not accept assemblies twice", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      proposalIds: [proposal.id]
    });

    const first = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const second = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(first.acceptedAssemblyIds).toEqual([assembly.id]);
    expect(second.acceptedAssemblyIds).toEqual([]);
    expect(second.failures[0]?.messages[0]?.code).toBe("assembly_not_draft");
    expect(review.assemblies[0]?.status).toBe("accepted");
  });

  it("does not write assemblies when attached proposals are no longer pending", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      proposalIds: [proposal.id]
    });
    await db
      .update(aiProposals)
      .set({ status: "accepted", reviewedAt: new Date() })
      .where(eq(aiProposals.id, proposal.id));

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(result.acceptedAssemblyIds).toEqual([]);
    expect(result.failures[0]?.messages[0]?.code).toBe("proposal_not_pending");
    await expect(
      readFile(path.join(project.specopsPath, "use-cases/review-drafts.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(review.assemblies[0]?.status).toBe("draft");
  });

  it("blocks accepting non-indexable file paths", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const textAssembly = await service.createAssembly(project.id, run.id, {
      title: "Text file",
      entityType: "use_case",
      entityId: "use-case.text-file",
      filePath: "use-cases/not-markdown.txt",
      summary: "Text file assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, textAssembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });
    const templateAssembly = await service.createAssembly(project.id, run.id, {
      title: "Template file",
      entityType: "use_case",
      entityId: "use-case.template-file",
      filePath: "use-cases/foo.template.md",
      summary: "Template file assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, templateAssembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [textAssembly.id, templateAssembly.id]
    });

    expect(result.acceptedAssemblyIds).toEqual([]);
    expect(result.failures.map((failure) => failure.messages[0]?.code)).toEqual([
      "file_path_not_markdown",
      "file_path_template"
    ]);
    await expect(
      readFile(path.join(project.specopsPath, "use-cases/not-markdown.txt"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(project.specopsPath, "use-cases/foo.template.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts assemblies by writing markdown and reviewing attached proposals", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Accepted",
      entityType: "use_case",
      entityId: "use-case.accepted",
      filePath: "use-cases/accepted.md",
      summary: "Accepted assembly.",
      proposalIds: [proposal.id]
    });
    const claim = assembly.claims[0]!;

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);
    const [proposalRow] = await db
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, proposal.id))
      .limit(1);
    const writtenMarkdown = await readFile(
      path.join(project.specopsPath, "use-cases/accepted.md"),
      "utf8"
    );

    expect(claim.evidence).not.toEqual([]);
    expect(result).toMatchObject({
      acceptedAssemblyIds: [assembly.id],
      failures: []
    });
    expect(result.indexRun).not.toBeNull();
    expect(review.assemblies[0]).toMatchObject({
      id: assembly.id,
      status: "accepted",
      renderedMarkdown: writtenMarkdown
    });
    expect(review.assemblies[0]?.acceptedAt).not.toBeNull();
    expect(proposalRow).toMatchObject({ status: "accepted" });
    expect(proposalRow?.reviewedAt).not.toBeNull();
  });

  it("creates source spec annotations from accepted claim evidence", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Accepted annotations",
      entityType: "use_case",
      entityId: "use-case.accepted-annotations",
      filePath: "use-cases/accepted-annotations.md",
      summary: "Accepted annotations assembly.",
      proposalIds: [proposal.id]
    });
    const claim = assembly.claims[0]!;
    const evidence = claim.evidence[0]!;

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const annotations = await db
      .select()
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    expect(result.annotationCount).toBeGreaterThan(0);
    expect(annotations).toHaveLength(result.annotationCount);
    expect(annotations[0]).toMatchObject({
      sourceFilePath: evidence.sourceFilePath,
      symbolName: evidence.symbolName,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      entityId: assembly.entityId,
      specFilePath: assembly.filePath,
      claimId: claim.id,
      relationshipType: "implements",
      confidence: evidence.confidence,
      provenance: evidence.provenance,
      status: "stale",
      analyzeRunId: run.id,
      proposalId: proposal.id,
      assemblyId: assembly.id,
      claimEvidenceId: evidence.id
    });
  });

  it("keeps accepted scanner-provenance evidence after the post-accept index", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    await writeRepoFile(
      project.repoPath,
      "apps/web/src/routes/analyze-run-review.tsx",
      "export function ReviewDrafts() {\n  return null;\n}\n"
    );
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Accepted scanner annotations",
      entityType: "use_case",
      entityId: "use-case.accepted-scanner-annotations",
      filePath: "use-cases/accepted-scanner-annotations.md",
      summary: "Accepted scanner annotations assembly.",
      proposalIds: [proposal.id]
    });
    const evidence = assembly.claims[0]!.evidence[0]!;
    await db
      .update(analyzeReviewClaimEvidence)
      .set({ provenance: "scanner" })
      .where(eq(analyzeReviewClaimEvidence.id, evidence.id));

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const annotations = await db
      .select()
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    expect(result.failures).toEqual([]);
    expect(annotations).toContainEqual(
      expect.objectContaining({
        sourceFilePath: evidence.sourceFilePath,
        entityId: assembly.entityId,
        provenance: "scanner",
        claimEvidenceId: evidence.id
      })
    );
  });

  it("does not accept proposals attached only as evidence inputs", async () => {
    const { db, project, run, proposal } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Evidence only",
      entityType: "use_case",
      entityId: "use-case.evidence-only",
      filePath: "use-cases/evidence-only.md",
      summary: "Evidence-only assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });
    await service.attachInput(project.id, run.id, assembly.id, {
      proposalId: proposal.id,
      role: "evidence_only"
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const [proposalRow] = await db
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, proposal.id))
      .limit(1);

    expect(result.acceptedAssemblyIds).toEqual([assembly.id]);
    expect(proposalRow).toMatchObject({ status: "pending", reviewedAt: null });
  });

  it("reports index failures after accepting assemblies without rolling back", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db, {
      acceptTestHooks: {
        indexProject: () => {
          throw new Error("Simulated index failure");
        }
      }
    });
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Index failure",
      entityType: "use_case",
      entityId: "use-case.index-failure",
      filePath: "use-cases/index-failure.md",
      summary: "Index failure assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);
    const writtenMarkdown = await readFile(
      path.join(project.specopsPath, "use-cases/index-failure.md"),
      "utf8"
    );

    expect(result.acceptedAssemblyIds).toEqual([assembly.id]);
    expect(result.indexRun).toBeNull();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.assemblyId).toBe(assembly.id);
    expect(result.failures[0]?.messages[0]?.code).toBe("index_failed");
    expect(result.failures[0]?.messages[0]?.message).toContain("Simulated index failure");
    expect(writtenMarkdown).toContain("# Index failure");
    expect(review.assemblies[0]).toMatchObject({
      id: assembly.id,
      status: "accepted",
      renderedMarkdown: writtenMarkdown
    });
  });

  it("blocks mutating accepted assemblies", async () => {
    const { db, project, run, proposal, proposals } = await createReviewFixture({
      derive: false,
      proposalCount: 2
    });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Immutable",
      entityType: "use_case",
      entityId: "use-case.immutable",
      filePath: "use-cases/immutable.md",
      summary: "Immutable assembly.",
      proposalIds: [proposal.id]
    });
    const claim = assembly.claims[0]!;
    const evidence = claim.evidence[0]!;

    await service.acceptAssemblies(project.id, run.id, { assemblyIds: [assembly.id] });

    await expect(
      service.patchAssembly(project.id, run.id, assembly.id, { title: "Mutated" })
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.attachInput(project.id, run.id, assembly.id, {
        proposalId: proposals[1]!.id,
        role: "supporting"
      })
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.removeInput(project.id, run.id, assembly.id, proposal.id)
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.createClaim(project.id, run.id, assembly.id, {
        text: "Late claim.",
        kind: "hypothesis",
        confidence: 0.1
      })
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.patchClaim(project.id, run.id, assembly.id, claim.id, { text: "Late edit." })
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.attachEvidence(project.id, run.id, assembly.id, claim.id, {
        proposalId: proposal.id,
        sourceFilePath: "apps/api/src/services/analyze-review-assembly-service.ts",
        symbolName: "acceptAssemblies",
        startLine: 1,
        endLine: 20,
        provenance: "user",
        confidence: 0.7
      })
    ).rejects.toMatchObject({ name: "ConflictError" });
    await expect(
      service.removeEvidence(project.id, run.id, assembly.id, claim.id, evidence.id)
    ).rejects.toMatchObject({ name: "ConflictError" });

    const review = await service.listReviewAssemblies(project.id, run.id);
    expect(review.assemblies[0]).toMatchObject({
      id: assembly.id,
      status: "accepted",
      title: "Immutable"
    });
    expect(review.assemblies[0]?.inputs.map((input) => input.proposalId)).toEqual([proposal.id]);
    expect(review.assemblies[0]?.claims).toHaveLength(1);
    expect(review.assemblies[0]?.claims[0]?.text).toBe(claim.text);
    expect(review.assemblies[0]?.claims[0]?.evidence.map((item) => item.id)).toEqual([
      evidence.id
    ]);
  });

  it("accepts the fresh locked assembly state instead of a stale snapshot", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    let service: ReturnType<typeof createAnalyzeReviewAssemblyService>;
    let mutated = false;
    service = createAnalyzeReviewAssemblyService(db, {
      acceptTestHooks: {
        beforeAcceptAssembly: async ({ assemblyId }) => {
          if (mutated) {
            return;
          }
          mutated = true;
          await service.patchAssembly(project.id, run.id, assemblyId, {
            title: "Fresh title",
            summary: "Fresh summary."
          });
        }
      }
    });
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Stale title",
      entityType: "use_case",
      entityId: "use-case.fresh-accept",
      filePath: "use-cases/fresh-accept.md",
      summary: "Stale summary.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Needs confirmation.",
      kind: "hypothesis",
      confidence: 0.2
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const writtenMarkdown = await readFile(
      path.join(project.specopsPath, "use-cases/fresh-accept.md"),
      "utf8"
    );
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(result.acceptedAssemblyIds).toEqual([assembly.id]);
    expect(writtenMarkdown).toContain("# Fresh title");
    expect(writtenMarkdown).toContain("Fresh summary.");
    expect(writtenMarkdown).not.toContain("Stale title");
    expect(review.assemblies[0]).toMatchObject({
      id: assembly.id,
      status: "accepted",
      title: "Fresh title",
      renderedMarkdown: writtenMarkdown
    });
  });

  it("returns validation failures without writing invalid assemblies", async () => {
    const { db, project, run } = await createReviewFixture({ derive: false });
    const service = createAnalyzeReviewAssemblyService(db);
    const assembly = await service.createAssembly(project.id, run.id, {
      title: "Invalid",
      entityType: "use_case",
      entityId: "use-case.invalid",
      filePath: "use-cases/invalid.md",
      summary: "Invalid assembly.",
      proposalIds: []
    });
    await service.createClaim(project.id, run.id, assembly.id, {
      text: "Missing evidence.",
      kind: "fact",
      confidence: 0.6
    });

    const result = await service.acceptAssemblies(project.id, run.id, {
      assemblyIds: [assembly.id]
    });
    const review = await service.listReviewAssemblies(project.id, run.id);

    expect(result.acceptedAssemblyIds).toEqual([]);
    expect(result.indexRun).toBeNull();
    expect(result.failures[0]?.messages[0]?.code).toBe("fact_missing_evidence");
    await expect(
      readFile(path.join(project.specopsPath, "use-cases/invalid.md"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(review.assemblies[0]?.status).toBe("draft");
  });

  async function createReviewFixture(
    options: {
      derive?: boolean;
      claims?: AiSpecEntityProposalEvidence["claims"];
      proposalCount?: number;
    } = {}
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "specops-api-review-assembly-"));
    tempRoots.push(root);

    const project = await createProjectService(db).createProject({
      name: `Review Assembly ${Date.now()} ${Math.random()}`,
      slug: `review-assembly-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      repoPath: root,
      specopsPath: path.join(root, ".specops")
    });
    projectIds.push(project.id);

    const proposalCount = options.proposalCount ?? 1;
    const proposalInputs = Array.from({ length: proposalCount }, (_, index) => {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const entitySuffix = index === 0 ? "" : `-${index + 1}`;
      const payload: AiSpecEntityProposalPayload = {
        entityId: `use-case.review-drafts${entitySuffix}`,
        type: "use_case",
        title: `Review drafts${suffix}`,
        status: "draft",
        filePath: `use-cases/review-drafts${entitySuffix}.md`,
        generatedMarkdown: `---\nid: use-case.review-drafts${entitySuffix}\n---\n\n# Review drafts${suffix}\n`,
        markdown: `---\nid: use-case.review-drafts${entitySuffix}\n---\n\n# Review drafts${suffix}\n`,
        sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"],
        proposedLinks: []
      };
      const evidence: AiSpecEntityProposalEvidence = {
        provider: "ollama",
        model: "gemma4",
        promptVersion: "ai-prefill-v1",
        selectedSourceFiles: [
          {
            file: "apps/web/src/routes/analyze-run-review.tsx",
            contentHash: `review-drafts-hash${entitySuffix}`,
            excerptStartLine: 20,
            excerptEndLine: 80
          }
        ],
        claims: [
          ...(index === 0 && options.claims
            ? options.claims
            : [
                {
                  text: `Users review generated draft inputs before accepting specs${suffix}.`,
                  sourceFiles: ["apps/web/src/routes/analyze-run-review.tsx"]
                }
              ])
        ],
        warnings: []
      };

      return {
        projectId: project.id,
        proposalType: "ai_spec_entity",
        title: payload.title,
        payloadJson: payload,
        evidenceJson: evidence,
        confidence: 0.82,
        status: "pending"
      };
    });

    const proposals = await db
      .insert(aiProposals)
      .values(proposalInputs)
      .returning();
    expect(proposals).toHaveLength(proposalCount);

    const [run] = await db
      .insert(analyzeRuns)
      .values({
        projectId: project.id,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: proposals.map((proposal) => proposal.id),
        aiProposalCount: proposals.length
      })
      .returning();
    expect(run).toBeDefined();

    return { db, project, run: run!, proposal: proposals[0]!, proposals };
  }
});

async function writeRepoFile(repoPath: string, relativePath: string, content: string): Promise<string> {
  const absolutePath = path.join(repoPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return sha256(content);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"), "utf8")
    );
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function closeDb(db: Db | undefined): Promise<void> {
  const client = (db as unknown as { $client?: { end: () => Promise<void> } } | undefined)?.$client;
  await client?.end();
}

function readTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.CI) {
    throw new Error("TEST_DATABASE_URL is required for DB-backed API tests in CI");
  }

  if (url) {
    assertSafeTestDatabaseUrl(url);
  }

  return url;
}

function assertSafeTestDatabaseUrl(connectionString: string) {
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "");

  if (!databaseName.includes("test") && !databaseName.includes("specops_test")) {
    throw new Error(
      `Refusing to run DB-backed API tests against non-test database "${databaseName}"`
    );
  }
}
