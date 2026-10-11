"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
  type Connection, type Node, type Edge, type NodeProps, type ReactFlowInstance, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, GNode, GEdge } from "@/lib/api";
import { providerOf } from "@/lib/providers";
import { ModelChip, ROLE_GLYPH } from "@/components/ui";

const STATUS_RING: Record<string, string> = {
  running: "ring-2 ring-accent ring-offset-2 ring-offset-paper", done: "", error: "ring-2 ring-bad ring-offset-2 ring-offset-paper",
  waiting: "ring-2 ring-warn ring-offset-2 ring-offset-paper", reused: "opacity-70",
};
const STATUS_TEXT: Record<string, [string, string]> = {
  running: ["Running", "text-accent"], done: ["Done", "text-good"], error: ["Error", "text-bad"], waiting: ["Waiting for you", "text-warn"], reused: ["Reused", "text-muted"],
};

function SquadNode({ data, selected }: NodeProps) {
  const n = data.node as GNode; const status = data.status as string | undefined;
  const who = n.kind === "llm" ? n.model : n.kind === "tool" ? n.tool : "human";
  const p = providerOf(who);
  const role = n.kind === "checkpoint" ? "checkpoint" : n.kind === "tool" ? "tool" : (n.role ?? "llm");
  const st = status ? STATUS_TEXT[status] : undefined;
  return (
    <div className={`relative w-[210px] rounded-xl border bg-surface text-left shadow-[0_1px_2px_rgba(23,26,33,0.06)] ${n.kind === "checkpoint" ? "border-dashed border-warn" : "border-line-strong"} ${selected ? "outline outline-2 outline-offset-2 outline-accent" : ""} ${status ? STATUS_RING[status] ?? "" : ""}`}>
      <div className="h-1 w-full rounded-t-[11px]" style={{ background: p.color }} />
      <Handle type="target" position={Position.Left} />
      <div className="px-3 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{n.label || n.id}</span>
          {st && <span className={`shrink-0 text-[10px] font-medium ${st[1]}`}>{status === "running" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />}{st[0]}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted"><span aria-hidden className="w-3 text-center">{ROLE_GLYPH[role] ?? "•"}</span>{role}</div>
        <div className="mt-1.5">{n.kind === "checkpoint" ? <span className="text-[11px] text-warn">You approve or edit here</span> : <ModelChip model={who} />}</div>
        {data.metric ? <div className="mt-1.5 border-t border-line pt-1.5 font-mono text-[10px] text-muted">{String(data.metric)}</div> : null}
      </div>
      <Handle type="source" position={Position.Right} />
      {/* hidden anchors so feedback loops route underneath the nodes instead of over the forward arrows */}
      <Handle id="loop-out" type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0, left: "62%" }} />
      <Handle id="loop-in" type="target" position={Position.Bottom} isConnectable={false} style={{ opacity: 0, left: "38%" }} />
    </div>
  );
}
const nodeTypes = { squad: SquadNode };

export function toFlow(g: Graph, status: Record<string, string> = {}, metric: Record<string, string> = {}) {
  const nodes: Node[] = g.nodes.map((n, i) => ({ id: n.id, type: "squad", position: n.position ?? { x: 60 + i * 260, y: 120 },
    data: { node: n, status: status[n.id], metric: metric[n.id] } }));
  const edges: Edge[] = g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: !e.max_loops,
    ...(e.max_loops ? { sourceHandle: "loop-out", targetHandle: "loop-in", type: "smoothstep", pathOptions: { offset: 36, borderRadius: 14 } } : {}),
    label: e.max_loops ? `sends back, up to ${e.max_loops}×` : e.type === "audio" ? "audio" : undefined,
    style: e.max_loops ? { stroke: "#B45309", strokeDasharray: "6 4", strokeWidth: 1.5 } : e.type === "audio" ? { stroke: "#7C3AED", strokeWidth: 1.5 } : { stroke: "#8A919D", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.max_loops ? "#B45309" : e.type === "audio" ? "#7C3AED" : "#8A919D" } }));
  return { nodes, edges };
}

export function fromFlow(nodes: Node[], edges: Edge[], prev: Graph): Graph {
  const byId = Object.fromEntries(prev.nodes.map(n => [n.id, n]));
  return {
    nodes: nodes.map(n => ({ ...(byId[n.id] ?? (n.data.node as GNode)), position: n.position })),
    edges: edges.map(e => { const p = prev.edges.find(x => x.id === e.id); return { id: e.id, source: e.source, target: e.target, type: p?.type ?? "text", ...(p?.max_loops ? { max_loops: p.max_loops } : {}) } as GEdge; }),
  };
}

export default function SquadCanvas({ graph, onChange, onSelect, readOnly, status, metric }:
  { graph: Graph; onChange?: (g: Graph) => void; onSelect?: (id: string | null) => void; readOnly?: boolean; status?: Record<string, string>; metric?: Record<string, string> }) {
  const init = useMemo(() => toFlow(graph, status, metric), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges);
  const rf = useRef<ReactFlowInstance | null>(null);
  const prevCount = useRef(graph.nodes.length);

  // sync in external graph/status changes
  useEffect(() => { const f = toFlow(graph, status, metric);
    setNodes(f.nodes.map(n => ({ ...n, position: nodes.find(x => x.id === n.id)?.position ?? n.position })));
    setEdges(f.edges);
    if (graph.nodes.length !== prevCount.current) {   // node added/removed or preset loaded -> zoom to fit
      setTimeout(() => rf.current?.fitView({ padding: 0.2, duration: 300 }), 60);
    }
    prevCount.current = graph.nodes.length; }, [graph, status, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback((c: Connection) => {
    if (readOnly) return;
    const id = `e${Date.now()}`;
    const next = addEdge({ ...c, id, animated: true, style: { stroke: "#8A919D", strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: "#8A919D" } }, edges);
    setEdges(next);
    onChange?.(fromFlow(nodes, next, { ...graph, edges: [...graph.edges, { id, source: c.source!, target: c.target!, type: "text" }] }));
  }, [edges, nodes, graph, onChange, readOnly]);

  const commit = useCallback(() => onChange?.(fromFlow(nodes, edges, graph)), [nodes, edges, graph, onChange]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={(ch) => { onEdgesChange(ch); if (ch.some(c => c.type === "remove")) setTimeout(commit, 0); }}
      onInit={(i) => { rf.current = i as unknown as ReactFlowInstance; }} onConnect={onConnect} onNodeDragStop={commit} onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)}
      nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable fitView deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}>
      <Background gap={20} size={1.2} /><Controls showInteractive={false} />{!readOnly && <MiniMap pannable zoomable nodeColor={(nd) => providerOf(((nd.data as { node: GNode }).node.model) ?? (nd.data as { node: GNode }).node.tool).color} />}
    </ReactFlow>
  );
}

