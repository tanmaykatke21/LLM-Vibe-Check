"""Build the prompt an LLM node receives."""
APPROVE_TOKEN = "APPROVED"

def build_prompt(node: dict, task: dict, inputs: list[dict], skills: list[dict], loop_note: str | None = None) -> str:
    parts = [f"# Task\n{task['description']}"]
    if task.get("rubric"):
        parts.append(f"# Success criteria\n{task['rubric']}")
    if skills:
        parts.append("# Skills you must apply\n" + "\n\n".join(f"## {s['name']}\n{s['instructions']}" for s in skills))
    if inputs:
        blocks = []
        for i in inputs:
            if i.get("kind") == "audio":
                blocks.append(f"## From {i['from_label']} (audio file)\n{i['content']}")
            else:
                blocks.append(f"## From {i['from_label']} ({i['from_role']})\n{i['content']}")
        parts.append("# Inputs from your teammates\n" + "\n\n".join(blocks))
    if loop_note:
        parts.append(f"# Revision requested\n{loop_note}")
    role = node.get("role", "assistant")
    parts.append(f"# Your role: {role}\nDo your part only. "
                 + ("If you are reviewing/verifying and the work is acceptable, reply with the single word "
                    f"{APPROVE_TOKEN} on the first line, then brief notes. Otherwise list concrete fixes."
                    if role in ("reviewer", "verifier", "critic", "debugger") else "Be concise and complete."))
    return "\n\n".join(parts)
