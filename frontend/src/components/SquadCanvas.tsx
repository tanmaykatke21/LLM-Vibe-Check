"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, Handle, Position,
  type Connection, type Node, type Edge, type NodeProps, type ReactFlowInstance, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, GNode, GEdge } from "@/lib/api";

const KIND_STYLE: Record<string, string> = {
  llm: "bg-indigo-50 border-indigo-300", tool: "bg-amber-50 border-amber-300", checkpoint: "bg-emerald-50 border-emerald-400 border-dashed",
};
const STATUS_RING: Record<string, string> = { running: "ring-4 ring-blue-400 animate-pulse", done: "ring-2 ring-green-500", error: "ring-2 ring-red-500", waiting: "ring-4 ring-amber-400 animate-pulse", reused: "ring-2 ring-gray-400" };

function SquadNode({ data, selected }: NodeProps) {
  const n = data.node as GNode; const status = data.status as string | undefined;
  const sub = n.kind === "llm" ? n.model : n.kind === "tool" ? n.tool : "human checkpoint";
  return (
    <div className={`rounded-lg border-2 px-3 py-2 min-w-[170px] text-xs shadow-sm ${KIND_STYLE[n.kind]} ${selected ? "outline outline-2 outline-black" : ""} ${status ? STATUS_RING[status] ?? "" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-gray-500" />
      <div className="font-semibold text-sm">{n.label || n.id}</div>
      <div className="text-gray-600">{n.role ?? n.kind}</div>
      <div className="text-gray-500 truncate" title={sub}>{sub}</div>
      {data.metric ? <div className="mt-1 text-[10px] text-gray-700">{String(data.metric)}</div> : null}
      <Handle type="source" position={Position.Right} className="!bg-gray-500" />
    </div>
  );
}
const nodeTypes = { squad: SquadNode };

export function toFlow(g: Graph, status: Record<string, string> = {}, metric: Record<string, string> = {}) {
  const nodes: Node[] = g.nodes.map((n, i) => ({ id: n.id, type: "squad", position: n.position ?? { x: 60 + i * 260, y: 120 },
    data: { node: n, status: status[n.id], metric: metric[n.id] } }));
  const edges: Edge[] = g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: !e.max_loops,
    label: e.max_loops ? `↩ loop ≤${e.max_loops}` : e.type === "audio" ? "audio" : undefined,
    style: e.max_loops ? { stroke: "#d97706", strokeDasharray: "6 3" } : e.type === "audio" ? { stroke: "#7c3aed" } : undefined,
    markerEnd: { type: MarkerType.ArrowClosed } }));
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
    const next = addEdge({ ...c, id, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, edges);
    setEdges(next);
    onChange?.(fromFlow(nodes, next, { ...graph, edges: [...graph.edges, { id, source: c.source!, target: c.target!, type: "text" }] }));
  }, [edges, nodes, graph, onChange, readOnly]);

  const commit = useCallback(() => onChange?.(fromFlow(nodes, edges, graph)), [nodes, edges, graph, onChange]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={(ch) => { onEdgesChange(ch); if (ch.some(c => c.type === "remove")) setTimeout(commit, 0); }}
      onInit={(i) => { rf.current = i as unknown as ReactFlowInstance; }} onConnect={onConnect} onNodeDragStop={commit} onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)}
      nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable fitView deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}>
      <Background /><Controls /><MiniMap pannable zoomable />
    </ReactFlow>
  );
}
