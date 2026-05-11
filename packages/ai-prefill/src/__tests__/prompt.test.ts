import { describe, expect, it } from "vitest";

import { buildAiPrefillPromptPacket } from "../prompt.js";
import type { AiPrefillSourceFile } from "../types.js";

describe("buildAiPrefillPromptPacket", () => {
  it("includes selected source files, existing entity summaries, and allowed types", () => {
    const packet = buildAiPrefillPromptPacket({
      project: { id: "project-1", name: "SpecOps" },
      allowedEntityTypes: ["use_case", "domain_entity", "interface"],
      allowedLinkTypes: ["depends_on", "implemented_by"],
      existingEntities: [
        { entityId: "interface.project-service", type: "interface", title: "Project service" }
      ],
      selectedFiles: [
        sourceFile({
          id: "source-file-1",
          path: "apps/api/src/routes/projects.ts",
          text: "export async function listProjects() {\n  return [];\n}\n"
        })
      ],
      limits: { maxFiles: 5, maxTotalBytes: 20_000 }
    });

    expect(packet.promptVersion).toBe("ai-prefill-v1");
    expect(packet.messages).toHaveLength(2);
    expect(packet.messages[0]).toMatchObject({ role: "system" });
    expect(packet.messages[0]?.content).toContain("strict JSON only");
    expect(packet.messages[0]?.content).toContain("Do not write files");
    expect(packet.selectedSourceFiles).toEqual([
      {
        file: "apps/api/src/routes/projects.ts",
        contentHash: "hash-source-file-1",
        excerptStartLine: 10,
        excerptEndLine: 12
      }
    ]);

    const userPayload = JSON.parse(packet.messages[1]?.content ?? "");
    expect(userPayload.allowedEntityTypes).toEqual([
      "use_case",
      "domain_entity",
      "interface"
    ]);
    expect(userPayload.allowedLinkTypes).toEqual(["depends_on", "implemented_by"]);
    expect(userPayload.existingEntities).toEqual([
      {
        entityId: "interface.project-service",
        type: "interface",
        title: "Project service"
      }
    ]);
    expect(userPayload.selectedFiles[0]).toMatchObject({
      path: "apps/api/src/routes/projects.ts",
      contentHash: "hash-source-file-1",
      startLine: 10,
      endLine: 12,
      text: "export async function listProjects() {\n  return [];\n}\n"
    });
    expect(userPayload.responseSchema.proposals[0]).toMatchObject({
      entityId: "use-case.short-id",
      type: "use_case",
      title: "Short proposal title"
    });
  });

  it("rejects empty selections before provider calls", () => {
    expect(() =>
      buildAiPrefillPromptPacket({
        project: { id: "project-1", name: "SpecOps" },
        allowedEntityTypes: ["use_case"],
        allowedLinkTypes: [],
        existingEntities: [],
        selectedFiles: [],
        limits: { maxFiles: 5, maxTotalBytes: 20_000 }
      })
    ).toThrow("Select at least one source file for AI Prefill");
  });

  it("rejects selected source file counts beyond the limit before provider calls", () => {
    expect(() =>
      buildAiPrefillPromptPacket({
        project: { id: "project-1", name: "SpecOps" },
        allowedEntityTypes: ["use_case"],
        allowedLinkTypes: [],
        existingEntities: [],
        selectedFiles: [
          sourceFile({ id: "source-file-1", path: "one.ts", text: "one" }),
          sourceFile({ id: "source-file-2", path: "two.ts", text: "two" })
        ],
        limits: { maxFiles: 1, maxTotalBytes: 20_000 }
      })
    ).toThrow("Selected source file count exceeds AI Prefill limit");
  });

  it("rejects selected source content bytes beyond the limit before provider calls", () => {
    expect(() =>
      buildAiPrefillPromptPacket({
        project: { id: "project-1", name: "SpecOps" },
        allowedEntityTypes: ["use_case"],
        allowedLinkTypes: [],
        existingEntities: [],
        selectedFiles: [sourceFile({ id: "source-file-1", path: "one.ts", text: "abcdef" })],
        limits: { maxFiles: 5, maxTotalBytes: 5 }
      })
    ).toThrow("Selected source content exceeds AI Prefill limit");
  });
});

function sourceFile(input: { id: string; path: string; text: string }): AiPrefillSourceFile {
  return {
    id: input.id,
    path: input.path,
    contentHash: `hash-${input.id}`,
    language: "typescript",
    kind: "source",
    text: input.text,
    startLine: 10,
    endLine: 12,
    imports: [
      {
        specifier: "./repo.js",
        importKind: "value",
        importedNames: ["repo"],
        resolvedPath: "apps/api/src/repo.ts"
      }
    ],
    exports: [
      {
        exportedName: "listProjects",
        exportKind: "function",
        sourceSpecifier: null
      }
    ],
    symbols: [
      {
        name: "listProjects",
        symbolKind: "function",
        isExported: true,
        line: 10
      }
    ]
  };
}
