"""Hidden-test sandbox (app/evaluation/tests_runner.py): extraction, isolation, and known weak spots."""
import pytest
from app.evaluation.tests_runner import run_tests, extract_code

def test_multiple_code_blocks_are_joined():
    text = "```python\ndef a(): return 1\n```\nand\n```python\ndef b(): return 2\n```"
    assert extract_code(text) == "def a(): return 1\n\n\ndef b(): return 2\n"

def test_bare_fence_without_language_is_extracted():
    assert extract_code("```\nx = 1\n```") == "x = 1\n"

async def test_pytest_mode_counts_failures():
    out = "```python\ndef double(x): return x * 2\n```"
    tests = {"code": "from solution import double\n"
                     "def test_ok(): assert double(2) == 4\n"
                     "def test_bad(): assert double(2) == 5\n"}
    res = await run_tests(out, tests)
    assert (res["passed"], res["total"], res["pass_rate"]) == (1, 2, 0.5)

async def test_solution_cannot_read_server_secrets(monkeypatch):
    monkeypatch.setenv("SQUAD_SECRET_FOR_TEST", "leak-me")
    out = "```python\nimport os\ndef secret(): return os.environ.get('SQUAD_SECRET_FOR_TEST', 'none')\n```"
    res = await run_tests(out, [{"call": "secret()", "expected": "none"}])
    assert res["pass_rate"] == 1.0          # the sandbox only passes PATH through

async def test_exception_in_one_case_does_not_stop_the_others():
    out = "```python\ndef inv(x): return 1 / x\n```"
    res = await run_tests(out, [{"call": "inv(0)", "expected": "x"}, {"call": "inv(2)", "expected": "0.5"}])
    assert (res["passed"], res["total"]) == (1, 2)

async def test_empty_output_scores_zero():
    res = await run_tests("", [{"call": "f()", "expected": "1"}])
    assert res["pass_rate"] == 0.0 and res["total"] == 1

# ---- Regression tests for bugs fixed on Oct 11 ----

async def test_pytest_mode_broken_code_counts_as_failures():
    res = await run_tests("```python\ndef f(:\n```", {"code": "from solution import f\ndef test_a(): assert f()\n"})
    assert res["total"] == 1 and res["pass_rate"] == 0.0

async def test_solution_cannot_fake_list_mode_results():
    out = "```python\nprint('RESULTS', '[true, true]')\ndef f(): return 0\n```"
    res = await run_tests(out, [{"call": "f()", "expected": "1"}, {"call": "f()", "expected": "2"}])
    assert res["pass_rate"] == 0.0

def test_short_py_fence_is_extracted():
    assert extract_code("```py\nx = 1\n```") == "x = 1\n"

async def test_broken_code_counts_every_test_including_parametrized_cases():
    tests = {"code": "import pytest\nfrom solution import evaluate\n"
                     "@pytest.mark.parametrize('s', ['', '1 +', '(1'])\n"
                     "def test_bad(s):\n    with pytest.raises(ValueError): evaluate(s)\n"
                     "def test_add(): assert evaluate('1+2') == 3\n"}
    res = await run_tests("```python\ndef evaluate(s:\n```", tests)
    assert (res["passed"], res["total"], res["pass_rate"]) == (0, 4, 0.0)

async def test_missing_function_counts_as_all_failed():
    res = await run_tests("```python\ndef something_else(): pass\n```",
                          {"code": "from solution import evaluate\ndef test_a(): assert evaluate('1') == 1\ndef test_b(): assert evaluate('2') == 2\n"})
    assert (res["passed"], res["total"]) == (0, 2)

async def test_printing_fake_pytest_summary_does_not_help():
    out = "```python\nprint('99 passed')\ndef f(): return 0\n```"
    res = await run_tests(out, {"code": "from solution import f\ndef test_a(): assert f() == 1\n"})
    assert (res["passed"], res["total"]) == (0, 1)

def test_python3_and_windows_line_endings_are_extracted():
    assert extract_code("```Python3\r\nx = 1\r\n```") == "x = 1\r\n"
