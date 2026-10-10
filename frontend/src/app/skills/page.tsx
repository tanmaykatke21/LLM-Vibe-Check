"use client";
import { useEffect, useState } from "react";
import { api, type Skill } from "@/lib/api";

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]); const [f, setF] = useState({ name: "", description: "", instructions: "" });
  useEffect(() => { api.skills().then(setSkills); }, []);
  const create = async () => { const s = await api.createSkill(f); setSkills([s, ...skills]); setF({ name: "", description: "", instructions: "" }); };
  return (
    <main className="p-6 max-w-3xl mx-auto text-sm">
      <h1 className="font-semibold text-lg">Skills</h1><p className="text-gray-500 text-xs">Reusable instruction blocks. Attach them to any LLM node in the Builder.</p>
      <div className="mt-4 border rounded p-3 space-y-2"><input className="w-full border rounded px-2 py-1" placeholder="Name (e.g. Python style guide)" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <input className="w-full border rounded px-2 py-1" placeholder="Short description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <textarea className="w-full border rounded px-2 py-1" rows={5} placeholder="Instructions the model must follow…" value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} />
        <button onClick={create} disabled={!f.name || !f.instructions} className="bg-black text-white rounded px-3 py-1 disabled:opacity-40">Add skill</button></div>
      <ul className="mt-4 space-y-2">{skills.map(s => <li key={s.id} className="border rounded p-3"><b>{s.name}</b> <span className="text-gray-500">{s.description}</span><pre className="mt-1 text-xs whitespace-pre-wrap text-gray-700">{s.instructions}</pre></li>)}</ul>
    </main>
  );
}
