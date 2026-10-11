export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const h = { "content-type": "application/json" };

export const api = {
  models: () => fetch(`${API}/models`).then(j<{ llms: { id: string }[]; tools: string[] }>),
  skills: () => fetch(`${API}/skills`).then(j<Skill[]>),
  createSkill: (b: Partial<Skill>) => fetch(`${API}/skills`, { method: "POST", headers: h, body: JSON.stringify(b) }).then(j<Skill>),
  tasks: () => fetch(`${API}/tasks`).then(j<Task[]>),
  createTask: (b: Partial<Task>) => fetch(`${API}/tasks`, { method: "POST", headers: h, body: JSON.stringify(b) }).then(j<Task>),
  sessions: () => fetch(`${API}/sessions`).then(j<Session[]>),
  session: (id: string) => fetch(`${API}/sessions/${id}`).then(j<Session>),
  createSession: (b: { name: string; graph: Graph }) => fetch(`${API}/sessions`, { method: "POST", headers: h, body: JSON.stringify(b) }).then(j<Session>),
  updateSession: (id: string, b: { name: string; graph: Graph }) => fetch(`${API}/sessions/${id}`, { method: "PUT", headers: h, body: JSON.stringify(b) }).then(j<Session>),
  validateGraph: (g: Graph) => fetch(`${API}/graph/validate`, { method: "POST", headers: h, body: JSON.stringify(g) }).then(j<{ valid: boolean; problems: string[] }>),
  repeat: (session_id: string, task_id: string, n: number) =>
    fetch(`${API}/runs/repeat`, { method: "POST", headers: h, body: JSON.stringify({ session_id, task_id, n }) }).then(j<{ runs: { id: string }[] }>),
  startRun: (session_id: string, task_id: string) => fetch(`${API}/runs`, { method: "POST", headers: h, body: JSON.stringify({ session_id, task_id }) }).then(j<Run>),
  runs: (task_id?: string) => fetch(`${API}/runs${task_id ? `?task_id=${task_id}` : ""}`).then(j<Run[]>),
  run: (id: string) => fetch(`${API}/runs/${id}`).then(j<Run>),
  nodes: (id: string) => fetch(`${API}/runs/${id}/nodes`).then(j<NodeResult[]>),
  messages: (id: string) => fetch(`${API}/runs/${id}/messages`).then(j<Message[]>),
  metrics: (id: string) => fetch(`${API}/runs/${id}/metrics`).then(j<Metrics>),
  decide: (id: string, node: string, b: { action: string; edited_output?: string; note?: string }) =>
    fetch(`${API}/runs/${id}/checkpoints/${node}`, { method: "POST", headers: h, body: JSON.stringify(b) }).then(j),
  evaluate: (id: string) => fetch(`${API}/runs/${id}/evaluate`, { method: "POST", headers: h, body: "{}" }).then(j<Evaluation>),
  evaluation: (id: string) => fetch(`${API}/runs/${id}/evaluation`).then(j<EvalData>),
  feedback: (id: string, b: { rating: number; complete?: boolean; feedback_text: string }) =>
    fetch(`${API}/runs/${id}/feedback`, { method: "POST", headers: h, body: JSON.stringify(b) }).then(j<Evaluation>),
  fork: (id: string, from_node_id: string, node_changes: Record<string, Record<string, unknown>>) =>
    fetch(`${API}/runs/${id}/fork`, { method: "POST", headers: h, body: JSON.stringify({ from_node_id, node_changes }) }).then(j<Run>),
  forks: (id: string) => fetch(`${API}/runs/${id}/forks`).then(j<{ root: string; runs: ForkRow[] }>),
  compare: (task_id: string, weights?: Record<string, number>) =>
    fetch(`${API}/compare`, { method: "POST", headers: h, body: JSON.stringify({ task_id, weights }) }).then(j<{ ranked: CompareRow[] }>),
  stream: (id: string) => new EventSource(`${API}/runs/${id}/stream`),
};

export type GNode = { id: string; kind: "llm" | "tool" | "checkpoint"; label?: string; role?: string; model?: string; tool?: string;
  system_prompt?: string; skill_ids?: string[]; params?: Record<string, unknown>; position?: { x: number; y: number } };
export type GEdge = { id: string; source: string; target: string; type?: "text" | "audio"; max_loops?: number };
export type Graph = { nodes: GNode[]; edges: GEdge[] };
export type Skill = { id: string; name: string; description?: string; instructions: string };
export type Task = { id: string; title: string; description: string; task_type: string; test_cases?: unknown; rubric?: unknown };
export type Session = { id: string; name: string; graph: Graph; updated_at: string };
export type Run = { id: string; session_id: string; task_id: string; status: string; final_output?: string; total_cost: string | number;
  total_latency_ms: number; total_input_tokens: number; total_output_tokens: number; human_wait_ms: number; error?: string;
  parent_run_id?: string; forked_from_node?: string; graph_snapshot: Graph; session_name?: string; task_title?: string; created_at: string };
export type NodeResult = { node_id: string; role?: string; node_kind: string; model_or_tool: string; loop_index: number; input?: string; output?: string;
  output_kind: string; audio_path?: string; input_tokens: number; output_tokens: number; cost_usd: string | number; latency_ms: number; status: string; error?: string; reused_from_run_id?: string; ts: string };
export type Message = { seq: number; from_node: string; to_node: string; kind: string; content?: string; ts: string };
export type Metrics = { status: string; nodes: { node_id: string; role?: string; node_kind: string; model_or_tool: string; calls: number; input_tokens: number;
  output_tokens: number; cost_usd: string | number; latency_ms: number; cost_share: number; time_share: number; reused: boolean }[];
  totals: { input_tokens: number; output_tokens: number; cost_usd: number; wall_clock_ms: number; human_wait_ms: number; sum_node_latency_ms: number; judge_cost_usd: number };
  projection: { per_1k_runs_usd: number } };
export type Evaluation = { completion_status: string; completion_reason: string; composite_score: number;
  judge_report?: { nodes: { node_id: string; accuracy_score: number; did_its_job: boolean; issues: string[]; rationale: string }[];
    final: { accuracy_score: number; complete: boolean; missing: string[]; rationale: string } };
  feedback?: { parsed_verdict: Record<string, unknown> } };
export type JudgeRow = { node_id?: string; accuracy_score?: number; did_its_job?: boolean; complete?: boolean; issues?: string[]; rationale?: string; judge_model?: string; judge_cost_usd?: string | number };
export type EvalData = { evaluation?: { completion_status: string; completion_reason: string; composite_score: number; test_pass_rate?: number };
  judge: JudgeRow[];
  judge_panel?: JudgeRow[];
  human: { rating: number; feedback_text: string; feedback_quality?: string; agrees_with_judge?: boolean; parsed_verdict?: Record<string, unknown> }[] };
export type ForkRow = { id: string; parent_run_id?: string; forked_from_node?: string; status: string; total_cost: string; depth: number; composite_score?: number; completion_status?: string };
export type CompareNode = { node_id: string; role: string; node_kind: string; model_or_tool: string; calls: number; max_loop: number;
  input_tokens: number; output_tokens: number; cost_usd: string | number; latency_ms: number; reused: boolean };
export type CompareRow = { id: string; session_id: string; session_name: string; status: string; total_cost: string | number; total_latency_ms: number;
  total_input_tokens?: number; total_output_tokens?: number; human_wait_ms?: number; created_at?: string; composite_score?: number;
  completion_status?: string; final_judge_score?: number; test_pass_rate?: number; human_score?: number; interventions_count?: number;
  forked_from_node?: string; quality_score?: number | null; cost_score?: number; speed_score?: number; effort_score?: number;
  judge_spread?: number | string | null; judge_count?: number; nodes?: CompareNode[]; models?: string[]; llm_calls?: number; loops_used?: number };

export const fmt$ = (v: string | number | undefined) => `$${Number(v ?? 0).toFixed(5)}`;
export const fmtMs = (ms: number | undefined) => (ms ?? 0) >= 1000 ? `${((ms ?? 0) / 1000).toFixed(1)}s` : `${ms ?? 0}ms`;
