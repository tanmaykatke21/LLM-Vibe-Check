"""Run user-supplied test cases against code in the final output, in a sandboxed subprocess."""
import asyncio, json, re, secrets, sys, tempfile, os
import xml.etree.ElementTree as ET
from pathlib import Path

# ```python / ```py / ```python3 / bare ``` fences, any case, Unix or Windows line endings
_FENCE = re.compile(r"```(?:python3?|py)?[ \t]*\r?\n(.*?)```", re.S | re.I)

# Stand-in for solution.py used only to COUNT tests when the real code doesn't import:
# every name imported from it exists, so pytest can collect (not pass) every test.
_STUB_SOLUTION = "def __getattr__(name):\n    return lambda *a, **k: None\n"

def extract_code(text: str) -> str:
    blocks = _FENCE.findall(text or "")
    return "\n\n".join(blocks) if blocks else (text or "")

async def _run(cmd: list[str], cwd: str, timeout: int = 30) -> str | None:
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"}   # no API keys reach the solution
    proc = await asyncio.create_subprocess_exec(*cmd, cwd=cwd, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, env=env)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return None
    return out.decode(errors="replace")

def _junit_counts(path: Path) -> tuple[int, int, bool] | None:
    """(passed, total, collection_failed) from a pytest JUnit XML report."""
    if not path.exists():
        return None
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    tests = sum(int(s.get("tests", 0)) for s in suites)
    bad = sum(int(s.get("failures", 0)) + int(s.get("errors", 0)) + int(s.get("skipped", 0)) for s in suites)
    collection_failed = any(e.get("message") == "collection failure" for e in root.iter("error"))
    return max(tests - bad, 0), tests, collection_failed

async def _pytest_mode(d: str, test_code: str) -> dict:
    Path(d, "test_solution.py").write_text(test_code)
    report = Path(d, f"report_{secrets.token_hex(8)}.xml")
    base = [sys.executable, "-E", "-s", "-m", "pytest", "-q", "test_solution.py", "-p", "no:cacheprovider"]
    text = await _run(base + [f"--junitxml={report.name}"], d)
    if text is None:
        return {"pass_rate": 0.0, "passed": 0, "total": 0, "log": "timeout"}
    counts = _junit_counts(report)
    if counts is None:
        return {"pass_rate": 0.0, "passed": 0, "total": 0, "log": text[-2000:]}
    passed, total, collection_failed = counts
    if collection_failed:
        # The solution didn't import (syntax error, missing function...). Every test counts as failed:
        # count them by collecting against a stand-in solution module.
        Path(d, "solution.py").write_text(_STUB_SOLUTION)
        collected = await _run(base + ["--collect-only"], d) or ""
        m = re.search(r"(\d+) tests? collected", collected)
        passed, total = 0, int(m.group(1)) if m else max(total, 1)
    return {"pass_rate": (passed / total) if total else 0.0, "passed": passed, "total": total, "log": text[-2000:]}

async def _cases_mode(d: str, test_cases: list) -> dict:
    # A random marker only the harness knows, so code that prints a fake "RESULTS [...]" line is ignored.
    marker = f"RESULTS_{secrets.token_hex(12)}"
    lines = ["import json, sys", "res=[]", "try:", "    from solution import *", "except Exception:", "    pass"]
    for tc in test_cases:
        lines.append(f"""
try:
    out = {tc['call']}
    res.append(str(out) == {tc['expected']!r})
except Exception as e:
    res.append(False)""")
    lines.append(f"print({marker!r}, json.dumps(res))")
    Path(d, "run_cases.py").write_text("\n".join(lines))
    text = await _run([sys.executable, "-E", "-s", "run_cases.py"], d)
    total = len(test_cases)
    if text is None:
        return {"pass_rate": 0.0, "passed": 0, "total": total, "log": "timeout"}
    found = re.findall(re.escape(marker) + r" (\[.*\])", text)
    res = json.loads(found[-1]) if found else []
    if len(res) != total:            # missing or tampered output: count nothing as passed
        res = [False] * total
    passed = sum(1 for x in res if x is True)
    return {"pass_rate": (passed / total) if total else 0.0, "passed": passed, "total": total, "log": text[-2000:]}

async def run_tests(final_output: str, test_cases) -> dict:
    """test_cases: {"code": "<pytest source that imports from solution>"}  or  [{"call": "parse_date('2024-01-05')", "expected": "2024-01-05"}]"""
    code = extract_code(final_output)
    with tempfile.TemporaryDirectory() as d:
        Path(d, "solution.py").write_text(code)
        if isinstance(test_cases, dict) and test_cases.get("code"):
            return await _pytest_mode(d, test_cases["code"])
        return await _cases_mode(d, list(test_cases or []))
