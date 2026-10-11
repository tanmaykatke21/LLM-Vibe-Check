"""What each LLM node is told (app/core/prompts.py)."""
from app.core.prompts import build_prompt, APPROVE_TOKEN

TASK = {"description": "Parse durations", "rubric": "Correct totals"}

def test_task_and_rubric_always_included():
    p = build_prompt({"role": "planner"}, TASK, [], [])
    assert p.startswith("# Task\nParse durations") and "# Success criteria\nCorrect totals" in p

def test_reviewer_is_told_how_to_approve():
    p = build_prompt({"role": "reviewer"}, TASK, [], [])
    assert APPROVE_TOKEN in p and "Otherwise list concrete fixes" in p

def test_non_reviewer_is_not_told_to_approve():
    p = build_prompt({"role": "executor"}, TASK, [], [])
    assert APPROVE_TOKEN not in p and "Be concise and complete" in p

def test_skills_inputs_and_revision_note_are_included():
    skills = [{"name": "Python style", "instructions": "Use type hints"}]
    inputs = [{"from_label": "Planner", "from_role": "planner", "content": "step 1", "kind": "text"},
              {"from_label": "TTS", "from_role": "tool", "content": "/audio/x.mp3", "kind": "audio"}]
    p = build_prompt({"role": "executor"}, TASK, inputs, skills, loop_note="Feedback: add tests")
    assert "## Python style\nUse type hints" in p
    assert "## From Planner (planner)\nstep 1" in p
    assert "## From TTS (audio file)\n/audio/x.mp3" in p
    assert "# Revision requested\nFeedback: add tests" in p

def test_no_rubric_section_when_task_has_none():
    assert "Success criteria" not in build_prompt({"role": "x"}, {"description": "d"}, [], [])
