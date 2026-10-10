from pydantic import BaseModel, Field
from typing import Any, Optional

LOCAL_USER = "00000000-0000-0000-0000-000000000001"

class SessionIn(BaseModel):
    name: str
    graph: dict[str, Any]

class TaskIn(BaseModel):
    title: str
    description: str
    task_type: str = "general"
    test_cases: Optional[Any] = None
    rubric: Optional[Any] = None
    reference_output: Optional[str] = None

class SkillIn(BaseModel):
    name: str
    description: Optional[str] = None
    instructions: str

class RunIn(BaseModel):
    session_id: str
    task_id: str

class CheckpointDecision(BaseModel):
    action: str = Field(pattern="^(approve|edit|reject)$")
    edited_output: Optional[str] = None
    note: Optional[str] = None

class ForkIn(BaseModel):
    from_node_id: str
    node_changes: dict[str, dict[str, Any]] = {}   # node_id -> fields to override

class FeedbackIn(BaseModel):
    node_id: Optional[str] = None
    rating: int = Field(ge=1, le=5)
    complete: Optional[bool] = None
    feedback_text: str = ""
