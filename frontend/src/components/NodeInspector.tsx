"use client";
import type { GNode, GEdge, Graph, Skill } from "@/lib/api";
import { ROLES, ROLE_PROMPTS } from "@/lib/presets";
import ModelPicker, { type ModelInfo } from "@/components/ModelPicker";

export default function NodeInspector({ graph, nodeId, models, tools, skills, onChange }:
  { graph: Graph; nodeId: string | null; models: ModelInfo[]; tools: string[]; skills: Skill[]; onChange: (g: Graph) => void }) {
  const n = graph.nodes.find(x => x.id === nodeId);
  if (!n) return <div className="text-sm text-gray-500 p-3">Click a node to edit it. Drag from a node&apos;s right handle to another node&apos;s left handle to connect. Select an arrow and press Delete to remove it.</div>;
  const upd = (patch: Partial<GNode>) => onChange({ ...graph, nodes: graph.nodes.map(x => x.id === n.id ? { ...x, ...patch } : x) });
  const outEdges = graph.edges.filter(e => e.source === n.id);
  const updEdge = (id: string, patch: Partial<GEdge>) => onChange({ ...graph, edges: graph.edges.map(e => e.id === id ? { ...e, ...patch } : e) });
  const remove = () => onChange({ nodes: graph.nodes.filter(x => x.id !== n.id), edges: graph.edges.filter(e => e.source !== n.id && e.target !== n.id) });
  const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block text-xs mt-3"><span className="text-gray-600">{t}</span>{children}</label>;
  const cls = "mt-1 w-full border rounded px-2 py-1 text-sm";
  return (
    <div className="p-3 text-sm">
      <div className="flex justify-between items-center"><b>{n.kind.toUpperCase()} · {n.id}</b><button onClick={remove} className="text-red-600 text-xs">remove</button></div>
      <L t="Label"><input className={cls} value={n.label ?? ""} onChange={e => upd({ label: e.target.value })} /></L>
      {n.kind === "llm" && <>
        <L t="Role"><input list="roles" className={cls} value={n.role ?? ""} onChange={e => upd({ role: e.target.value, system_prompt: n.system_prompt || ROLE_PROMPTS[e.target.value] })} /><datalist id="roles">{ROLES.map(r => <option key={r} value={r} />)}</datalist></L>
        <div className="block text-xs mt-3"><span className="text-gray-600">Model</span>
          <ModelPicker value={n.model} models={models} onChange={m => upd({ model: m })} /></div>
        <L t="System prompt"><textarea className={cls} rows={5} value={n.system_prompt ?? ""} onChange={e => upd({ system_prompt: e.target.value })} /></L>
        <L t="Skills"><div className="mt-1 space-y-1">{skills.length === 0 && <span className="text-gray-400">none yet — add on Skills page</span>}
          {skills.map(s => <label key={s.id} className="flex gap-2 items-center"><input type="checkbox" checked={(n.skill_ids ?? []).includes(s.id)}
            onChange={e => upd({ skill_ids: e.target.checked ? [...(n.skill_ids ?? []), s.id] : (n.skill_ids ?? []).filter(x => x !== s.id) })} />{s.name}</label>)}</div></L>
        <L t="Max tokens"><input type="number" className={cls} value={Number(n.params?.max_tokens ?? 1500)} onChange={e => upd({ params: { ...n.params, max_tokens: Number(e.target.value) } })} /></L>
      </>}
      {n.kind === "tool" && <>
        <L t="Tool"><select className={cls} value={n.tool ?? ""} onChange={e => upd({ tool: e.target.value })}>{tools.map(t => <option key={t}>{t}</option>)}</select></L>
        <L t="Model id"><input className={cls} value={String(n.params?.model ?? "")} onChange={e => upd({ params: { ...n.params, model: e.target.value } })} /></L>
        {n.tool === "elevenlabs.tts" && <L t="Voice id"><input className={cls} value={String(n.params?.voice_id ?? "")} placeholder="default voice" onChange={e => upd({ params: { ...n.params, voice_id: e.target.value } })} /></L>}
      </>}
      {n.kind === "checkpoint" && <>
        <L t="Timeout (minutes)"><input type="number" className={cls} value={Number(n.params?.timeout_minutes ?? 30)} onChange={e => upd({ params: { ...n.params, timeout_minutes: Number(e.target.value) } })} /></L>
        <L t="On timeout"><select className={cls} value={String(n.params?.on_timeout ?? "approve")} onChange={e => upd({ params: { ...n.params, on_timeout: e.target.value } })}><option>approve</option><option>reject</option></select></L>
      </>}
      {outEdges.length > 0 && <div className="mt-4"><div className="text-xs text-gray-600">Outgoing arrows</div>
        {outEdges.map(e => <div key={e.id} className="flex items-center gap-2 mt-1 text-xs">→ <b>{e.target}</b>
          <select value={e.type ?? "text"} onChange={ev => updEdge(e.id, { type: ev.target.value as "text" | "audio" })} className="border rounded px-1"><option>text</option><option>audio</option></select>
          <label className="flex items-center gap-1">loop ≤<input type="number" min={0} className="w-12 border rounded px-1" value={e.max_loops ?? 0}
            onChange={ev => updEdge(e.id, { max_loops: Number(ev.target.value) || undefined })} /></label></div>)}
        <div className="text-[10px] text-gray-500 mt-1">loop &gt; 0 makes it a feedback edge (runs only if this node doesn&apos;t reply APPROVED)</div></div>}
    </div>
  );
}
