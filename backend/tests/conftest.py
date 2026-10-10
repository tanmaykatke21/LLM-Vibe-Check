import asyncio, pytest
from app.providers.base import Provider, NodeResult

class FakeProvider(Provider):
    """Deterministic provider: echoes role. Reviewer approves on 2nd look."""
    calls: list = []
    def __init__(self, node): self.node = node
    async def run(self, node, prompt, inputs):
        FakeProvider.calls.append((node["id"], prompt))
        role = node.get("role", "")
        n_reviews = sum(1 for c in FakeProvider.calls if c[0] == node["id"])
        if role == "reviewer":
            out = "APPROVED fine" if n_reviews >= 2 else "Fix: add input validation"
        else:
            out = f"{role} output v{sum(1 for c in FakeProvider.calls if c[0]==node['id'])}"
        return NodeResult(output=out, input_tokens=100, output_tokens=50, cost_usd=0.001, latency_ms=5,
                          model_or_tool=node.get("model", "fake"))

@pytest.fixture(autouse=True)
def _reset():
    FakeProvider.calls = []
    yield

@pytest.fixture
def fake_factory():
    return lambda node: FakeProvider(node)

@pytest.fixture
def task():
    return {"id": "t1", "description": "Write a function that parses dates", "rubric": None}

@pytest.fixture
def linear_graph():
    return {"nodes": [
        {"id": "p", "kind": "llm", "role": "planner", "model": "m1", "label": "Planner"},
        {"id": "e", "kind": "llm", "role": "executor", "model": "m2", "label": "Executor"},
        {"id": "r", "kind": "llm", "role": "reviewer", "model": "m3", "label": "Reviewer"},
    ], "edges": [
        {"id": "e1", "source": "p", "target": "e", "type": "text"},
        {"id": "e2", "source": "e", "target": "r", "type": "text"},
    ]}
