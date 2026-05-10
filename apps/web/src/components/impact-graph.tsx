import { useMemo } from "react";
import type { EntityImpactResponseDto, ImpactNodeDto } from "@specops/contracts";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { impactSpecColumns, type ImpactSpecColumns } from "./impact-graph-model.js";

type ImpactGraphProps = {
  impact: EntityImpactResponseDto;
  selectedNodeId: string | null;
  onSelectNode: (node: ImpactNodeDto) => void;
};

export function ImpactGraph({ impact, selectedNodeId, onSelectNode }: ImpactGraphProps) {
  const columns = useMemo(() => impactSpecColumns(impact), [impact]);
  const nodes = useMemo<Node[]>(
    () =>
      impact.nodes.map((node) => ({
        id: node.id,
        position: layoutPosition(node, impact, columns),
        data: { label: node.label },
        className: nodeClassName(node, selectedNodeId, impact.rootEntity.entityId)
      })),
    [columns, impact, selectedNodeId]
  );

  const edges = useMemo<Edge[]>(
    () =>
      impact.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated: edge.kind === "source_evidence"
      })),
    [impact.edges]
  );

  if (impact.nodes.length === 1 && impact.edges.length === 0) {
    return (
      <div
        data-testid="impact-graph"
        className="flex h-[360px] shrink-0 items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-500 lg:h-auto lg:min-h-0 lg:flex-1"
      >
        No linked specs or source evidence match the current filters.
      </div>
    );
  }

  return (
    <div data-testid="impact-graph" className="h-[360px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_event, node) => {
          const impactNode = impact.nodes.find((candidate) => candidate.id === node.id);
          if (impactNode) {
            onSelectNode(impactNode);
          }
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function layoutPosition(
  node: ImpactNodeDto,
  impact: EntityImpactResponseDto,
  columns: ImpactSpecColumns
) {
  if (node.kind === "source") {
    return sourceNodePosition(node, impact, columns);
  }

  if (node.entityId === impact.rootEntity.entityId) {
    return { x: 0, y: 0 };
  }

  if (columns.upstreamEntityIds.includes(node.entityId)) {
    return { x: -320, y: columns.upstreamEntityIds.indexOf(node.entityId) * 120 };
  }

  if (columns.downstreamEntityIds.includes(node.entityId)) {
    return { x: 320, y: columns.downstreamEntityIds.indexOf(node.entityId) * 120 };
  }

  return { x: 0, y: 140 + columns.otherEntityIds.indexOf(node.entityId) * 120 };
}

function sourceNodePosition(
  node: ImpactNodeDto,
  impact: EntityImpactResponseDto,
  columns: ImpactSpecColumns
) {
  const sourceNodes = impact.nodes.filter(
    (candidate): candidate is Extract<ImpactNodeDto, { kind: "source" }> =>
      candidate.kind === "source"
  );
  const index = sourceNodes.findIndex((candidate) => candidate.id === node.id);
  const y = 180 + Math.max(index, 0) * 120;
  if (node.entityId === impact.rootEntity.entityId) {
    return { x: 0, y };
  }

  const x = columns.upstreamEntityIds.includes(node.entityId) ? -640 : 640;
  return { x, y };
}

function nodeClassName(
  node: ImpactNodeDto,
  selectedNodeId: string | null,
  rootEntityId: string
) {
  const base =
    node.kind === "source"
      ? "rounded border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-950"
      : "rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950";
  const isFocused =
    node.id === selectedNodeId ||
    (!selectedNodeId && node.kind === "spec" && node.entityId === rootEntityId);
  return isFocused ? `${base} ring-2 ring-slate-900` : base;
}
