import { useMemo } from "react";
import type { EntityImpactResponseDto, ImpactNodeDto } from "@specops/contracts";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type ImpactGraphProps = {
  impact: EntityImpactResponseDto;
  selectedNodeId: string | null;
  onSelectNode: (node: ImpactNodeDto) => void;
};

export function ImpactGraph({ impact, selectedNodeId, onSelectNode }: ImpactGraphProps) {
  const nodes = useMemo<Node[]>(
    () =>
      impact.nodes.map((node, index) => ({
        id: node.id,
        position: layoutPosition(index, node.kind),
        data: { label: node.label },
        className: nodeClassName(node, selectedNodeId)
      })),
    [impact.nodes, selectedNodeId]
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

function layoutPosition(index: number, kind: ImpactNodeDto["kind"]) {
  const column = kind === "source" ? 2 : index % 2;
  const row = Math.floor(index / 2);
  return { x: column * 280, y: row * 120 };
}

function nodeClassName(node: ImpactNodeDto, selectedNodeId: string | null) {
  const base =
    node.kind === "source"
      ? "rounded border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-950"
      : "rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-950";
  return node.id === selectedNodeId ? `${base} ring-2 ring-slate-900` : base;
}
