"use client";
import type { GNode, GEdge, Graph, Skill } from "@/lib/api";
import { ROLES, ROLE_PROMPTS } from "@/lib/presets";
import ModelPicker, { type ModelInfo } from "@/components/ModelPicker";
import { Button, ModelChip } from "@/components/ui";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="mt-4 block first:mt-0">
    <span className="text-[12px] font-medium text-ink">{label}</span>
    {hint && <span className="ml-1 text-[11px] text-faint">{hint}</span>}
    <div className="mt-1">{children}</div>
  </label>;
}

export default function NodeInspector({ graph, nodeId, models, tools, skills, onChange }:
  { graph: Graph; nodeId: string | null; models: ModelInfo[]; tools: string[]; skills: Skill[]; onChange: (g: Graph) => void }) {
  const n = graph.nodes.find(x => x.id === nodeId);
  if (!n) return (
    <div className="p-4">
      <h2 className="text-[13px] font-semibold">Edit the squad</h2>
      <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
        <li>Click a node to change its role, model, prompt and skills.</li>
        <li>Drag from a node&apos;s right dot to another node&apos;s left dot to pass work along.</li>
        <li>Select an arrow and press Delete to remove it.</li>
      </ul>
    </div>);
  const upd = (patch: Partial<GNode>) => onChange({ ...graph, nodes: graph.nodes.map(x => x.id === n.id ? { ...x, ...patch } : x) });
  const outEdges = graph.edges.filter(e => e.source === n.id);
  const updEdge = (id: string, patch: Partial<GEdge>) => onChange({ ...graph, edges: graph.edges.map(e => e.id === id ? { ...e, ...patch } : e) });
  const remove = () => onChange({ nodes: graph.nodes.filter(x => x.id !== n.id), edges: graph.edges.filter(e => e.source !== n.id && e.target !== n.id) });
  const label = (id: string) => graph.nodes.find(x => x.id === id)?.label || id;
  const kindName = n.kind === "llm" ? "AI model" : n.kind === "tool" ? "Tool" : "Human checkpoint";
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-[11px] text-muted">{kindName}</div>
          <div className="truncate text-[15px] font-semibold">{n.label || n.id}</div>
          {n.kind !== "checkpoint" && <ModelChip className="mt-1" model={n.kind === "llm" ? n.model : n.tool} />}</div>
        <Button size="sm" variant="danger" onClick={remove}>Remove</Button>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <Field label="Name"><input className="field" value={n.label ?? ""} onChange={e => upd({ label: e.target.value })} /></Field>
        {n.kind === "llm" && <>
          <Field label="Role" hint="sets a starting prompt">
            <input list="roles" className="field" value={n.role ?? ""} onChange={e => upd({ role: e.target.value, system_prompt: n.system_prompt || ROLE_PROMPTS[e.target.value] })} />
            <datalist id="roles">{ROLES.map(r => <option key={r} value={r} />)}</datalist></Field>
          <Field label="Model"><ModelPicker value={n.model} models={models} onChange={m => upd({ model: m })} /></Field>
          <Field label="Instructions" hint="system prompt"><textarea className="field font-mono text-[12px]" rows={6} value={n.system_prompt ?? ""} onChange={e => upd({ system_prompt: e.target.value })} /></Field>
          <Field label="Skills">
            <div className="space-y-1.5">{skills.length === 0 && <span className="text-[12px] text-faint">No skills yet. Add one on the Skills page.</span>}
              {skills.map(s => <label key={s.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[#4F46E5]" checked={(n.skill_ids ?? []).includes(s.id)}
                onChange={e => upd({ skill_ids: e.target.checked ? [...(n.skill_ids ?? []), s.id] : (n.skill_ids ?? []).filter(x => x !== s.id) })} />{s.name}</label>)}</div></Field>
          <Field label="Answer length limit" hint="max tokens"><input type="number" className="field" value={Number(n.params?.max_tokens ?? 1500)} onChange={e => upd({ params: { ...n.params, max_tokens: Number(e.target.value) } })} /></Field>
        </>}
        {n.kind === "tool" && <>
          <Field label="Tool"><select className="field" value={n.tool ?? ""} onChange={e => upd({ tool: e.target.value })}>{tools.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Tool model"><input className="field font-mono" value={String(n.params?.model ?? "")} onChange={e => upd({ params: { ...n.params, model: e.target.value } })} /></Field>
          {n.tool === "elevenlabs.tts" && <Field label="Voice" hint="leave empty for the default"><input className="field font-mono" value={String(n.params?.voice_id ?? "")} onChange={e => upd({ params: { ...n.params, voice_id: e.target.value } })} /></Field>}
        </>}
        {n.kind === "checkpoint" && <>
          <Field label="Wait for you up to" hint="minutes"><input type="number" className="field" value={Number(n.params?.timeout_minutes ?? 30)} onChange={e => upd({ params: { ...n.params, timeout_minutes: Number(e.target.value) } })} /></Field>
          <Field label="If you don't answer"><select className="field" value={String(n.params?.on_timeout ?? "approve")} onChange={e => upd({ params: { ...n.params, on_timeout: e.target.value } })}><option value="approve">Approve and continue</option><option value="reject">Stop the run</option></select></Field>
        </>}
      </div>
      {outEdges.length > 0 && <div className="mt-5 border-t border-line pt-4">
        <div className="text-[12px] font-medium">Passes work to</div>
        {outEdges.map(e => <div key={e.id} className="mt-2 rounded-lg border border-line p-2 text-[12px]">
          <div className="font-medium">{label(e.target)}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-muted">
            <select value={e.type ?? "text"} onChange={ev => updEdge(e.id, { type: ev.target.value as "text" | "audio" })} className="field !w-auto !py-0.5"><option value="text">text</option><option value="audio">audio</option></select>
            <label className="flex items-center gap-1">send back up to<input type="number" min={0} className="field !w-14 !py-0.5" value={e.max_loops ?? 0}
              onChange={ev => updEdge(e.id, { max_loops: Number(ev.target.value) || undefined })} />times</label></div></div>)}
        <p className="mt-2 text-[11px] text-faint">Above 0, this arrow is a feedback loop: it only fires when this node doesn&apos;t reply APPROVED.</p></div>}
    </div>
  );
}
