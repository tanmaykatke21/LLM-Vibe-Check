-- LLMSquad schema (Postgres + TimescaleDB)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- single local user for the hackathon
INSERT INTO users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'local@llmsquad.dev')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  description text,
  instructions text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text NOT NULL,
  task_type text NOT NULL DEFAULT 'general',   -- general | coding | audio
  test_cases jsonb,                             -- for coding: [{"input":..., "expected":...}] or {"code": "pytest source"}
  rubric jsonb,
  reference_output text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  parent_run_id uuid REFERENCES runs(id),
  forked_from_node text,
  status text NOT NULL DEFAULT 'queued',        -- queued | running | paused | done | failed
  graph_snapshot jsonb NOT NULL,
  final_output text,
  total_input_tokens int NOT NULL DEFAULT 0,
  total_output_tokens int NOT NULL DEFAULT 0,
  total_cost numeric(12,6) NOT NULL DEFAULT 0,
  total_latency_ms int NOT NULL DEFAULT 0,
  human_wait_ms int NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hypertable: one row per node execution (time-series of cost/latency)
CREATE TABLE IF NOT EXISTS node_results (
  ts timestamptz NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  node_id text NOT NULL,
  node_kind text NOT NULL,                      -- llm | tool | checkpoint
  role text,
  model_or_tool text,
  loop_index int NOT NULL DEFAULT 0,
  input text,
  output text,
  output_kind text NOT NULL DEFAULT 'text',     -- text | audio
  audio_path text,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cached_tokens int NOT NULL DEFAULT 0,
  units numeric(12,2),                          -- chars / audio seconds for tool nodes
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  reused_from_run_id uuid,
  status text NOT NULL DEFAULT 'done',          -- done | error | skipped
  error text,
  PRIMARY KEY (ts, id)
);
SELECT create_hypertable('node_results', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS node_results_run_idx ON node_results (run_id, ts);

-- Hypertable: inter-node messages (communication history)
CREATE TABLE IF NOT EXISTS messages (
  ts timestamptz NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  seq int NOT NULL,
  from_node text NOT NULL,
  to_node text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  content text,
  PRIMARY KEY (ts, id)
);
SELECT create_hypertable('messages', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS messages_run_idx ON messages (run_id, seq);

CREATE TABLE IF NOT EXISTS checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  node_id text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',       -- waiting | approved | edited | rejected | timed_out
  original_output text,
  edited_output text,
  reviewer_note text,
  wait_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS judge_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  node_id text,                                 -- NULL = final output
  accuracy_score numeric(4,1),
  did_its_job boolean,
  complete boolean,
  issues jsonb,
  rationale text,
  judge_model text,
  judge_cost_usd numeric(12,6) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS human_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  node_id text,
  rating int CHECK (rating BETWEEN 1 AND 5),
  complete boolean,
  feedback_text text,
  parsed_verdict jsonb,
  feedback_quality text,                        -- useful | vague | contradictory
  agrees_with_judge boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
  test_pass_rate numeric(5,4),
  final_judge_score numeric(4,1),
  human_score numeric(4,1),
  completion_status text,                       -- complete | partial | failed
  completion_reason text,
  interventions_count int NOT NULL DEFAULT 0,
  composite_score numeric(6,3),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Continuous aggregate: hourly cost/latency per model (powers analytics)
CREATE MATERIALIZED VIEW IF NOT EXISTS node_cost_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', ts) AS bucket,
       model_or_tool,
       count(*)            AS calls,
       sum(cost_usd)       AS cost_usd,
       avg(latency_ms)     AS avg_latency_ms,
       sum(input_tokens)   AS input_tokens,
       sum(output_tokens)  AS output_tokens
FROM node_results
GROUP BY bucket, model_or_tool
WITH NO DATA;
