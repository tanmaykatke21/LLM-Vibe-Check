import type { Graph } from "./api";

export const ROLES = ["planner", "executor", "reviewer", "debugger", "architect", "database manager", "data cleaner", "researcher", "writer", "verifier"];

export const ROLE_PROMPTS: Record<string, string> = {
  planner: "You are the planner. Break the task into clear, numbered steps with success criteria. Do not write the final deliverable.",
  executor: "You are the executor. Produce the actual deliverable (code, text, etc.) following the plan and any feedback.",
  reviewer: "You are the reviewer. Check the deliverable for correctness and completeness. If acceptable reply APPROVED on the first line; otherwise list concrete fixes.",
  debugger: "You are the debugger. Find bugs and edge-case failures in the code. If none, reply APPROVED on the first line; otherwise list each bug with a fix.",
  architect: "You are the architect. Define components, interfaces and data flow before implementation.",
  "database manager": "You design the schema and queries. Output SQL and a short rationale.",
  "data cleaner": "You clean and normalize the input data; describe transformations and output the cleaned result.",
  researcher: "You gather the facts and constraints needed, citing assumptions clearly.",
  writer: "You write the final prose deliverable clearly and concisely.",
  verifier: "You verify the final output against the task. Reply APPROVED on the first line if it fully satisfies the task; otherwise list what is missing.",
};

export const DEMO_MODELS = ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1"];

export function presetGraph(name: "linear" | "loop" | "checkpoint" | "audio"): Graph {
  const n = (id: string, role: string, model: string, x: number, label?: string) =>
    ({ id, kind: "llm" as const, role, model, label: label ?? role[0].toUpperCase() + role.slice(1), system_prompt: ROLE_PROMPTS[role], position: { x, y: 120 } });
  const e = (id: string, s: string, t: string, extra = {}) => ({ id, source: s, target: t, type: "text" as const, ...extra });
  switch (name) {
    case "linear": return { nodes: [n("p", "planner", DEMO_MODELS[0], 40), n("e", "executor", DEMO_MODELS[0], 320), n("r", "reviewer", DEMO_MODELS[0], 600)], edges: [e("1", "p", "e"), e("2", "e", "r")] };
    case "loop": return { nodes: [n("p", "planner", DEMO_MODELS[1], 40), n("e", "executor", DEMO_MODELS[0], 320), n("r", "reviewer", DEMO_MODELS[2], 600)],
      edges: [e("1", "p", "e"), e("2", "e", "r"), e("back", "r", "e", { max_loops: 2 })] };
    case "checkpoint": return { nodes: [n("p", "planner", DEMO_MODELS[1], 40), { id: "c", kind: "checkpoint", label: "Approve plan", position: { x: 320, y: 120 }, params: { timeout_minutes: 30, on_timeout: "approve" } }, n("e", "executor", DEMO_MODELS[0], 600)],
      edges: [e("1", "p", "c"), e("2", "c", "e")] };
    case "audio": return { nodes: [n("w", "writer", DEMO_MODELS[0], 40, "Script writer"),
      { id: "tts", kind: "tool", tool: "elevenlabs.tts", label: "ElevenLabs TTS", position: { x: 320, y: 120 }, params: { model: "eleven_flash_v2_5" } },
      { id: "stt", kind: "tool", tool: "elevenlabs.stt", label: "ElevenLabs STT", position: { x: 600, y: 120 }, params: { model: "scribe_v1" } },
      n("v", "verifier", DEMO_MODELS[0], 880)],
      edges: [e("1", "w", "tts"), { id: "2", source: "tts", target: "stt", type: "audio" }, e("3", "stt", "v")] };
  }
}
