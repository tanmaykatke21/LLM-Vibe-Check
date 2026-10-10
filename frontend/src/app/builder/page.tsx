"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SquadCanvas from "@/components/SquadCanvas";
import NodeInspector from "@/components/NodeInspector";
import { api, type Graph, type Skill, type Task } from "@/lib/api";
import { presetGraph, DEMO_MODELS, ROLE_PROMPTS } from "@/lib/presets";

function Builder() {
  const sp = useSearchParams(); const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(sp.get("session"));
  const [name, setName] = useState("My squad"); const [graph, setGraph] = useState<Graph>(presetGraph("loop"));
  const [sel, setSel] = useState<string | null>(null); const [models, setModels] = useState<string[]>(DEMO_MODELS); const [tools, setTools] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [taskId, setTaskId] = useState("");
  const [problems, setProblems] = useState<string[]>([]); const [msg, setMsg] = useState(""); const [newTask, setNewTask] = useState({ title: "", description: "", task_type: "general" });

  useEffect(() => {
    api.models().then(m => { setModels(Array.from(new Set([...DEMO_MODELS, ...m.llms.map(x => x.id)]))); setTools(m.tools); }).catch(() => {});
    api.skills().then(setSkills).catch(() => {}); api.tasks().then(t => { setTasks(t); if (t[0]) setTaskId(t[0].id); }).catch(() => {});
    if (sessionId) api.session(sessionId).then(s => { setName(s.name); setGraph(s.graph); }).catch(() => {});
  }, [sessionId]);
  useEffect(() => { api.validateGraph(graph).then(v => setProblems(v.problems)).catch(() => {}); }, [graph]);

  const addNode = (kind: "llm" | "tool" | "checkpoint") => {
    const id = `${kind[0]}${Date.now().toString(36).slice(-4)}`;
    const base = { id, kind, position: { x: 80 + graph.nodes.length * 60, y: 300 } };
    const n = kind === "llm" ? { ...base, role: "executor", label: "New LLM", model: DEMO_MODELS[0], system_prompt: ROLE_PROMPTS.executor }
      : kind === "tool" ? { ...base, tool: "elevenlabs.tts", label: "TTS", params: { model: "eleven_flash_v2_5" } } : { ...base, label: "Checkpoint", params: { timeout_minutes: 30, on_timeout: "approve" } };
    setGraph({ ...graph, nodes: [...graph.nodes, n as Graph["nodes"][number]] }); setSel(id);
  };
  const save = async () => {
    const s = sessionId ? await api.updateSession(sessionId, { name, graph }) : await api.createSession({ name, graph });
    setSessionId(s.id); setMsg(`saved ${s.name}`); router.replace(`/builder?session=${s.id}`); return s.id;
  };
  const run = async () => {
    if (!taskId) return setMsg("pick a task first");
    const sid = await save(); const r = await api.startRun(sid, taskId); router.push(`/runs/${r.id}`);
  };
  const createTask = async () => { const t = await api.createTask(newTask); setTasks([t, ...tasks]); setTaskId(t.id); setNewTask({ title: "", description: "", task_type: "general" }); };

  return (
    <main className="h-[calc(100vh-41px)] grid grid-cols-[1fr_340px]">
      <div className="flex flex-col">
        <div className="flex gap-2 items-center p-2 border-b text-sm flex-wrap">
          <input className="border rounded px-2 py-1" value={name} onChange={e => setName(e.target.value)} />
          <span className="text-gray-400">preset:</span>{(["linear", "loop", "checkpoint", "audio"] as const).map(p => <button key={p} onClick={() => { setGraph(presetGraph(p)); setSel(null); }} className="border rounded px-2 py-1 hover:bg-gray-50">{p}</button>)}
          <span className="text-gray-400 ml-2">add:</span><button onClick={() => addNode("llm")} className="border rounded px-2 py-1 bg-indigo-50">+ LLM</button><button onClick={() => addNode("tool")} className="border rounded px-2 py-1 bg-amber-50">+ Tool</button><button onClick={() => addNode("checkpoint")} className="border rounded px-2 py-1 bg-emerald-50">+ Checkpoint</button>
          <span className="ml-auto flex gap-2 items-center">
            <select className="border rounded px-2 py-1 max-w-[220px]" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">— task —</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            <button onClick={save} className="border rounded px-3 py-1">Save</button>
            <button onClick={run} disabled={problems.length > 0} className="rounded px-3 py-1 bg-black text-white disabled:opacity-40">▶ Run</button></span>
        </div>
        {problems.length > 0 && <div className="bg-red-50 text-red-800 text-xs px-3 py-1">{problems.join(" · ")}</div>}
        {msg && <div className="text-xs text-gray-500 px-3 py-1">{msg}</div>}
        <div className="flex-1"><SquadCanvas graph={graph} onChange={setGraph} onSelect={setSel} /></div>
      </div>
      <aside className="border-l overflow-y-auto">
        <NodeInspector graph={graph} nodeId={sel} models={models} tools={tools} skills={skills} onChange={setGraph} />
        <div className="border-t p-3 text-sm"><b className="text-xs">New task</b>
          <input className="mt-1 w-full border rounded px-2 py-1 text-sm" placeholder="Title" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} />
          <textarea className="mt-1 w-full border rounded px-2 py-1 text-sm" rows={4} placeholder="Describe the task…" value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} />
          <div className="flex gap-2 mt-1"><select className="border rounded px-2 py-1 text-sm" value={newTask.task_type} onChange={e => setNewTask({ ...newTask, task_type: e.target.value })}><option>general</option><option>coding</option><option>audio</option></select>
            <button onClick={createTask} disabled={!newTask.title || !newTask.description} className="border rounded px-2 py-1 text-sm disabled:opacity-40">Create</button></div></div>
      </aside>
    </main>
  );
}
export default function Page() { return <Suspense><Builder /></Suspense>; }
