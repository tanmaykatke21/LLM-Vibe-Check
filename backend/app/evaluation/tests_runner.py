"""Run user-supplied test cases against code in the final output, in a sandboxed subprocess."""
import asyncio, re, tempfile, textwrap, os, sys
from pathlib import Path

def extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:python)?\n(.*?)```", text or "", re.S)
    return "\n\n".join(blocks) if blocks else (text or "")

async def run_tests(final_output: str, test_cases) -> dict:
    """test_cases: {"code": "<pytest source that imports from solution>"}  or  [{"call": "parse_date('2024-01-05')", "expected": "2024-01-05"}]"""
    code = extract_code(final_output)
    with tempfile.TemporaryDirectory() as d:
        Path(d, "solution.py").write_text(code)
        if isinstance(test_cases, dict) and test_cases.get("code"):
            Path(d, "test_solution.py").write_text(test_cases["code"])
            cmd = [sys.executable, "-E", "-s", "-m", "pytest", "-q", "test_solution.py", "-p", "no:cacheprovider"]
        else:
            lines = ["from solution import *", "import json, sys", "res=[]"]
            for i, tc in enumerate(test_cases or []):
                lines.append(f"""
try:
    out = {tc['call']}
    res.append(str(out) == {tc['expected']!r})
except Exception as e:
    res.append(False)""")
            lines.append("print('RESULTS', json.dumps(res))")
            Path(d, "run_cases.py").write_text("\n".join(lines))
            cmd = [sys.executable, "-E", "-s", "run_cases.py"]
        env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"}
        try:
            proc = await asyncio.create_subprocess_exec(*cmd, cwd=d, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env)
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
            text = out.decode(errors="replace")
        except asyncio.TimeoutError:
            return {"pass_rate": 0.0, "passed": 0, "total": 0, "log": "timeout"}
    m = re.search(r"RESULTS (\[.*\])", text)
    if not m and not isinstance(test_cases, dict):
        return {"pass_rate": 0.0, "passed": 0, "total": len(test_cases or []), "log": text[-2000:]}
    if m:
        import json; res = json.loads(m.group(1))
        return {"pass_rate": (sum(res) / len(res)) if res else 0.0, "passed": sum(res), "total": len(res), "log": text[-2000:]}
    p = re.search(r"(\d+) passed", text); f = re.search(r"(\d+) failed", text)
    passed = int(p.group(1)) if p else 0; failed = int(f.group(1)) if f else 0
    total = passed + failed
    return {"pass_rate": (passed / total) if total else 0.0, "passed": passed, "total": total, "log": text[-2000:]}
