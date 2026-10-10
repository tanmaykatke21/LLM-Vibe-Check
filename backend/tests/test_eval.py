import pytest
from app.evaluation.tests_runner import run_tests, extract_code
from app.core.fork import _upstream

def test_extract_code_from_fences():
    assert extract_code("here\n```python\nx=1\n```\nbye") == "x=1\n"
    assert extract_code("plain") == "plain"

async def test_run_cases_pass_and_fail():
    out = "```python\ndef add(a,b): return a+b\n```"
    res = await run_tests(out, [{"call": "add(1,2)", "expected": "3"}, {"call": "add(2,2)", "expected": "5"}])
    assert res["total"] == 2 and res["passed"] == 1 and res["pass_rate"] == 0.5

async def test_pytest_source_mode():
    out = "```python\ndef parse(s): return s.strip()\n```"
    res = await run_tests(out, {"code": "from solution import parse\ndef test_a(): assert parse(' x ')=='x'\ndef test_b(): assert parse('y')=='y'"})
    assert res["total"] == 2 and res["pass_rate"] == 1.0

async def test_broken_code_gives_zero():
    res = await run_tests("```python\ndef f(:\n```", [{"call": "f()", "expected": "1"}])
    assert res["pass_rate"] == 0.0

def test_upstream_is_transitive(linear_graph):
    assert _upstream(linear_graph, "r") == {"p", "e"}
    assert _upstream(linear_graph, "p") == set()
