"use client";
import { useEffect, useState } from "react";
import { Button, Empty, Panel } from "@/components/ui";
import { api, type Skill } from "@/lib/api";

const BLANK = { name: "", description: "", instructions: "" };

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]); const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState(BLANK); const [err, setErr] = useState("");
  const load = () => api.skills().then(setSkills).catch(() => {});
  useEffect(() => { load(); }, []);
  const create = async () => { await api.createSkill(f); setF(BLANK); load(); };
  const save = async (id: string) => { await api.updateSkill(id, draft); setEditing(null); load(); };
  const remove = async (id: string) => { setErr(""); try { await api.deleteSkill(id); load(); } catch (e) { setErr((e as Error).message); } };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <h1 className="text-[24px] font-semibold tracking-tight">Skills</h1>
      <p className="mt-1 text-muted">Reusable instructions, like a style guide or a checklist, that you can attach to any model in a squad.</p>

      <Panel className="mt-6 p-4">
        <h2 className="font-semibold">New skill</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input className="field" placeholder="Name, e.g. Python style guide" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <input className="field" placeholder="One-line description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        </div>
        <textarea className="field mt-2 font-mono text-[12px]" rows={5} placeholder="Instructions the model must follow, e.g. Use type hints and docstrings." value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} />
        <Button className="mt-2" variant="primary" onClick={create} disabled={!f.name || !f.instructions}>Add skill</Button>
      </Panel>

      {err && <p role="alert" className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{err}</p>}
      <div className="mt-6 space-y-3">
        {skills.length === 0 && <Empty title="No skills yet">Add one above, then tick it on a node in the builder.</Empty>}
        {skills.map(s => (
          <Panel key={s.id} className="p-4">
            {editing === s.id ? <>
              <div className="grid gap-2 md:grid-cols-2"><input className="field" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                <input className="field" value={draft.description} placeholder="One-line description" onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
              <textarea className="field mt-2 font-mono text-[12px]" rows={5} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} />
              <div className="mt-2 flex gap-2"><Button variant="primary" onClick={() => save(s.id)} disabled={!draft.name || !draft.instructions}>Save changes</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
            </> : <>
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="font-semibold">{s.name}</h2>{s.description && <p className="text-[13px] text-muted">{s.description}</p>}</div>
                <div className="flex shrink-0 gap-1"><Button size="sm" variant="ghost" onClick={() => { setEditing(s.id); setDraft({ name: s.name, description: s.description ?? "", instructions: s.instructions }); }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>Delete</Button></div>
              </div>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-[12px] text-ink">{s.instructions}</pre>
            </>}
          </Panel>))}
      </div>
    </main>
  );
}

