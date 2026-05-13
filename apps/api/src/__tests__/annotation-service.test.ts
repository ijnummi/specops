import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sourceSpecAnnotationSchema } from "@specops/contracts";
import type { Db } from "@specops/db";
import {
  aiProposals,
  analyzeReviewAssemblies,
  analyzeReviewClaimEvidence,
  analyzeReviewClaims,
  analyzeRuns,
  createDb,
  indexRuns,
  projects,
  sourceFiles,
  sourceSpecAnnotations,
  specEntities
} from "@specops/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createAnnotationService,
  type AcceptedEvidenceAnnotationInput,
  type ScannerAnnotationInput
} from "../services/annotation-service.js";

const testDatabaseUrl = readTestDatabaseUrl();
const describeWithDb = testDatabaseUrl ? describe : describe.skip;
const { Pool } = pg;

describeWithDb("createAnnotationService", () => {
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

  it("creates and lists a user annotation scoped to one project", async () => {
    const first = await createProjectFixture("first");
    const second = await createProjectFixture("second");
    const firstSource = await createSourceFileFixture(first.id, "src/decision.ts", "export const decision = true;\n");
    const secondSource = await createSourceFileFixture(second.id, "src/decision.ts", "export const other = true;\n");
    await createSpecEntityFixture(first.id, "domain.decision", "specs/decision.md");
    await createSpecEntityFixture(second.id, "domain.decision", "specs/decision.md");

    const service = createAnnotationService(db);
    const created = await service.createUserAnnotation(first.id, {
      sourceFileId: firstSource.id,
      entityId: "domain.decision",
      relationshipType: "implements",
      symbolName: "DecisionService",
      symbolKind: "class",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });
    await service.createUserAnnotation(second.id, {
      sourceFileId: secondSource.id,
      entityId: "domain.decision",
      relationshipType: "uses",
      symbolName: "OtherService",
      symbolKind: "class",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });

    expect(sourceSpecAnnotationSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      projectId: first.id,
      sourceFileId: firstSource.id,
      sourceFilePath: "src/decision.ts",
      sourceContentHash: firstSource.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "implements",
      provenance: "user",
      status: "active"
    });

    const annotations = await service.listAnnotations(first.id, { includeExcerpt: false });

    expect(annotations).toEqual([
      expect.objectContaining({
        id: created.id,
        projectId: first.id,
        sourceFilePath: "src/decision.ts",
        symbolName: "DecisionService",
        relationshipType: "implements"
      })
    ]);
  });

  it("deduplicates active scanner annotations", async () => {
    const project = await createProjectFixture("scanner");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const indexRunId = await createIndexRunFixture(project.id);
    const scannerAnnotation: ScannerAnnotationInput = {
      sourceFileId: source.id,
      sourceFilePath: source.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: source.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1
    };

    const service = createAnnotationService(db);
    await service.replaceScannerAnnotations(project.id, indexRunId, [
      scannerAnnotation,
      scannerAnnotation
    ]);
    await service.replaceScannerAnnotations(project.id, indexRunId, [
      scannerAnnotation,
      scannerAnnotation
    ]);

    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      status: "active",
      includeExcerpt: false
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      projectId: project.id,
      sourceFileId: source.id,
      sourceFilePath: "src/decision.ts",
      entityId: "domain.decision",
      relationshipType: "references",
      provenance: "scanner",
      indexRunId
    });
  });

  it("removes omitted active scanner-ingested annotations during replacement", async () => {
    const project = await createProjectFixture("scanner-replace");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const firstIndexRunId = await createIndexRunFixture(project.id);
    const secondIndexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);
    const scannerAnnotation: ScannerAnnotationInput = {
      sourceFileId: source.id,
      sourceFilePath: source.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: source.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1
    };

    await service.replaceScannerAnnotations(project.id, firstIndexRunId, [scannerAnnotation]);
    await service.replaceScannerAnnotations(project.id, secondIndexRunId, []);

    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      includeExcerpt: false
    });
    expect(annotations).toEqual([]);
  });

  it("validates scanner batch source and entity ownership while accepting null source file ids", async () => {
    const first = await createProjectFixture("scanner-owned");
    const second = await createProjectFixture("scanner-other");
    const firstSource = await createSourceFileFixture(first.id, "src/decision.ts", "export interface Decision {}\n");
    const secondSource = await createSourceFileFixture(second.id, "src/other.ts", "export interface Other {}\n");
    await createSpecEntityFixture(first.id, "domain.decision", "specs/decision.md");
    await createSpecEntityFixture(second.id, "domain.other", "specs/other.md");
    const indexRunId = await createIndexRunFixture(first.id);
    const service = createAnnotationService(db);
    const validAnnotation: ScannerAnnotationInput = {
      sourceFileId: null,
      sourceFilePath: firstSource.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: firstSource.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1
    };

    await expect(
      service.replaceScannerAnnotations(first.id, indexRunId, [
        { ...validAnnotation, sourceFileId: secondSource.id }
      ])
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Source file not found"
    });
    await expect(
      service.replaceScannerAnnotations(first.id, indexRunId, [
        { ...validAnnotation, entityId: "domain.other" }
      ])
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Spec entity not found"
    });

    await service.replaceScannerAnnotations(first.id, indexRunId, [validAnnotation]);

    const annotations = await service.listAnnotations(first.id, {
      provenance: "scanner",
      status: "active",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFileId: null,
        entityId: "domain.decision"
      })
    ]);
  });

  it("marks generated active annotations stale when the current source hash differs", async () => {
    const project = await createProjectFixture("stale-hash");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const indexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);

    await service.replaceScannerAnnotations(project.id, indexRunId, [
      {
        sourceFileId: source.id,
        sourceFilePath: source.path,
        symbolName: "Decision",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: source.contentHash,
        entityId: "domain.decision",
        specFilePath: "specs/decision.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    const staleCount = await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[source.path, sha256("export interface Decision { id: string }\n")]])
    });

    expect(staleCount).toBe(1);
    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFilePath: source.path,
        sourceContentHash: source.contentHash,
        status: "stale"
      })
    ]);
  });

  it("marks generated active annotations stale when the source path is missing from current hashes", async () => {
    const project = await createProjectFixture("stale-missing");
    const source = await createSourceFileFixture(project.id, "src/missing.ts", "export interface Missing {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const indexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);

    await service.replaceScannerAnnotations(project.id, indexRunId, [
      {
        sourceFileId: source.id,
        sourceFilePath: source.path,
        symbolName: "Missing",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: source.contentHash,
        entityId: "domain.decision",
        specFilePath: "specs/decision.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    const staleCount = await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([["src/other.ts", sha256("export interface Other {}\n")]])
    });

    expect(staleCount).toBe(1);
    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFilePath: source.path,
        status: "stale"
      })
    ]);
  });

  it("does not mark user annotations stale from scan hashes", async () => {
    const project = await createProjectFixture("stale-user");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const service = createAnnotationService(db);

    await service.createUserAnnotation(project.id, {
      sourceFileId: source.id,
      entityId: "domain.decision",
      relationshipType: "implements",
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });

    const staleCount = await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[source.path, sha256("export interface Decision { id: string }\n")]])
    });

    expect(staleCount).toBe(0);
    const annotations = await service.listAnnotations(project.id, {
      provenance: "user",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFilePath: source.path,
        status: "active"
      })
    ]);
  });

  it("keeps generated annotations with null source hashes active when the source path still exists", async () => {
    const project = await createProjectFixture("stale-null-hash");
    await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const indexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);

    await service.replaceScannerAnnotations(project.id, indexRunId, [
      {
        sourceFileId: null,
        sourceFilePath: "src/decision.ts",
        symbolName: "Decision",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: null,
        entityId: "domain.decision",
        specFilePath: "specs/decision.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    const staleCount = await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([["src/decision.ts", sha256("export interface Decision { id: string }\n")]])
    });

    expect(staleCount).toBe(0);
    const [annotation] = await db
      .select()
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    expect(annotation).toMatchObject({
      sourceFilePath: "src/decision.ts",
      sourceContentHash: null,
      status: "active"
    });
  });

  it("preserves stale scanner annotations when replacing current scanner annotations", async () => {
    const project = await createProjectFixture("stale-scanner-preserved");
    const oldSource = await createSourceFileFixture(project.id, "src/old.ts", "export interface Old {}\n");
    const currentSource = await createSourceFileFixture(project.id, "src/current.ts", "export interface Current {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const firstIndexRunId = await createIndexRunFixture(project.id);
    const secondIndexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);

    await service.replaceScannerAnnotations(project.id, firstIndexRunId, [
      {
        sourceFileId: oldSource.id,
        sourceFilePath: oldSource.path,
        symbolName: "Old",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: oldSource.contentHash,
        entityId: "domain.decision",
        specFilePath: "specs/decision.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);
    await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[currentSource.path, currentSource.contentHash]])
    });

    await service.replaceScannerAnnotations(project.id, secondIndexRunId, [
      {
        sourceFileId: currentSource.id,
        sourceFilePath: currentSource.path,
        symbolName: "Current",
        symbolKind: "interface",
        startLine: 1,
        endLine: 1,
        annotationLine: 1,
        sourceContentHash: currentSource.contentHash,
        entityId: "domain.decision",
        specFilePath: "specs/decision.md",
        relationshipType: "references",
        confidence: 1
      }
    ]);

    const annotations = await service.listAnnotations(project.id, {
      provenance: "scanner",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFilePath: currentSource.path,
        status: "active",
        indexRunId: secondIndexRunId
      }),
      expect.objectContaining({
        sourceFilePath: oldSource.path,
        status: "stale",
        indexRunId: firstIndexRunId
      })
    ]);
  });

  it("deduplicates stale scanner annotations for the same logical key across repeated scans", async () => {
    const project = await createProjectFixture("stale-scanner-dedupe");
    const source = await createSourceFileFixture(project.id, "src/decision.ts", "export interface Decision {}\n");
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");
    const firstIndexRunId = await createIndexRunFixture(project.id);
    const secondIndexRunId = await createIndexRunFixture(project.id);
    const thirdIndexRunId = await createIndexRunFixture(project.id);
    const service = createAnnotationService(db);
    const firstHash = source.contentHash;
    const secondHash = sha256("export interface Decision { second: true }\n");
    const thirdHash = sha256("export interface Decision { third: true }\n");
    const scannerAnnotation: ScannerAnnotationInput = {
      sourceFileId: source.id,
      sourceFilePath: source.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: firstHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1
    };

    await service.createUserAnnotation(project.id, {
      sourceFileId: source.id,
      entityId: "domain.decision",
      relationshipType: "references",
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      claimId: null,
      confidence: 1
    });
    await db.insert(sourceSpecAnnotations).values({
      projectId: project.id,
      sourceFileId: source.id,
      sourceFilePath: source.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: firstHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1,
      provenance: "ai",
      status: "stale"
    });

    await service.replaceScannerAnnotations(project.id, firstIndexRunId, [scannerAnnotation]);
    await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[source.path, secondHash]])
    });
    await service.replaceScannerAnnotations(project.id, secondIndexRunId, [
      { ...scannerAnnotation, sourceContentHash: secondHash }
    ]);
    await service.markStaleAnnotations(project.id, {
      currentSourceHashes: new Map([[source.path, thirdHash]])
    });
    await service.replaceScannerAnnotations(project.id, thirdIndexRunId, [
      { ...scannerAnnotation, sourceContentHash: thirdHash }
    ]);

    const annotations = await db
      .select({
        provenance: sourceSpecAnnotations.provenance,
        status: sourceSpecAnnotations.status,
        sourceContentHash: sourceSpecAnnotations.sourceContentHash,
        indexRunId: sourceSpecAnnotations.indexRunId
      })
      .from(sourceSpecAnnotations)
      .where(eq(sourceSpecAnnotations.projectId, project.id));

    const scannerRows = annotations
      .filter((annotation) => annotation.provenance === "scanner")
      .sort((left, right) => right.status.localeCompare(left.status));

    expect(scannerRows).toEqual([
      {
        provenance: "scanner",
        status: "stale",
        sourceContentHash: secondHash,
        indexRunId: secondIndexRunId
      },
      {
        provenance: "scanner",
        status: "active",
        sourceContentHash: thirdHash,
        indexRunId: thirdIndexRunId
      }
    ]);
    expect(annotations.filter((annotation) => annotation.provenance === "user")).toHaveLength(1);
    expect(annotations.filter((annotation) => annotation.provenance === "ai")).toHaveLength(1);
  });

  it("validates accepted evidence ownership and origin metadata", async () => {
    const first = await createProjectFixture("evidence-owned");
    const second = await createProjectFixture("evidence-other");
    const firstSource = await createSourceFileFixture(first.id, "src/decision.ts", "export interface Decision {}\n");
    const secondSource = await createSourceFileFixture(second.id, "src/other.ts", "export interface Other {}\n");
    await createSpecEntityFixture(first.id, "domain.decision", "specs/decision.md");
    await createSpecEntityFixture(second.id, "domain.other", "specs/other.md");
    const origin = await createEvidenceOriginFixture(first.id);
    const service = createAnnotationService(db);
    const validAnnotation: AcceptedEvidenceAnnotationInput = {
      sourceFileId: null,
      sourceFilePath: firstSource.path,
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 1,
      endLine: 1,
      annotationLine: 1,
      sourceContentHash: firstSource.contentHash,
      entityId: "domain.decision",
      specFilePath: "specs/decision.md",
      relationshipType: "references",
      confidence: 1,
      provenance: "ai",
      analyzeRunId: origin.analyzeRunId,
      assemblyId: origin.assemblyId,
      claimEvidenceId: origin.claimEvidenceId,
      proposalId: origin.proposalId
    };

    await expect(
      service.createAcceptedEvidenceAnnotations(first.id, [
        { ...validAnnotation, sourceFileId: secondSource.id }
      ])
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Source file not found"
    });
    await expect(
      service.createAcceptedEvidenceAnnotations(first.id, [
        { ...validAnnotation, entityId: "domain.other" }
      ])
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Spec entity not found"
    });
    await expect(
      service.createAcceptedEvidenceAnnotations(first.id, [
        { ...validAnnotation, analyzeRunId: null } as unknown as AcceptedEvidenceAnnotationInput
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Accepted evidence annotation is missing origin metadata"
    });
    await expect(
      service.createAcceptedEvidenceAnnotations(first.id, [
        { ...validAnnotation, provenance: "manual" } as unknown as AcceptedEvidenceAnnotationInput
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Accepted evidence annotation has invalid provenance"
    });

    const count = await service.createAcceptedEvidenceAnnotations(first.id, [validAnnotation]);

    expect(count).toBe(1);
    const annotations = await service.listAnnotations(first.id, {
      provenance: "ai",
      status: "active",
      includeExcerpt: false
    });
    expect(annotations).toEqual([
      expect.objectContaining({
        sourceFileId: firstSource.id,
        sourceContentHash: firstSource.contentHash,
        entityId: "domain.decision",
        analyzeRunId: origin.analyzeRunId,
        assemblyId: origin.assemblyId,
        claimEvidenceId: origin.claimEvidenceId
      })
    ]);
  });

  it("returns source excerpts when requested", async () => {
    const project = await createProjectFixture("excerpt");
    const content =
      "const first = true;\n" +
      "/** @specops domain.decision */\n" +
      "export interface Decision { id: string }\n";
    const source = await createSourceFileFixture(project.id, "src/decision.ts", content);
    await createSpecEntityFixture(project.id, "domain.decision", "specs/decision.md");

    const service = createAnnotationService(db);
    await service.createUserAnnotation(project.id, {
      sourceFileId: source.id,
      entityId: "domain.decision",
      relationshipType: "implements",
      symbolName: "Decision",
      symbolKind: "interface",
      startLine: 3,
      endLine: 3,
      annotationLine: 2,
      claimId: null,
      confidence: 1
    });

    const annotations = await service.listAnnotations(project.id, {
      includeExcerpt: true
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.excerpt).toEqual({
      status: "available",
      startLine: 1,
      endLine: 3,
      text: content.replace(/\n$/, "")
    });
  });

  async function createProjectFixture(name: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), `specops-annotation-${name}-`));
    tempRoots.push(root);
    const specopsPath = path.join(root, ".specops");
    await mkdir(specopsPath, { recursive: true });
    const [project] = await db
      .insert(projects)
      .values({
        name: `Annotation ${name} ${Date.now()} ${Math.random()}`,
        slug: `annotation-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        repoPath: root,
        specopsPath
      })
      .returning();

    expect(project).toBeDefined();
    projectIds.push(project!.id);
    return project!;
  }

  async function createSourceFileFixture(projectId: string, filePath: string, content: string) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId)
    });
    expect(project).toBeDefined();
    const absolutePath = path.join(project!.repoPath, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { flag: "w" });
    const [sourceFile] = await db
      .insert(sourceFiles)
      .values({
        projectId,
        path: filePath,
        language: "typescript",
        kind: "source",
        sizeBytes: Buffer.byteLength(content),
        contentHash: sha256(content)
      })
      .returning();

    expect(sourceFile).toBeDefined();
    return sourceFile!;
  }

  async function createSpecEntityFixture(projectId: string, entityId: string, filePath: string) {
    const [entity] = await db
      .insert(specEntities)
      .values({
        projectId,
        entityId,
        type: "domain_entity",
        title: entityId,
        status: "draft",
        filePath,
        bodyMarkdown: `# ${entityId}\n`,
        bodyText: entityId,
        contentHash: sha256(`${projectId}:${entityId}`)
      })
      .returning();

    expect(entity).toBeDefined();
    return entity!;
  }

  async function createIndexRunFixture(projectId: string): Promise<string> {
    const [indexRun] = await db
      .insert(indexRuns)
      .values({
        projectId,
        status: "succeeded"
      })
      .returning({ id: indexRuns.id });

    expect(indexRun).toBeDefined();
    return indexRun!.id;
  }

  async function createEvidenceOriginFixture(projectId: string) {
    const [indexRun] = await db
      .insert(indexRuns)
      .values({ projectId, status: "succeeded" })
      .returning({ id: indexRuns.id });
    expect(indexRun).toBeDefined();
    const [analyzeRun] = await db
      .insert(analyzeRuns)
      .values({
        projectId,
        status: "succeeded",
        stepsJson: [],
        proposalIdsJson: [],
        indexRunId: indexRun!.id
      })
      .returning({ id: analyzeRuns.id });
    expect(analyzeRun).toBeDefined();
    const [proposal] = await db
      .insert(aiProposals)
      .values({
        projectId,
        proposalType: "source_spec_entity",
        title: "Decision",
        payloadJson: {},
        evidenceJson: {},
        status: "accepted",
        confidence: 1
      })
      .returning({ id: aiProposals.id });
    expect(proposal).toBeDefined();
    const [assembly] = await db
      .insert(analyzeReviewAssemblies)
      .values({
        projectId,
        analyzeRunId: analyzeRun!.id,
        status: "accepted",
        entityType: "domain_entity",
        entityId: "domain.decision",
        title: "Decision",
        summary: "",
        filePath: "specs/decision.md"
      })
      .returning({ id: analyzeReviewAssemblies.id });
    expect(assembly).toBeDefined();
    const [claim] = await db
      .insert(analyzeReviewClaims)
      .values({
        projectId,
        assemblyId: assembly!.id,
        text: "Decision evidence",
        kind: "fact",
        confidence: 1,
        sortOrder: 0
      })
      .returning({ id: analyzeReviewClaims.id });
    expect(claim).toBeDefined();
    const [claimEvidence] = await db
      .insert(analyzeReviewClaimEvidence)
      .values({
        projectId,
        claimId: claim!.id,
        proposalId: proposal!.id,
        sourceFilePath: "src/decision.ts",
        symbolName: "Decision",
        startLine: 1,
        endLine: 1,
        provenance: "ai",
        confidence: 1
      })
      .returning({ id: analyzeReviewClaimEvidence.id });
    expect(claimEvidence).toBeDefined();

    return {
      analyzeRunId: analyzeRun!.id,
      assemblyId: assembly!.id,
      claimEvidenceId: claimEvidence!.id,
      proposalId: proposal!.id
    };
  }
});

async function migrateTestDatabase(connectionString: string) {
  const client = new Pool({ connectionString });
  try {
    const sql = await readFile(
      path.join(process.cwd(), "../../packages/db/migrations/0000_initial.sql"),
      "utf8"
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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
