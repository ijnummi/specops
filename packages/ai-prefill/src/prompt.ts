import { Buffer } from "node:buffer";

import type {
  AiPrefillPromptPacket,
  BuildAiPrefillPromptPacketInput
} from "./types.js";

export function buildAiPrefillPromptPacket(
  input: BuildAiPrefillPromptPacketInput
): AiPrefillPromptPacket {
  if (input.selectedFiles.length === 0) {
    throw new Error("Select at least one source file for AI Prefill");
  }

  if (input.selectedFiles.length > input.limits.maxFiles) {
    throw new Error("Selected source file count exceeds AI Prefill limit");
  }

  const totalBytes = input.selectedFiles.reduce(
    (sum, file) => sum + Buffer.byteLength(file.text),
    0
  );
  if (totalBytes > input.limits.maxTotalBytes) {
    throw new Error("Selected source content exceeds AI Prefill limit");
  }

  const selectedSourceFiles = input.selectedFiles.map((file) => ({
    file: file.path,
    contentHash: file.contentHash,
    excerptStartLine: file.startLine,
    excerptEndLine: file.endLine
  }));

  return {
    promptVersion: "ai-prefill-v1",
    messages: [
      {
        role: "system",
        content: [
          "You are SpecOps AI Prefill.",
          "Return strict JSON only and no markdown fences.",
          "Do not write files or claim changes were made directly.",
          "Only cite selected source file paths as evidence.",
          "Prefer fewer high-confidence proposals over broad speculation."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            project: input.project,
            allowedEntityTypes: input.allowedEntityTypes,
            allowedLinkTypes: input.allowedLinkTypes,
            existingEntities: input.existingEntities,
            selectedFiles: input.selectedFiles.map((file) => ({
              id: file.id,
              path: file.path,
              contentHash: file.contentHash,
              language: file.language,
              kind: file.kind,
              startLine: file.startLine,
              endLine: file.endLine,
              imports: file.imports,
              exports: file.exports,
              symbols: file.symbols,
              text: file.text
            })),
            responseSchema: {
              proposals: [
                {
                  entityId: "uc.short-id",
                  type: "use_case",
                  title: "Short proposal title",
                  summary: "Concise behavior summary.",
                  sourceFiles: ["path/to/source.ts"],
                  claims: [
                    {
                      text: "Evidence-backed claim.",
                      sourceFiles: ["path/to/source.ts"]
                    }
                  ],
                  proposedLinks: [
                    {
                      linkType: "implemented_by",
                      targetEntityId: "interface.existing-target",
                      rationale: "Why this link is proposed."
                    }
                  ],
                  confidence: 0.8
                }
              ]
            }
          },
          null,
          2
        )
      }
    ],
    selectedSourceFiles
  };
}
