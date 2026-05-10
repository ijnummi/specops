import type {
  EntityImpactResponseDto,
  ImpactEntitySummaryDto,
  ValidationMessageDto
} from "@specops/contracts";
import { describe, expect, it } from "vitest";

import { buildChangeImpactPreview } from "../services/change-impact-preview-service.js";

describe("buildChangeImpactPreview", () => {
  it("composes a deterministic preview from impact, validation, source, and task links", () => {
    const preview = buildChangeImpactPreview({
      impact: impactResponse(),
      validationMessages: [
        validationMessage({
          id: "validation-unrelated-file",
          filePath: "src/unrelated.ts",
          entityId: null,
          level: "error",
          code: "unrelated_file",
          message: "Unrelated source file"
        }),
        validationMessage({
          id: "validation-source",
          filePath: "src/domain.ts",
          entityId: null,
          level: "warning",
          code: "source_spec_missing_entity",
          message: "Source annotation points to a missing spec entity"
        }),
        validationMessage({
          id: "validation-link",
          filePath: "specops/domain/decision.md",
          entityId: "domain.policy",
          level: "error",
          code: "missing_link",
          message: "Policy is missing a link"
        }),
        validationMessage({
          id: "validation-unrelated-entity",
          filePath: "specops/domain/unrelated.md",
          entityId: "domain.unrelated",
          level: "warning",
          code: "unrelated_entity",
          message: "Unrelated spec entity"
        })
      ],
      relatedTaskLinks: [
        {
          fromEntityId: "task.domain-decision",
          toEntityId: "domain.outcome",
          linkType: "uses"
        },
        {
          fromEntityId: "task.domain-decision",
          toEntityId: "domain.decision",
          linkType: "generated_from"
        },
        {
          fromEntityId: "task.domain-decision",
          toEntityId: "domain.decision",
          linkType: "generated_from"
        },
        {
          fromEntityId: "task.unrelated",
          toEntityId: "domain.unrelated",
          linkType: "uses"
        }
      ],
      taskEntities: [
        entity("task.unrelated", "Unrelated task", "agent_task"),
        entity("task.domain-decision", "Update decision task", "agent_task")
      ],
      sectionWarnings: []
    });

    expect(preview.overview).toMatchObject({
      impactedSpecCount: 3,
      upstreamSpecCount: 1,
      downstreamSpecCount: 1,
      sourceFileCount: 1,
      sourceSymbolCount: 1,
      warningCount: 2,
      relatedTaskCount: 1
    });
    expect(preview.impactedSpecs.map((group) => `${group.direction}:${group.type}`)).toEqual([
      "root:domain_entity",
      "upstream:domain_entity",
      "downstream:domain_entity"
    ]);
    expect(preview.sourceGroups).toEqual([
      {
        filePath: "src/domain.ts",
        symbols: [
          {
            entityId: "domain.decision",
            filePath: "src/domain.ts",
            sourceFileId: "source-domain",
            symbolName: "Decision",
            symbolKind: "interface",
            symbolLine: 12,
            annotationLine: 11
          }
        ]
      }
    ]);
    expect(preview.validationMessages.map((message) => message.code)).toEqual([
      "missing_link",
      "source_spec_missing_entity"
    ]);
    expect(preview.relatedTasks).toEqual([
      {
        ...entity("task.domain-decision", "Update decision task", "agent_task"),
        linkTypes: ["generated_from", "uses"]
      }
    ]);
    expect(preview.taskSeed).toEqual({
      sourceEntityId: "domain.decision",
      targetAgent: "codex",
      impactedContextEntityIds: ["domain.outcome", "domain.policy"]
    });
  });
});

function impactResponse(): EntityImpactResponseDto {
  const root = entity("domain.decision", "Decision", "domain_entity");
  const upstream = entity("domain.policy", "Policy", "domain_entity");
  const downstream = entity("domain.outcome", "Outcome", "domain_entity");

  return {
    rootEntity: root,
    nodes: [
      specNode(downstream),
      specNode(root),
      specNode(upstream),
      {
        id: "source:src/domain.ts:source-domain:Decision:12:11:domain.decision",
        kind: "source",
        label: "Decision",
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 12,
        annotationLine: 11
      }
    ],
    edges: [
      {
        id: "spec-link:policy-decision",
        from: "spec:domain.policy",
        to: "spec:domain.decision",
        kind: "spec_link",
        label: "governs",
        fromEntityId: "domain.policy",
        toEntityId: "domain.decision",
        linkType: "governs",
        source: "frontmatter"
      },
      {
        id: "spec-link:decision-outcome",
        from: "spec:domain.decision",
        to: "spec:domain.outcome",
        kind: "spec_link",
        label: "produces",
        fromEntityId: "domain.decision",
        toEntityId: "domain.outcome",
        linkType: "produces",
        source: "frontmatter"
      }
    ],
    upstreamPaths: [
      {
        direction: "upstream",
        entityIds: ["domain.policy", "domain.decision"],
        steps: [
          pathStep(upstream),
          pathStep(root)
        ],
        linkTypes: ["governs"]
      }
    ],
    downstreamPaths: [
      {
        direction: "downstream",
        entityIds: ["domain.decision", "domain.outcome"],
        steps: [
          pathStep(root),
          pathStep(downstream)
        ],
        linkTypes: ["produces"]
      }
    ],
    sourceEvidence: [
      {
        entityId: "domain.decision",
        filePath: "src/domain.ts",
        sourceFileId: "source-domain",
        symbolName: "Decision",
        symbolKind: "interface",
        symbolLine: 12,
        annotationLine: 11
      }
    ],
    truncated: {
      isTruncated: false,
      reason: null,
      nodeCount: 4,
      edgeCount: 2,
      sourceEvidenceCount: 1
    }
  };
}

function entity(
  entityId: string,
  title: string,
  type: string = "domain_entity"
): ImpactEntitySummaryDto {
  return {
    entityId,
    type,
    title,
    status: "draft",
    filePath: `specops/${entityId}.md`
  };
}

function specNode(entity: ImpactEntitySummaryDto): EntityImpactResponseDto["nodes"][number] {
  return {
    id: `spec:${entity.entityId}`,
    kind: "spec",
    label: entity.title,
    ...entity
  };
}

function pathStep(entity: ImpactEntitySummaryDto) {
  return {
    entityId: entity.entityId,
    title: entity.title,
    type: entity.type,
    status: entity.status
  };
}

function validationMessage(
  overrides: Partial<ValidationMessageDto> & Pick<ValidationMessageDto, "id" | "code" | "message">
): ValidationMessageDto {
  return {
    projectId: "project-1",
    indexRunId: null,
    filePath: null,
    entityId: null,
    level: "warning",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
