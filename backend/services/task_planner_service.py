"""
Task Planner Service - Decomposes complex tasks into sequential sub-goals.

This service uses an LLM to break down complex browser automation tasks
into manageable sub-goals with dependencies, enabling truly autonomous
multi-step information finding.
"""

import logging
import json
import uuid
from typing import List, Dict, Any, Optional, Literal
from dataclasses import dataclass, field, asdict
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config

logger = logging.getLogger(__name__)


@dataclass
class SubGoal:
    """A sub-goal within a larger task"""
    id: str
    description: str
    status: Literal["pending", "in_progress", "completed", "failed"] = "pending"
    parent_id: Optional[str] = None
    dependencies: List[str] = field(default_factory=list)
    expected_result: str = ""
    result: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "id": self.id,
            "description": self.description,
            "status": self.status,
            "parent_id": self.parent_id,
            "dependencies": self.dependencies,
            "expected_result": self.expected_result,
            "result": self.result,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SubGoal":
        """Create from dictionary"""
        return cls(
            id=data["id"],
            description=data["description"],
            status=data.get("status", "pending"),
            parent_id=data.get("parent_id"),
            dependencies=data.get("dependencies", []),
            expected_result=data.get("expected_result", ""),
            result=data.get("result"),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None
        )


@dataclass
class TaskPlan:
    """A complete task plan with sub-goals"""
    task_id: str
    original_task: str
    goals: List[SubGoal]
    created_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "original_task": self.original_task,
            "goals": [g.to_dict() for g in self.goals],
            "created_at": self.created_at.isoformat()
        }


class TaskPlannerService:
    """
    Service for decomposing complex tasks into sub-goals.
    
    Uses LLM to intelligently break down tasks like:
    - "Find London vs Manchester property prices" -> multiple search + extract goals
    - "Research competitors and create summary" -> browse + collect + synthesize goals
    """
    
    def __init__(self):
        self.plans: Dict[str, TaskPlan] = {}  # session_id -> TaskPlan
        self.llm = None
    
    def _get_llm(self) -> ChatOpenAI:
        """Lazy-load LLM"""
        if self.llm is None:
            self.llm = ChatOpenAI(
                api_key=config.openai_api_key,
                model="gpt-4o-mini",
                temperature=0,
                timeout=30
            )
        return self.llm
    
    async def decompose_task(self, task: str) -> List[SubGoal]:
        """
        Use LLM to decompose a complex task into sequential sub-goals.
        
        Args:
            task: The original task description
            
        Returns:
            List of SubGoal objects with dependencies
        """
        logger.info(f"🎯 [TASK_PLANNER] Decomposing task: {task[:100]}...")
        
        system_prompt = """You are a task planning agent for browser automation. Your job is to break down complex information-finding tasks into sequential, achievable sub-goals.

RULES:
1. Each sub-goal should be achievable in 3-5 browser actions (navigate, click, type, extract)
2. Identify dependencies between goals (which goals must complete before others)
3. Include explicit "extract data" goals - not just navigation
4. If the task involves comparison, the final goal should synthesize/compare findings
5. Keep goals specific and measurable
6. For search tasks, separate "search for X" from "extract X data"

GOAL TYPES:
- NAVIGATE: Go to a specific website or search for something
- EXTRACT: Pull specific data from the current page
- COMPARE: Synthesize information from multiple sources
- VERIFY: Confirm information is correct

Output valid JSON only, no markdown:
{
  "goals": [
    {
      "id": "g1",
      "description": "Clear description of what to do",
      "dependencies": [],
      "expected_result": "What success looks like"
    },
    {
      "id": "g2", 
      "description": "...",
      "dependencies": ["g1"],
      "expected_result": "..."
    }
  ]
}

EXAMPLES:

Task: "Find the average house price in London"
Goals:
1. Search Google for "average house price London 2024" (deps: [])
2. Navigate to a reliable source like Rightmove or ONS (deps: [g1])
3. Extract the average price figure and source (deps: [g2])

Task: "Compare iPhone 15 vs Samsung S24 prices"
Goals:
1. Search for iPhone 15 price (deps: [])
2. Extract iPhone 15 price from a reliable retailer (deps: [g1])
3. Search for Samsung S24 price (deps: [])
4. Extract Samsung S24 price from a reliable retailer (deps: [g3])
5. Compare the two prices and summarize findings (deps: [g2, g4])"""

        human_prompt = f"""Break down this task into sub-goals:

TASK: {task}

Return JSON with the goals array."""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt)
            ])
            
            result_text = response.content.strip()
            
            # Handle markdown code blocks if present
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                # Remove first and last lines (```json and ```)
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
                if result_text.startswith('json'):
                    result_text = result_text[4:].strip()
            
            # Parse JSON
            data = json.loads(result_text)
            goals_data = data.get("goals", [])
            
            # Convert to SubGoal objects
            goals = []
            for g in goals_data:
                goal = SubGoal(
                    id=g.get("id", f"g{len(goals)+1}"),
                    description=g.get("description", ""),
                    dependencies=g.get("dependencies", []),
                    expected_result=g.get("expected_result", "")
                )
                goals.append(goal)
            
            logger.info(f"🎯 [TASK_PLANNER] Decomposed into {len(goals)} sub-goals")
            for g in goals:
                logger.info(f"  - {g.id}: {g.description[:50]}... (deps: {g.dependencies})")
            
            return goals
            
        except json.JSONDecodeError as e:
            logger.error(f"🎯 [TASK_PLANNER] JSON parse error: {e}")
            # Return a simple single-goal fallback
            return [SubGoal(
                id="g1",
                description=task,
                expected_result="Complete the requested task"
            )]
        except Exception as e:
            logger.error(f"🎯 [TASK_PLANNER] Error decomposing task: {e}")
            return [SubGoal(
                id="g1", 
                description=task,
                expected_result="Complete the requested task"
            )]
    
    def create_plan(self, session_id: str, task: str, goals: List[SubGoal]) -> TaskPlan:
        """
        Create and store a task plan for a session.
        
        Args:
            session_id: Unique session identifier
            task: Original task description
            goals: List of sub-goals from decompose_task
            
        Returns:
            TaskPlan object
        """
        plan = TaskPlan(
            task_id=str(uuid.uuid4()),
            original_task=task,
            goals=goals
        )
        self.plans[session_id] = plan
        logger.info(f"🎯 [TASK_PLANNER] Created plan for session {session_id} with {len(goals)} goals")
        return plan
    
    def get_plan(self, session_id: str) -> Optional[TaskPlan]:
        """Get the task plan for a session"""
        return self.plans.get(session_id)
    
    def get_current_goal(self, session_id: str) -> Optional[SubGoal]:
        """
        Get the current active sub-goal for a session.
        
        Returns the first goal that:
        1. Is not completed or failed
        2. Has all dependencies completed
        
        Args:
            session_id: Session identifier
            
        Returns:
            Current SubGoal or None if all complete
        """
        plan = self.plans.get(session_id)
        if not plan:
            return None
        
        completed_ids = {g.id for g in plan.goals if g.status == "completed"}
        
        for goal in plan.goals:
            if goal.status in ("completed", "failed"):
                continue
            
            # Check if all dependencies are met
            deps_met = all(dep_id in completed_ids for dep_id in goal.dependencies)
            if deps_met:
                # Mark as in_progress if not already
                if goal.status == "pending":
                    goal.status = "in_progress"
                    goal.started_at = datetime.now()
                return goal
        
        return None  # All goals complete
    
    def mark_goal_complete(
        self, 
        session_id: str, 
        goal_id: str, 
        result: Optional[str] = None
    ) -> bool:
        """
        Mark a sub-goal as complete.
        
        Args:
            session_id: Session identifier
            goal_id: Goal to mark complete
            result: Optional result summary
            
        Returns:
            True if successful
        """
        plan = self.plans.get(session_id)
        if not plan:
            return False
        
        for goal in plan.goals:
            if goal.id == goal_id:
                goal.status = "completed"
                goal.completed_at = datetime.now()
                goal.result = result
                logger.info(f"🎯 [TASK_PLANNER] Goal {goal_id} completed: {result or 'No result'}")
                return True
        
        return False
    
    def mark_goal_failed(
        self, 
        session_id: str, 
        goal_id: str, 
        reason: str
    ) -> bool:
        """Mark a sub-goal as failed"""
        plan = self.plans.get(session_id)
        if not plan:
            return False
        
        for goal in plan.goals:
            if goal.id == goal_id:
                goal.status = "failed"
                goal.completed_at = datetime.now()
                goal.result = f"FAILED: {reason}"
                logger.warning(f"🎯 [TASK_PLANNER] Goal {goal_id} failed: {reason}")
                return True
        
        return False
    
    def get_progress(self, session_id: str) -> Dict[str, Any]:
        """
        Get progress summary for a session.
        
        Returns:
            Dict with completed/total counts and current goal info
        """
        plan = self.plans.get(session_id)
        if not plan:
            return {"completed": 0, "total": 0, "current_goal": None}
        
        completed = sum(1 for g in plan.goals if g.status == "completed")
        failed = sum(1 for g in plan.goals if g.status == "failed")
        current = self.get_current_goal(session_id)
        
        return {
            "completed": completed,
            "failed": failed,
            "total": len(plan.goals),
            "current_goal": current.to_dict() if current else None,
            "all_complete": completed + failed >= len(plan.goals)
        }
    
    async def replan(self, session_id: str, reason: str) -> List[SubGoal]:
        """
        Re-decompose remaining goals when stuck.
        
        Creates new sub-goals for incomplete portions of the task,
        taking into account what has already been accomplished.
        
        Args:
            session_id: Session identifier
            reason: Why replanning is needed
            
        Returns:
            New list of goals
        """
        plan = self.plans.get(session_id)
        if not plan:
            return []
        
        # Get completed goals and their results
        completed_info = []
        incomplete_goals = []
        
        for goal in plan.goals:
            if goal.status == "completed":
                completed_info.append(f"✓ {goal.description}: {goal.result or 'Done'}")
            elif goal.status != "failed":
                incomplete_goals.append(goal.description)
        
        if not incomplete_goals:
            return plan.goals  # All done
        
        # Create new task incorporating context
        new_task = f"""Original task: {plan.original_task}

Already completed:
{chr(10).join(completed_info) if completed_info else 'Nothing yet'}

Still need to accomplish:
{chr(10).join(f'- {g}' for g in incomplete_goals)}

Reason for replanning: {reason}

Create a new plan for the remaining work."""

        logger.info(f"🎯 [TASK_PLANNER] Replanning for session {session_id}: {reason}")
        
        # Keep completed goals, replace incomplete ones
        new_goals = [g for g in plan.goals if g.status == "completed"]
        additional_goals = await self.decompose_task(new_task)
        
        # Renumber to avoid conflicts
        for i, g in enumerate(additional_goals):
            g.id = f"g{len(new_goals) + i + 1}"
        
        new_goals.extend(additional_goals)
        plan.goals = new_goals
        
        return new_goals
    
    def cleanup_session(self, session_id: str) -> None:
        """Remove a session's plan from memory"""
        if session_id in self.plans:
            del self.plans[session_id]
            logger.info(f"🎯 [TASK_PLANNER] Cleaned up session {session_id}")


# Global singleton instance
task_planner_service = TaskPlannerService()
