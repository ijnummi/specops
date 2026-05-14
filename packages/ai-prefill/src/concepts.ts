import type { ConceptGraphPromptPacket } from "./types.js";

export type ConceptGraphPromptNode = {
  id: string;
  nodeKey: string;
  nodeType: string;
  label: string;
  path?: string | null;
};

export type ConceptGraphPromptEdge = {
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
};

export type BuildConceptGraphPromptPacketInput = {
  project: { id: string; name: string };
  graph: {
    versionId: string;
    summary: string;
    nodes: ConceptGraphPromptNode[];
    edges: ConceptGraphPromptEdge[];
  };
  limits: { maxGraphNodes: number; maxGraphEdges: number };
};

export type NormalizedConceptGraph = {
  concepts: NormalizedConcept[];
  relationships: NormalizedConceptRelationship[];
  diagnostics: ConceptGraphDiagnostic[];
  rejectedConceptCount: number;
  rejectedMembershipCount: number;
};

export type NormalizedConcept = {
  key: string;
  type: string;
  name: string;
  summary: string;
  confidence: number;
  evidenceSummary: string;
  memberships: NormalizedConceptMembership[];
};

export type NormalizedConceptMembership = {
  graphNodeId: string;
  role: string;
  confidence: number;
  rationale: string;
};

export type NormalizedConceptRelationship = {
  fromConceptKey: string;
  toConceptKey: string;
  relationshipType: string;
  confidence: number;
  rationale: string;
};

type ConceptGraphDiagnostic = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};

const conceptTypes = [
  "workflow",
  "subsystem",
  "domain_concept",
  "interface",
  "data_flow",
  "test_behavior",
  "cross_cutting",
  "unknown"
];

const membershipRoles = ["primary", "supporting", "entrypoint", "data", "test", "spec"];

const relationshipTypes = [
  "depends_on",
  "uses",
  "implements",
  "exposes",
  "tests",
  "relates_to"
];

export function buildConceptGraphPromptPacket(
  input: BuildConceptGraphPromptPacketInput
): ConceptGraphPromptPacket {
  const boundedNodes = input.graph.nodes.slice(0, input.limits.maxGraphNodes);
  const boundedEdges = input.graph.edges.slice(0, input.limits.maxGraphEdges);

  return {
    promptVersion: "concept-graph-v1",
    messages: [
      {
        role: "system",
        content: [
          "You are SpecOps Concept Graph.",
          "Consolidate deterministic project graph facts into higher-level project concepts.",
          "Return strict JSON only and no markdown fences.",
          "Every concept must cite supplied graph nodes as evidence."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            project: input.project,
            graph: {
              versionId: input.graph.versionId,
              summary: input.graph.summary,
              nodes: boundedNodes,
              edges: boundedEdges
            },
            instructions: {
              conceptTypes,
              membershipRoles,
              relationshipTypes,
              evidenceRule:
                "Every concept must include at least one membership referencing a supplied graphNodeId or graphNodeKey.",
              outputShape: {
                concepts: [
                  {
                    key: "workflow:checkout",
                    type: "workflow",
                    name: "Checkout",
                    summary: "Concise concept summary.",
                    confidence: 0.8,
                    evidenceSummary: "Why the memberships support the concept.",
                    memberships: [
                      {
                        graphNodeId: "supplied-node-id",
                        graphNodeKey: "file:src/example.ts",
                        role: "primary",
                        confidence: 0.8,
                        rationale: "Evidence rationale."
                      }
                    ]
                  }
                ],
                relationships: [
                  {
                    fromConceptKey: "workflow:checkout",
                    toConceptKey: "interface:payments",
                    relationshipType: "uses",
                    confidence: 0.7,
                    rationale: "Relationship rationale."
                  }
                ]
              }
            }
          },
          null,
          2
        )
      }
    ]
  };
}

export function normalizeConceptGraphProviderResponse(input: {
  text: string;
  graphNodeIds: Set<string>;
  graphNodeKeys: Map<string, string>;
}): NormalizedConceptGraph {
  const parsed = parseJsonObject(input.text);
  const diagnostics: ConceptGraphDiagnostic[] = [];
  const concepts: NormalizedConcept[] = [];
  const acceptedKeys = new Set<string>();
  let rejectedConceptCount = 0;
  let rejectedMembershipCount = 0;

  const rawConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  rawConcepts.forEach((rawConcept, index) => {
    const record = isRecord(rawConcept) ? rawConcept : {};
    const key = readString(record.key) || conceptKey(readString(record.type), readString(record.name));
    const memberships = normalizeMemberships({
      value: record.memberships,
      graphNodeIds: input.graphNodeIds,
      graphNodeKeys: input.graphNodeKeys,
      diagnostics
    });
    rejectedMembershipCount += countRawMemberships(record.memberships) - memberships.length;

    if (memberships.length === 0) {
      rejectedConceptCount += 1;
      diagnostics.push({
        level: "warning",
        code: "concept_without_membership",
        message: `Rejected concept ${index + 1} (${key}) because it has no supported graph memberships.`
      });
      return;
    }

    concepts.push({
      key,
      type: readString(record.type) || "unknown",
      name: readString(record.name) || key,
      summary: readString(record.summary),
      confidence: clampConceptConfidence(readNumber(record.confidence), memberships),
      evidenceSummary: readString(record.evidenceSummary),
      memberships
    });
    acceptedKeys.add(key);
  });

  const relationships = normalizeRelationships(parsed.relationships, acceptedKeys, diagnostics);

  return {
    concepts,
    relationships,
    diagnostics,
    rejectedConceptCount,
    rejectedMembershipCount
  };
}

function normalizeMemberships(input: {
  value: unknown;
  graphNodeIds: Set<string>;
  graphNodeKeys: Map<string, string>;
  diagnostics: ConceptGraphDiagnostic[];
}): NormalizedConceptMembership[] {
  if (!Array.isArray(input.value)) {
    return [];
  }

  return input.value.flatMap((item) => {
    const record = isRecord(item) ? item : {};
    const graphNodeId = resolveGraphNodeId(record, input.graphNodeIds, input.graphNodeKeys);

    if (graphNodeId === null) {
      input.diagnostics.push({
        level: "warning",
        code: "unsupported_membership",
        message: "Dropped membership that did not reference a supplied graph node."
      });
      return [];
    }

    return [
      {
        graphNodeId,
        role: readString(record.role) || "supporting",
        confidence: clamp(readNumber(record.confidence), 0, 1, 0.5),
        rationale: readString(record.rationale)
      }
    ];
  });
}

function normalizeRelationships(
  value: unknown,
  acceptedKeys: Set<string>,
  diagnostics: ConceptGraphDiagnostic[]
): NormalizedConceptRelationship[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = isRecord(item) ? item : {};
    const fromConceptKey = readString(record.fromConceptKey);
    const toConceptKey = readString(record.toConceptKey);

    if (!acceptedKeys.has(fromConceptKey) || !acceptedKeys.has(toConceptKey)) {
      diagnostics.push({
        level: "warning",
        code: "unsupported_relationship",
        message: "Dropped relationship that referenced an unknown concept."
      });
      return [];
    }

    return [
      {
        fromConceptKey,
        toConceptKey,
        relationshipType: readString(record.relationshipType) || "relates_to",
        confidence: clamp(readNumber(record.confidence), 0, 1, 0.5),
        rationale: readString(record.rationale)
      }
    ];
  });
}

function resolveGraphNodeId(
  record: Record<string, unknown>,
  graphNodeIds: Set<string>,
  graphNodeKeys: Map<string, string>
): string | null {
  const explicitId = readString(record.graphNodeId);
  if (graphNodeIds.has(explicitId)) {
    return explicitId;
  }

  const mappedId = graphNodeKeys.get(readString(record.graphNodeKey));
  if (mappedId !== undefined && graphNodeIds.has(mappedId)) {
    return mappedId;
  }

  return null;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function countRawMemberships(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function clampConceptConfidence(
  value: number | null,
  memberships: NormalizedConceptMembership[]
): number {
  const base = clamp(value, 0, 1, 0.5);
  const maxMembershipConfidence = Math.max(
    ...memberships.map((membership) => membership.confidence),
    0
  );
  return Math.min(base, maxMembershipConfidence);
}

function conceptKey(type: string, name: string): string {
  const slug = (name || "unnamed")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${type || "unknown"}:${slug || "unnamed"}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
