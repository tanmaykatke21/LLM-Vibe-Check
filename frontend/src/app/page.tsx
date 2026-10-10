"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow, Background, Controls, addEdge,
  useNodesState, useEdgesState, Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const initialNodes = [
  { id: "planner", position: { x: 50, y: 100 }, data: { label: "Planner (Fable 5.1)" } },
  { id: "executor", position: { x: 300, y: 100 }, data: { label: "Executor (Haiku 5.5)" } },
  { id: "reviewer", position: { x: 550, y: 100 }, data: { label: "Reviewer (Opus 5.5)" } },
];
const initialEdges = [{ id: "e1", source: "planner", target: "executor", animated: true }];

export default function Home() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [api, setApi] = useState("checking...");

  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge({ ...c, animated: true }, e)),
    [setEdges]
  );

  useEffect(() => {
    fetch("http://localhost:8000/health")
      .then((r) => r.json())
      .then((d) => setApi(d.status))
      .catch(() => setApi("DOWN"));
  }, []);

  return (
    <main style={{ height: "100vh" }}>
      <div className="p-3 text-sm">
        Backend: <b>{api}</b> · Edges:{" "}
        {edges.map((e) => `${e.source}→${e.target}`).join(", ")}
      </div>
      <div style={{ height: "90%" }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </main>
  );
}