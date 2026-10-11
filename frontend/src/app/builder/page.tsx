"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SquadCanvas from "@/components/SquadCanvas";
import NodeInspector from "@/components/NodeInspector";
import { ResizeHandle, useStoredSize } from "@/components/Resizable";
import ModelPicker, { type ModelInfo } from "@/components/ModelPicker";
import { Button } from "@/components/ui";
import { api, type Graph, type Skill, type Task } from "@/lib/api";
import { presetGraph, DEMO_MODELS, ROLE_PROMPTS } from "@/lib/presets";

const PRESETS = [["linear", "Plan, build, review"], ["loop", "With feedback loop"], ["checkpoint", "With your approval"], ["audio", "Voice round-trip"]] as const;

function Builder() {
  const sp = useSearchParams(); const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(sp.get("session"));
  const [name, setName] = useState("My squad"); const [graph, setGraph] = useState<Graph>(presetGraph("loop"));
  const [sel, setSel] = useState<string | null>(null); const [models, setModels] = useState<ModelInfo[]>(DEMO_MODELS.map(id => ({ id })));
  const [newModel, setNewModel] = useState(DEMO_MODELS[0]); const [tools, setTools] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [taskId, setTaskId] = useState("");
  const [panelW, setPanelW] = useStoredSize("builder.panelW", 340, 260, 900);
  const [problems, setProblems] = useState<string[]>([]); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", task_type: "general" }); const [taskOpen, setTaskOpen] = useState(false);

  useEffect(() => {
    api.models().then(m => {
      const ids = new Set(m.llms.map(x => x.id));
      setModels([...DEMO_MODELS.filter(d => !ids.has(d)).map(id => ({ id })), ...(m.llms as ModelInfo[])]); setTools(m.tools);
    }).catch(() => {});
    api.skills().then(setSkills).catch(() => {}); api.tasks().then(t => { setTasks(t); if (t[0]) setTaskId(t[0].id); }).catch(() => {});
    if (sessionId) api.session(sessionId).then(s => { setName(s.name); setGraph(s.graph); }).catch(() => {});
  }, [sessionId]);
  useEffect(() => { api.validateGraph(graph).then(v => setProblems(v.problems)).catch(() => {}); }, [graph]);

  const addNode = (kind: "llm" | "tool" | "checkpoint") => {
    const id = `${kind[0]}${Date.now().toString(36).slice(-4)}`;
    const maxY = graph.nodes.reduce((m, x) => Math.max(m, x.position?.y ?? 0), 0);
    const sameRow = graph.nodes.filter(x => (x.position?.y ?? 0) === maxY).length;
    const base = { id, kind, position: graph.nodes.length
      ? { x: 60 + (sameRow % 4) * 280, y: maxY + (maxY < 200 || sameRow >= 4 ? 170 : 0) }
      : { x: 60, y: 120 } };
    const short = newModel.split("/").pop() ?? newModel;
    const n = kind === "llm" ? { ...base, role: "executor", label: short, model: newModel, system_prompt: ROLE_PROMPTS.executor }
      : kind === "tool" ? { ...base, tool: "elevenlabs.tts", label: "Text to speech", params: { model: "eleven_flash_v2_5" } } : { ...base, label: "Your approval", params: { timeout_minutes: 30, on_timeout: "approve" } };
    setGraph({ ...graph, nodes: [...graph.nodes, n as Graph["nodes"][number]] }); setSel(id);
  };
  const save = async () => {
    const s = sessionId ? await api.updateSession(sessionId, { name, graph }) : await api.createSession({ name, graph });
    setSessionId(s.id); setMsg(`Saved “${s.name}”`); setTimeout(() => setMsg(""), 2500); router.replace(`/builder?session=${s.id}`); return s.id;
  };
  const run = async () => {
    if (!taskId) return setMsg("Pick a task to run first");
    setBusy(true);
    try { const sid = await save(); const r = await api.startRun(sid, taskId); router.push(`/runs/${r.id}`); } finally { setBusy(false); }
  };
  const createTask = async () => { const t = await api.createTask(newTask); setTasks([t, ...tasks]); setTaskId(t.id); setNewTask({ title: "", description: "", task_type: "general" }); setTaskOpen(false); setMsg(`Task “${t.title}” created`); };

  return (
    <main className="flex h-[calc(100vh-3rem)] overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-2">
            <input aria-label="Squad name" className="field !w-40 font-medium" value={name} onChange={e => setName(e.target.value)} />
            <select aria-label="Start from a template" className="field !w-auto text-muted" value="" onChange={e => { if (e.target.value) { setGraph(presetGraph(e.target.value as "linear")); setSel(null); } }}>
              <option value="">Start from a template…</option>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="flex items-center gap-1 border-l border-line pl-3">
            <span className="w-48"><ModelPicker compact value={newModel} models={models} onChange={setNewModel} /></span>
            <Button onClick={() => addNode("llm")}>Add model</Button>
            <Button variant="ghost" onClick={() => addNode("tool")}>Add tool</Button>
            <Button variant="ghost" onClick={() => addNode("checkpoint")}>Add approval</Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select aria-label="Task to run" className="field !w-48" value={taskId} onChange={e => setTaskId(e.target.value)}>
              <option value="">Choose a task…</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            <Button onClick={save}>Save</Button>
            <Button variant="primary" onClick={run} disabled={problems.length > 0 || busy}>{busy ? "Starting…" : "Run squad"}</Button>
          </div>
        </div>
        {problems.length > 0 && <div role="alert" className="border-b border-bad/20 bg-bad-soft px-4 py-1.5 text-[12px] text-bad">Fix before running: {problems.join("; ")}</div>}
        {msg && <div role="status" className="border-b border-line bg-accent-soft px-4 py-1.5 text-[12px] text-accent">{msg}</div>}
        <div className="relative flex-1">
          <SquadCanvas graph={graph} onChange={setGraph} onSelect={setSel} />
          {graph.nodes.length === 0 && <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="max-w-sm rounded-xl border border-dashed border-line-strong bg-surface/90 p-5 text-center">
              <p className="font-medium">This squad is empty</p>
              <p className="mt-1 text-[13px] text-muted">Pick a model above and choose Add model, or start from a template.</p></div></div>}
        </div>
      </div>
      <ResizeHandle axis="x" size={panelW} onResize={setPanelW} reset={340} label="Inspector width" />
      <aside className="shrink-0 overflow-y-auto border-l border-line bg-surface" style={{ width: panelW }}>
        <NodeInspector graph={graph} nodeId={sel} models={models} tools={tools} skills={skills} onChange={setGraph} />
        <div className="border-t border-line p-4">
          <button onClick={() => setTaskOpen(!taskOpen)} aria-expanded={taskOpen} className="flex w-full items-center justify-between text-[13px] font-semibold">
            New task<span className="text-muted">{taskOpen ? "–" : "+"}</span></button>
          {taskOpen && <div className="mt-3 space-y-2">
            <input className="field" placeholder="Title, e.g. Duration parser" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} />
            <textarea className="field" rows={5} placeholder="What should the squad produce? Be specific about the output." value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} />
            <div className="flex gap-2"><select className="field !w-auto" value={newTask.task_type} onChange={e => setNewTask({ ...newTask, task_type: e.target.value })}><option value="general">General</option><option value="coding">Coding</option><option value="audio">Audio</option></select>
              <Button variant="primary" onClick={createTask} disabled={!newTask.title || !newTask.description}>Create task</Button></div></div>}
        </div>
      </aside>
    </main>
  );
}
export default function Page() { return <Suspense><Builder /></Suspense>; }

