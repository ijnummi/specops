import { describe, expect, it } from "vitest";

import { renderAiSpecEntityProposal } from "../render.js";
import type { AiPrefillCandidate, AiPrefillPromptPacket } from "../types.js";

describe("renderAiSpecEntityProposal", () => {
  it("returns deterministic proposal data and markdown for use case candidates", () => {
    const proposal = renderAiSpecEntityProposal({
      candidate: candidate(),
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      packet: promptPacket(),
      warnings: ["Rejected proposal 2: invalid shape"]
    });

    expect(proposal.proposalType).toBe("ai_spec_entity");
    expect(proposal.title).toBe("Manage projects");
    expect(proposal.confidence).toBe(0.82);
    expect(proposal.payload).toMatchObject({
      entityId: "uc.manage-projects",
      type: "use_case",
      title: "Manage projects",
      status: "draft",
      filePath: "use-cases/uc.manage-projects.md",
      sourceFiles: ["apps/api/src/routes/projects.ts"],
      proposedLinks: [
        {
          linkType: "implemented_by",
          targetEntityId: "interface.project-service",
          targetExists: true,
          rationale: "Project service handles persistence."
        },
        {
          linkType: "relates_to",
          targetEntityId: "domain.project",
          targetExists: true,
          rationale: "The use case manages projects."
        }
      ]
    });
    expect(proposal.payload.markdown).toBe(proposal.payload.generatedMarkdown);
    expect(proposal.evidence).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      promptVersion: "ai-prefill-v1",
      selectedSourceFiles: [
        {
          file: "apps/api/src/routes/projects.ts",
          contentHash: "hash-source-file-1",
          excerptStartLine: 10,
          excerptEndLine: 80
        }
      ],
      claims: [
        {
          text: "The route lists project records for authenticated users.",
          sourceFiles: ["apps/api/src/routes/projects.ts"]
        },
        {
          text: "Project mutations flow through the project service.",
          sourceFiles: ["apps/api/src/routes/projects.ts"]
        }
      ],
      warnings: ["Rejected proposal 2: invalid shape"]
    });

    expect(proposal.payload.generatedMarkdown).toContain("---\n");
    expect(proposal.payload.generatedMarkdown).toContain("id: uc.manage-projects\n");
    expect(proposal.payload.generatedMarkdown).toContain("type: use_case\n");
    expect(proposal.payload.generatedMarkdown).toContain("title: Manage projects\n");
    expect(proposal.payload.generatedMarkdown).toContain("status: draft\n");
    expect(proposal.payload.generatedMarkdown).toContain("source_files:\n  - apps/api/src/routes/projects.ts\n");
    expect(proposal.payload.generatedMarkdown).toContain("links:\n  implemented_by:\n    - interface.project-service\n");
    expect(proposal.payload.generatedMarkdown).toContain("  relates_to:\n    - domain.project\n");
    expect(proposal.payload.generatedMarkdown).toContain("# Manage projects");
    expect(proposal.payload.generatedMarkdown).toContain("## Source Evidence");
    expect(proposal.payload.generatedMarkdown).toContain(
      "- The route lists project records for authenticated users. (apps/api/src/routes/projects.ts)"
    );
    expect(proposal.payload.generatedMarkdown).toContain("## Proposed Links");
    expect(proposal.payload.generatedMarkdown).toContain(
      "- implemented_by -> interface.project-service: Project service handles persistence."
    );
  });
});

function candidate(): AiPrefillCandidate {
  return {
    entityId: "uc.manage-projects",
    type: "use_case",
    title: "Manage projects",
    summary: "Users can create, list, and update projects.",
    sourceFiles: ["apps/api/src/routes/projects.ts"],
    claims: [
      {
        text: "The route lists project records for authenticated users.",
        sourceFiles: ["apps/api/src/routes/projects.ts"]
      },
      {
        text: "Project mutations flow through the project service.",
        sourceFiles: ["apps/api/src/routes/projects.ts"]
      }
    ],
    proposedLinks: [
      {
        linkType: "relates_to",
        targetEntityId: "domain.project",
        targetExists: true,
        rationale: "The use case manages projects."
      },
      {
        linkType: "implemented_by",
        targetEntityId: "interface.project-service",
        targetExists: true,
        rationale: "Project service handles persistence."
      }
    ],
    confidence: 0.82
  };
}

function promptPacket(): AiPrefillPromptPacket {
  return {
    promptVersion: "ai-prefill-v1",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" }
    ],
    selectedSourceFiles: [
      {
        file: "apps/api/src/routes/projects.ts",
        contentHash: "hash-source-file-1",
        excerptStartLine: 10,
        excerptEndLine: 80
      }
    ]
  };
}
