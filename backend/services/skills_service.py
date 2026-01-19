"""
Custom Skills Service

Allows saving and replaying automated workflows - similar to Openwork's skills system.
Skills are sequences of actions that can be saved and re-executed.
"""

import json
import asyncio
from pathlib import Path
from typing import Dict, Any, List, Optional, AsyncGenerator
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class SkillActionType(str, Enum):
    """Types of actions that can be performed in a skill"""
    BROWSER_NAVIGATE = "browser_navigate"
    BROWSER_CLICK = "browser_click"
    BROWSER_TYPE = "browser_type"
    BROWSER_SCROLL = "browser_scroll"
    BROWSER_SCREENSHOT = "browser_screenshot"
    BROWSER_WAIT = "browser_wait"
    FILE_CREATE = "file_create"
    FILE_WRITE = "file_write"
    FILE_READ = "file_read"
    SHELL_COMMAND = "shell_command"
    LLM_PROMPT = "llm_prompt"
    DELAY = "delay"
    CONDITIONAL = "conditional"


@dataclass
class SkillAction:
    """A single action within a skill"""
    action_type: SkillActionType
    params: Dict[str, Any]
    name: Optional[str] = None
    description: Optional[str] = None
    timeout_seconds: int = 30
    on_error: str = "stop"  # "stop", "continue", "retry"
    max_retries: int = 1


@dataclass
class Skill:
    """A reusable automation workflow"""
    id: str
    name: str
    description: str
    actions: List[SkillAction]
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    tags: List[str] = field(default_factory=list)
    variables: Dict[str, str] = field(default_factory=dict)  # Template variables
    trigger_phrases: List[str] = field(default_factory=list)  # Phrases that activate this skill
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "actions": [
                {
                    "action_type": a.action_type.value if isinstance(a.action_type, SkillActionType) else a.action_type,
                    "params": a.params,
                    "name": a.name,
                    "description": a.description,
                    "timeout_seconds": a.timeout_seconds,
                    "on_error": a.on_error,
                    "max_retries": a.max_retries
                }
                for a in self.actions
            ],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "tags": self.tags,
            "variables": self.variables,
            "trigger_phrases": self.trigger_phrases
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Skill":
        """Create from dictionary"""
        actions = []
        for action_data in data.get("actions", []):
            action_type = action_data.get("action_type")
            if isinstance(action_type, str):
                try:
                    action_type = SkillActionType(action_type)
                except ValueError:
                    action_type = SkillActionType.SHELL_COMMAND
            
            actions.append(SkillAction(
                action_type=action_type,
                params=action_data.get("params", {}),
                name=action_data.get("name"),
                description=action_data.get("description"),
                timeout_seconds=action_data.get("timeout_seconds", 30),
                on_error=action_data.get("on_error", "stop"),
                max_retries=action_data.get("max_retries", 1)
            ))
        
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            description=data.get("description", ""),
            actions=actions,
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            tags=data.get("tags", []),
            variables=data.get("variables", {}),
            trigger_phrases=data.get("trigger_phrases", [])
        )


@dataclass
class SkillExecutionResult:
    """Result of executing a skill action"""
    success: bool
    action_index: int
    action_type: str
    message: str
    output: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: int = 0


@dataclass
class ReasoningStep:
    """A reasoning step for streaming progress"""
    step: str
    action_type: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


class SkillsService:
    """Service for managing and executing custom skills"""
    
    def __init__(self, storage_path: Optional[Path] = None):
        """Initialize the skills service"""
        if storage_path is None:
            # Default to user's Application Support directory
            self.storage_path = Path.home() / "Library" / "Application Support" / "Velora" / "skills"
        else:
            self.storage_path = storage_path
        
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.skills_file = self.storage_path / "skills.json"
        self._skills_cache: Dict[str, Skill] = {}
        self._load_skills()
        
        # Import browser client here to avoid circular imports
        self._browser_client = None
    
    def _load_skills(self) -> None:
        """Load skills from storage"""
        if self.skills_file.exists():
            try:
                with open(self.skills_file, "r") as f:
                    data = json.load(f)
                    for skill_data in data.get("skills", []):
                        skill = Skill.from_dict(skill_data)
                        self._skills_cache[skill.id] = skill
                logger.info(f"Loaded {len(self._skills_cache)} skills from storage")
            except Exception as e:
                logger.error(f"Failed to load skills: {e}")
                self._skills_cache = {}
        else:
            self._skills_cache = {}
            # Create default example skills
            self._create_default_skills()
    
    def _save_skills(self) -> None:
        """Save skills to storage"""
        try:
            data = {
                "skills": [skill.to_dict() for skill in self._skills_cache.values()],
                "version": "1.0",
                "updated_at": datetime.now().isoformat()
            }
            with open(self.skills_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved {len(self._skills_cache)} skills to storage")
        except Exception as e:
            logger.error(f"Failed to save skills: {e}")
    
    def _create_default_skills(self) -> None:
        """Create some default example skills"""
        # Example: Google Search skill
        google_search = Skill(
            id="google_search",
            name="Google Search",
            description="Search Google for a query and return results",
            actions=[
                SkillAction(
                    action_type=SkillActionType.BROWSER_NAVIGATE,
                    params={"url": "https://www.google.com"},
                    name="Open Google",
                    description="Navigate to Google homepage"
                ),
                SkillAction(
                    action_type=SkillActionType.BROWSER_TYPE,
                    params={"selector": "textarea[name='q']", "text": "${query}"},
                    name="Enter search query",
                    description="Type the search query"
                ),
                SkillAction(
                    action_type=SkillActionType.BROWSER_CLICK,
                    params={"selector": "input[name='btnK'], button[type='submit']"},
                    name="Click search",
                    description="Submit the search"
                ),
                SkillAction(
                    action_type=SkillActionType.BROWSER_WAIT,
                    params={"seconds": 2},
                    name="Wait for results",
                    description="Wait for search results to load"
                )
            ],
            tags=["browser", "search", "google"],
            variables={"query": ""},
            trigger_phrases=["google search", "search google for", "look up on google"]
        )
        
        # Example: Screenshot Current Page skill
        screenshot_page = Skill(
            id="screenshot_page",
            name="Screenshot Page",
            description="Take a screenshot of the current browser page",
            actions=[
                SkillAction(
                    action_type=SkillActionType.BROWSER_SCREENSHOT,
                    params={"path": "${output_path}", "full_page": True},
                    name="Capture screenshot",
                    description="Take a full-page screenshot"
                )
            ],
            tags=["browser", "screenshot"],
            variables={"output_path": "~/Desktop/screenshot.png"},
            trigger_phrases=["take screenshot", "capture page", "screenshot this"]
        )
        
        # Example: Fill Login Form skill
        login_form = Skill(
            id="fill_login_form",
            name="Fill Login Form",
            description="Fill out a login form with credentials",
            actions=[
                SkillAction(
                    action_type=SkillActionType.BROWSER_TYPE,
                    params={"selector": "input[type='email'], input[name='email'], input[name='username'], #email, #username", "text": "${email}"},
                    name="Enter email/username",
                    description="Fill in the email or username field"
                ),
                SkillAction(
                    action_type=SkillActionType.BROWSER_TYPE,
                    params={"selector": "input[type='password'], input[name='password'], #password", "text": "${password}"},
                    name="Enter password",
                    description="Fill in the password field"
                ),
                SkillAction(
                    action_type=SkillActionType.BROWSER_CLICK,
                    params={"selector": "button[type='submit'], input[type='submit'], button:has-text('Login'), button:has-text('Sign in')"},
                    name="Click login",
                    description="Submit the login form",
                    on_error="continue"
                )
            ],
            tags=["browser", "form", "login"],
            variables={"email": "", "password": ""},
            trigger_phrases=["fill login", "log me in", "fill credentials"]
        )
        
        self._skills_cache[google_search.id] = google_search
        self._skills_cache[screenshot_page.id] = screenshot_page
        self._skills_cache[login_form.id] = login_form
        self._save_skills()
    
    def get_skill(self, skill_id: str) -> Optional[Skill]:
        """Get a skill by ID"""
        return self._skills_cache.get(skill_id)
    
    def get_skill_by_name(self, name: str) -> Optional[Skill]:
        """Get a skill by name (case-insensitive)"""
        name_lower = name.lower()
        for skill in self._skills_cache.values():
            if skill.name.lower() == name_lower:
                return skill
        return None
    
    def find_skill_by_trigger(self, query: str) -> Optional[Skill]:
        """Find a skill that matches a trigger phrase"""
        query_lower = query.lower()
        for skill in self._skills_cache.values():
            for trigger in skill.trigger_phrases:
                if trigger.lower() in query_lower:
                    return skill
        return None
    
    def list_skills(self, tags: Optional[List[str]] = None) -> List[Skill]:
        """List all skills, optionally filtered by tags"""
        skills = list(self._skills_cache.values())
        if tags:
            skills = [s for s in skills if any(t in s.tags for t in tags)]
        return sorted(skills, key=lambda s: s.name)
    
    def create_skill(
        self,
        name: str,
        description: str,
        actions: List[Dict[str, Any]],
        tags: Optional[List[str]] = None,
        variables: Optional[Dict[str, str]] = None,
        trigger_phrases: Optional[List[str]] = None
    ) -> Skill:
        """Create a new skill"""
        import uuid
        
        skill_id = str(uuid.uuid4())[:8]
        
        # Convert action dictionaries to SkillAction objects
        skill_actions = []
        for action_data in actions:
            action_type = action_data.get("action_type")
            if isinstance(action_type, str):
                try:
                    action_type = SkillActionType(action_type)
                except ValueError:
                    logger.warning(f"Unknown action type: {action_type}")
                    continue
            
            skill_actions.append(SkillAction(
                action_type=action_type,
                params=action_data.get("params", {}),
                name=action_data.get("name"),
                description=action_data.get("description"),
                timeout_seconds=action_data.get("timeout_seconds", 30),
                on_error=action_data.get("on_error", "stop"),
                max_retries=action_data.get("max_retries", 1)
            ))
        
        skill = Skill(
            id=skill_id,
            name=name,
            description=description,
            actions=skill_actions,
            tags=tags or [],
            variables=variables or {},
            trigger_phrases=trigger_phrases or []
        )
        
        self._skills_cache[skill.id] = skill
        self._save_skills()
        
        logger.info(f"Created skill: {skill.name} ({skill.id})")
        return skill
    
    def update_skill(self, skill_id: str, updates: Dict[str, Any]) -> Optional[Skill]:
        """Update an existing skill"""
        skill = self._skills_cache.get(skill_id)
        if not skill:
            return None
        
        # Apply updates
        if "name" in updates:
            skill.name = updates["name"]
        if "description" in updates:
            skill.description = updates["description"]
        if "tags" in updates:
            skill.tags = updates["tags"]
        if "variables" in updates:
            skill.variables = updates["variables"]
        if "trigger_phrases" in updates:
            skill.trigger_phrases = updates["trigger_phrases"]
        if "actions" in updates:
            # Rebuild actions list
            skill_actions = []
            for action_data in updates["actions"]:
                action_type = action_data.get("action_type")
                if isinstance(action_type, str):
                    try:
                        action_type = SkillActionType(action_type)
                    except ValueError:
                        continue
                
                skill_actions.append(SkillAction(
                    action_type=action_type,
                    params=action_data.get("params", {}),
                    name=action_data.get("name"),
                    description=action_data.get("description"),
                    timeout_seconds=action_data.get("timeout_seconds", 30),
                    on_error=action_data.get("on_error", "stop"),
                    max_retries=action_data.get("max_retries", 1)
                ))
            skill.actions = skill_actions
        
        skill.updated_at = datetime.now().isoformat()
        self._save_skills()
        
        logger.info(f"Updated skill: {skill.name} ({skill.id})")
        return skill
    
    def delete_skill(self, skill_id: str) -> bool:
        """Delete a skill"""
        if skill_id in self._skills_cache:
            skill_name = self._skills_cache[skill_id].name
            del self._skills_cache[skill_id]
            self._save_skills()
            logger.info(f"Deleted skill: {skill_name} ({skill_id})")
            return True
        return False
    
    def _get_browser_client(self):
        """Get browser client (lazy initialization)"""
        if self._browser_client is None:
            from backend.services.browser_client import BrowserClient
            self._browser_client = BrowserClient()
        return self._browser_client
    
    def _substitute_variables(self, text: str, variables: Dict[str, str]) -> str:
        """Substitute ${variable} placeholders in text"""
        result = text
        for key, value in variables.items():
            result = result.replace(f"${{{key}}}", str(value))
        return result
    
    def _substitute_params(self, params: Dict[str, Any], variables: Dict[str, str]) -> Dict[str, Any]:
        """Substitute variables in all string values of params"""
        result = {}
        for key, value in params.items():
            if isinstance(value, str):
                result[key] = self._substitute_variables(value, variables)
            elif isinstance(value, dict):
                result[key] = self._substitute_params(value, variables)
            elif isinstance(value, list):
                result[key] = [
                    self._substitute_variables(v, variables) if isinstance(v, str) else v
                    for v in value
                ]
            else:
                result[key] = value
        return result
    
    async def execute_skill(
        self,
        skill_id: str,
        variables: Optional[Dict[str, str]] = None,
        emit_reasoning: bool = True
    ) -> AsyncGenerator[ReasoningStep, None]:
        """
        Execute a skill and yield reasoning steps.
        
        Args:
            skill_id: The ID of the skill to execute
            variables: Variables to substitute in the skill actions
            emit_reasoning: Whether to yield reasoning steps
            
        Yields:
            ReasoningStep objects for progress tracking
        """
        skill = self.get_skill(skill_id)
        if not skill:
            yield ReasoningStep(
                step="error",
                action_type="skill_error",
                message=f"Skill not found: {skill_id}",
                details={}
            )
            return
        
        # Merge provided variables with skill defaults
        merged_vars = {**skill.variables, **(variables or {})}
        
        if emit_reasoning:
            yield ReasoningStep(
                step="skill_starting",
                action_type="skill_executing",
                message=f"Starting skill: {skill.name}",
                details={
                    "skill_id": skill.id,
                    "skill_name": skill.name,
                    "description": skill.description,
                    "total_actions": len(skill.actions),
                    "variables": merged_vars
                }
            )
        
        browser = self._get_browser_client()
        
        # Ensure browser is started for browser actions
        has_browser_actions = any(
            a.action_type.value.startswith("browser_") 
            for a in skill.actions
        )
        
        if has_browser_actions:
            if not await browser.ensure_started():
                yield ReasoningStep(
                    step="error",
                    action_type="skill_error",
                    message="Failed to start browser for skill execution",
                    details={}
                )
                return
        
        # Execute each action
        for idx, action in enumerate(skill.actions):
            action_name = action.name or f"Action {idx + 1}"
            
            if emit_reasoning:
                yield ReasoningStep(
                    step="skill_action_starting",
                    action_type="skill_executing",
                    message=f"Step {idx + 1}/{len(skill.actions)}: {action_name}",
                    details={
                        "action_type": action.action_type.value,
                        "description": action.description
                    }
                )
            
            # Substitute variables in params
            params = self._substitute_params(action.params, merged_vars)
            
            try:
                result = await self._execute_action(action.action_type, params, browser)
                
                if emit_reasoning:
                    yield ReasoningStep(
                        step="skill_action_complete",
                        action_type="skill_executing",
                        message=f"Completed: {action_name}",
                        details={
                            "success": result.success,
                            "output": result.output,
                            "duration_ms": result.duration_ms
                        }
                    )
                
                if not result.success and action.on_error == "stop":
                    yield ReasoningStep(
                        step="skill_error",
                        action_type="skill_error",
                        message=f"Action failed: {result.error}",
                        details={"action_index": idx, "action_name": action_name}
                    )
                    return
                    
            except Exception as e:
                logger.error(f"Error executing action {idx}: {e}")
                
                if action.on_error == "stop":
                    yield ReasoningStep(
                        step="skill_error",
                        action_type="skill_error",
                        message=f"Action failed: {str(e)}",
                        details={"action_index": idx, "action_name": action_name}
                    )
                    return
                elif emit_reasoning:
                    yield ReasoningStep(
                        step="skill_action_error",
                        action_type="skill_executing",
                        message=f"Error in {action_name}: {str(e)} (continuing...)",
                        details={"action_index": idx, "error": str(e)}
                    )
        
        if emit_reasoning:
            yield ReasoningStep(
                step="skill_complete",
                action_type="skill_complete",
                message=f"Skill completed: {skill.name}",
                details={
                    "skill_id": skill.id,
                    "total_actions": len(skill.actions)
                }
            )
    
    async def _execute_action(
        self,
        action_type: SkillActionType,
        params: Dict[str, Any],
        browser
    ) -> SkillExecutionResult:
        """Execute a single skill action"""
        import time
        start_time = time.time()
        
        try:
            if action_type == SkillActionType.BROWSER_NAVIGATE:
                url = params.get("url", "")
                result = await browser.navigate(url)
                return SkillExecutionResult(
                    success=result.success,
                    action_index=0,
                    action_type=action_type.value,
                    message=result.message,
                    output={"url": url},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.BROWSER_CLICK:
                selector = params.get("selector", "")
                ref = params.get("ref", "")
                
                if ref:
                    # Click by AI snapshot ref
                    result = await browser.click_ref(ref)
                else:
                    # Click by CSS selector
                    result = await browser.click(selector)
                
                return SkillExecutionResult(
                    success=result.success,
                    action_index=0,
                    action_type=action_type.value,
                    message=result.message,
                    output={"selector": selector or ref},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.BROWSER_TYPE:
                selector = params.get("selector", "")
                text = params.get("text", "")
                ref = params.get("ref", "")
                
                if ref:
                    result = await browser.type_in_ref(ref, text)
                else:
                    result = await browser.type_text(selector, text)
                
                return SkillExecutionResult(
                    success=result.success,
                    action_index=0,
                    action_type=action_type.value,
                    message=result.message,
                    output={"selector": selector or ref, "text_length": len(text)},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.BROWSER_SCROLL:
                direction = params.get("direction", "down")
                amount = params.get("amount", 500)
                result = await browser.scroll(direction, amount)
                
                return SkillExecutionResult(
                    success=result.success,
                    action_index=0,
                    action_type=action_type.value,
                    message=result.message,
                    output={"direction": direction, "amount": amount},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.BROWSER_SCREENSHOT:
                path = params.get("path", "")
                full_page = params.get("full_page", False)
                
                # Expand ~ in path
                if path.startswith("~"):
                    path = str(Path(path).expanduser())
                
                result = await browser.take_screenshot(path, full_page=full_page)
                
                return SkillExecutionResult(
                    success=result.success,
                    action_index=0,
                    action_type=action_type.value,
                    message=result.message,
                    output={"path": path},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.BROWSER_WAIT:
                seconds = params.get("seconds", 1)
                await asyncio.sleep(seconds)
                
                return SkillExecutionResult(
                    success=True,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Waited {seconds} seconds",
                    output={"seconds": seconds},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.DELAY:
                seconds = params.get("seconds", 1)
                await asyncio.sleep(seconds)
                
                return SkillExecutionResult(
                    success=True,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Delayed {seconds} seconds",
                    output={"seconds": seconds},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.SHELL_COMMAND:
                command = params.get("command", "")
                
                process = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await process.communicate()
                
                return SkillExecutionResult(
                    success=process.returncode == 0,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Command completed with exit code {process.returncode}",
                    output={
                        "stdout": stdout.decode() if stdout else "",
                        "stderr": stderr.decode() if stderr else "",
                        "exit_code": process.returncode
                    },
                    error=stderr.decode() if process.returncode != 0 and stderr else None,
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.FILE_CREATE:
                file_path = params.get("path", "")
                content = params.get("content", "")
                
                if file_path.startswith("~"):
                    file_path = str(Path(file_path).expanduser())
                
                path = Path(file_path)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                
                return SkillExecutionResult(
                    success=True,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Created file: {file_path}",
                    output={"path": file_path},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.FILE_READ:
                file_path = params.get("path", "")
                
                if file_path.startswith("~"):
                    file_path = str(Path(file_path).expanduser())
                
                path = Path(file_path)
                if not path.exists():
                    return SkillExecutionResult(
                        success=False,
                        action_index=0,
                        action_type=action_type.value,
                        message=f"File not found: {file_path}",
                        error=f"File not found: {file_path}",
                        duration_ms=int((time.time() - start_time) * 1000)
                    )
                
                content = path.read_text()
                
                return SkillExecutionResult(
                    success=True,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Read file: {file_path}",
                    output={"path": file_path, "content": content[:1000], "size": len(content)},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            elif action_type == SkillActionType.FILE_WRITE:
                file_path = params.get("path", "")
                content = params.get("content", "")
                mode = params.get("mode", "w")  # "w" for overwrite, "a" for append
                
                if file_path.startswith("~"):
                    file_path = str(Path(file_path).expanduser())
                
                path = Path(file_path)
                if mode == "a":
                    with open(path, "a") as f:
                        f.write(content)
                else:
                    path.write_text(content)
                
                return SkillExecutionResult(
                    success=True,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Wrote to file: {file_path}",
                    output={"path": file_path, "mode": mode},
                    duration_ms=int((time.time() - start_time) * 1000)
                )
            
            else:
                return SkillExecutionResult(
                    success=False,
                    action_index=0,
                    action_type=action_type.value,
                    message=f"Unknown action type: {action_type}",
                    error=f"Unknown action type: {action_type}",
                    duration_ms=int((time.time() - start_time) * 1000)
                )
                
        except Exception as e:
            return SkillExecutionResult(
                success=False,
                action_index=0,
                action_type=action_type.value,
                message=f"Action failed: {str(e)}",
                error=str(e),
                duration_ms=int((time.time() - start_time) * 1000)
            )


# Singleton instance
_skills_service: Optional[SkillsService] = None


def get_skills_service() -> SkillsService:
    """Get the singleton skills service instance"""
    global _skills_service
    if _skills_service is None:
        _skills_service = SkillsService()
    return _skills_service
