"""Database-backed Store for the runner."""
import json
from app.core.runner import Store
from app.db.client import q

class DbStore(Store):
    async def save_node_result(self, r: dict):
        q("""insert into node_results (run_id,node_id,node_kind,role,model_or_tool,loop_index,input,output,output_kind,
             audio_path,input_tokens,output_tokens,cached_tokens,units,cost_usd,latency_ms,reused_from_run_id,status,error)
             values (%(run_id)s,%(node_id)s,%(node_kind)s,%(role)s,%(model_or_tool)s,%(loop_index)s,%(input)s,%(output)s,
             %(output_kind)s,%(audio_path)s,%(input_tokens)s,%(output_tokens)s,%(cached_tokens)s,%(units)s,%(cost_usd)s,
             %(latency_ms)s,%(reused_from_run_id)s,%(status)s,%(error)s)""", r)
    async def save_message(self, m: dict):
        q("insert into messages (run_id,seq,from_node,to_node,kind,content) values (%(run_id)s,%(seq)s,%(from_node)s,%(to_node)s,%(kind)s,%(content)s)", m)
    async def save_checkpoint(self, c: dict):
        if c.get("status") == "waiting":
            q("insert into checkpoints (run_id,node_id,status,original_output) values (%(run_id)s,%(node_id)s,'waiting',%(original_output)s)", c)
        else:
            q("""update checkpoints set status=%(status)s, edited_output=%(edited_output)s, reviewer_note=%(reviewer_note)s,
                 wait_ms=%(wait_ms)s, decided_at=now() where run_id=%(run_id)s and node_id=%(node_id)s and status='waiting'""", c)
    async def set_run_status(self, run_id: str, status: str, **fields):
        q("update runs set status=%s, started_at=coalesce(started_at, now()) where id=%s", (status, run_id))
    async def finish_run(self, run_id: str, t: dict):
        q("""update runs set status=%s, final_output=%s, total_input_tokens=%s, total_output_tokens=%s, total_cost=%s,
             total_latency_ms=%s, human_wait_ms=%s, error=%s, finished_at=now() where id=%s""",
          (t["status"], t.get("final_output"), t["input_tokens"], t["output_tokens"], round(t["cost"], 6),
           t["latency_ms"], t["human_wait_ms"], t.get("error"), run_id))
