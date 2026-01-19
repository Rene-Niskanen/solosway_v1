"""
OpenCode Bridge Service - Communication layer between LangGraph and desktop automation.

This service provides desktop automation capabilities:
- File management (via OpenCode CLI): sort, rename, move, organize
- Document creation (via OpenCode CLI): create, summarize, rewrite
- Browser automation (via Playwright): visual navigation, clicking, form fill, screenshots

Execution Modes:
1. OpenCode CLI: For file/document operations
2. Playwright Browser: For visual browser automation (opens actual browser window)
"""

import logging
import os
import asyncio
import json
import shutil
from typing import Dict, Any, List, Optional, AsyncGenerator, Union
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

# Lazy import browser service to avoid circular imports
_browser_service = None
_skills_service = None

def get_browser_service():
    """Get the browser automation service (lazy loaded)"""
    global _browser_service
    if _browser_service is None:
        from backend.services.browser_client import browser_service
        _browser_service = browser_service
    return _browser_service

def get_skills_service():
    """Get the skills service (lazy loaded)"""
    global _skills_service
    if _skills_service is None:
        from backend.services.skills_service import get_skills_service as _get_skills
        _skills_service = _get_skills()
    return _skills_service


class DesktopActionType(str, Enum):
    """Types of desktop actions supported by OpenCode"""
    FILE_ORGANIZE = "file_organize"
    FILE_RENAME = "file_rename"
    FILE_MOVE = "file_move"
    FILE_SORT = "file_sort"
    DOCUMENT_CREATE = "document_create"
    DOCUMENT_SUMMARIZE = "document_summarize"
    DOCUMENT_REWRITE = "document_rewrite"
    BROWSER_RESEARCH = "browser_research"
    BROWSER_FORM_FILL = "browser_form_fill"
    BROWSER_SCREENSHOT = "browser_screenshot"
    SKILL_EXECUTE = "skill_execute"
    SKILL_CREATE = "skill_create"
    SKILL_LIST = "skill_list"


@dataclass
class ReasoningStep:
    """A reasoning step emitted during OpenCode execution"""
    step: str
    action_type: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ThinkingToken:
    """A thinking token for narrative streaming - emitted character-by-character"""
    token: str
    is_complete: bool = False  # True when this completes a thought/sentence


@dataclass
class BrowserAction:
    """Browser action command for embedded webview in frontend"""
    action_type: str  # 'navigate', 'click', 'type', 'scroll', 'close'
    url: Optional[str] = None
    selector: Optional[str] = None  # CSS selector or AI ref
    text: Optional[str] = None  # Text to type
    direction: Optional[str] = None  # For scroll: 'up', 'down', 'left', 'right'


@dataclass
class OpenCodeResult:
    """Result from an OpenCode action execution"""
    success: bool
    summary: str
    actions: List[Dict[str, Any]] = field(default_factory=list)
    steps: List[ReasoningStep] = field(default_factory=list)
    error: Optional[str] = None
    output_files: List[str] = field(default_factory=list)


class OpenCodeBridgeService:
    """
    Bridge service for executing OpenCode CLI commands.
    
    Supports two modes:
    1. CLI Mode: Direct execution via subprocess (default, no server needed)
    2. HTTP Mode: Optional connection to `opencode serve` for streaming
    
    This service handles:
    - CLI command execution
    - Permission/folder access management
    - Thinking token generation for UX
    - Result parsing and error handling
    """
    
    def __init__(self):
        self.enabled = os.getenv("OPENCODE_ENABLED", "false").lower() == "true"
        self.allowed_folders = self._parse_allowed_folders()
        self.cli_command = os.getenv("OPENCODE_CLI", "opencode")
        self.cli_package = ""  # Direct command, no package needed
        
        # Optional HTTP mode settings (if serve mode is available)
        self.http_enabled = os.getenv("OPENCODE_HTTP_ENABLED", "false").lower() == "true"
        self.serve_url = os.getenv("OPENCODE_SERVE_URL", "http://localhost:3333")
        
        # LLM provider settings for CLI
        self.provider = os.getenv("OPENCODE_PROVIDER", "openai")
        self.model = os.getenv("OPENCODE_MODEL", "gpt-4o")
        
        if self.enabled:
            logger.info(f"✅ OpenCode Bridge initialized (CLI mode)")
            logger.info(f"📁 Allowed folders: {self.allowed_folders}")
            logger.info(f"🤖 Provider: {self.provider}, Model: {self.model}")
        else:
            logger.info("⏸️ OpenCode Bridge disabled (OPENCODE_ENABLED=false)")
    
    def _parse_allowed_folders(self) -> List[str]:
        """Parse comma-separated list of allowed folders from environment"""
        folders_str = os.getenv("OPENCODE_ALLOWED_FOLDERS", "")
        if not folders_str:
            return []
        return [f.strip() for f in folders_str.split(",") if f.strip()]
    
    def is_path_allowed(self, path: str) -> bool:
        """Check if a path is within the allowed folders"""
        if not self.allowed_folders:
            # No restrictions if no folders specified (for development)
            logger.warning("⚠️ No OPENCODE_ALLOWED_FOLDERS configured - all paths allowed")
            return True
        
        abs_path = os.path.abspath(os.path.expanduser(path))
        for allowed in self.allowed_folders:
            allowed_abs = os.path.abspath(os.path.expanduser(allowed))
            if abs_path.startswith(allowed_abs):
                return True
        
        logger.warning(f"🚫 Path not allowed: {path}")
        return False
    
    def _check_cli_available(self) -> bool:
        """Check if OpenCode CLI is available"""
        # Check for opencode command
        if shutil.which("opencode"):
            return True
        # Fallback: check for npx
        if shutil.which("npx"):
            self.cli_command = "npx"
            self.cli_package = "opencode-ai"
            return True
        return False
    
    async def health_check(self) -> bool:
        """Check if OpenCode CLI is available and working"""
        if not self.enabled:
            return False
        
        if not self._check_cli_available():
            logger.warning("❌ OpenCode CLI not found. Install with: npm install -g @opencode/cli")
            return False
        
        logger.info("✅ OpenCode CLI is available")
        return True
    
    def _build_cli_prompt(self, action_type: DesktopActionType, params: Dict[str, Any]) -> str:
        """Build a natural language prompt for OpenCode CLI"""
        path = params.get("path", params.get("source_path", ""))
        destination = params.get("destination", params.get("output_path", ""))
        instructions = params.get("instructions", "")
        url = params.get("url", "")
        content = params.get("content", "")
        pattern = params.get("pattern", "")
        filter_pattern = params.get("filter_pattern", "")
        
        prompts = {
            DesktopActionType.FILE_ORGANIZE: f"Organize the files in '{path}'" + (f" by {pattern}" if pattern else " by type") + (f". Only process files matching '{filter_pattern}'" if filter_pattern else ""),
            DesktopActionType.FILE_RENAME: f"Rename the files in '{path}'" + (f" using pattern '{pattern}'" if pattern else ""),
            DesktopActionType.FILE_MOVE: f"Move files from '{path}' to '{destination}'" + (f". Only move files matching '{filter_pattern}'" if filter_pattern else ""),
            DesktopActionType.FILE_SORT: f"Sort the files in '{path}'" + (f" by {pattern}" if pattern else " by name"),
            DesktopActionType.DOCUMENT_CREATE: f"Create a document at '{destination}'" + (f" with content: {content}" if content else f" based on: {instructions}"),
            DesktopActionType.DOCUMENT_SUMMARIZE: f"Summarize the document at '{path}' and save to '{destination}'",
            DesktopActionType.DOCUMENT_REWRITE: f"Rewrite the document at '{path}'" + (f" to be {instructions}" if instructions else " to improve clarity"),
            DesktopActionType.BROWSER_RESEARCH: f"Research: {instructions}" + (f" starting from {url}" if url else ""),
            DesktopActionType.BROWSER_FORM_FILL: f"Fill out the form at '{url}' with: {instructions}",
            DesktopActionType.BROWSER_SCREENSHOT: f"Take a screenshot of '{url}'" + (f" and save to '{destination}'" if destination else ""),
        }
        
        base_prompt = prompts.get(action_type, instructions or f"Execute {action_type.value}")
        
        # Add original instructions if provided and not already included
        if instructions and instructions not in base_prompt:
            base_prompt += f"\n\nAdditional context: {instructions}"
        
        return base_prompt
    
    async def _execute_cli(self, prompt: str) -> Dict[str, Any]:
        """Execute OpenCode CLI with the given prompt"""
        try:
            # Build command - opencode run "prompt"
            if self.cli_package:
                # Using npx fallback
                cmd = [self.cli_command, self.cli_package, "run", prompt]
            else:
                # Direct opencode command
                cmd = [self.cli_command, "run", prompt]
            
            # Add provider/model if specified
            env = os.environ.copy()
            if self.provider:
                env["OPENCODE_PROVIDER"] = self.provider
            if self.model:
                env["OPENCODE_MODEL"] = self.model
            
            logger.info(f"🚀 Executing OpenCode CLI: {' '.join(cmd[:3])}...")
            
            # Execute with timeout
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=300  # 5 minute timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return {
                    "success": False,
                    "error": "Command timed out after 5 minutes",
                    "output": ""
                }
            
            stdout_text = stdout.decode('utf-8', errors='replace')
            stderr_text = stderr.decode('utf-8', errors='replace')
            
            if proc.returncode == 0:
                logger.info(f"✅ OpenCode CLI completed successfully")
                return {
                    "success": True,
                    "output": stdout_text,
                    "error": None
                }
            else:
                logger.error(f"❌ OpenCode CLI failed: {stderr_text}")
                return {
                    "success": False,
                    "output": stdout_text,
                    "error": stderr_text or f"Exit code: {proc.returncode}"
                }
                
        except FileNotFoundError:
            error = f"OpenCode CLI not found. Install with: npm install -g opencode-ai"
            logger.error(f"❌ {error}")
            return {"success": False, "error": error, "output": ""}
        except Exception as e:
            logger.error(f"❌ CLI execution error: {e}", exc_info=True)
            return {"success": False, "error": str(e), "output": ""}
    
    def _parse_cli_output(self, output: str, action_type: DesktopActionType) -> Dict[str, Any]:
        """Parse CLI output to extract structured results"""
        result = {
            "summary": "",
            "output_files": [],
            "details": {}
        }
        
        lines = output.strip().split('\n')
        
        # Try to find summary/result
        for line in lines:
            line_lower = line.lower()
            
            # Look for file paths in output
            if any(ext in line for ext in ['.pdf', '.docx', '.md', '.txt', '.png', '.jpg']):
                # Extract file paths
                import re
                paths = re.findall(r'[/~][\w/.-]+\.\w+', line)
                result["output_files"].extend(paths)
            
            # Look for success indicators
            if any(word in line_lower for word in ['completed', 'success', 'done', 'finished', 'created', 'organized', 'moved']):
                if not result["summary"]:
                    result["summary"] = line.strip()
        
        # Default summary if none found
        if not result["summary"]:
            if output.strip():
                # Use first non-empty line as summary
                for line in lines:
                    if line.strip():
                        result["summary"] = line.strip()[:200]
                        break
            else:
                result["summary"] = f"{action_type.value.replace('_', ' ').title()} completed"
        
        return result
    
    async def execute_action(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any],
        emit_reasoning: bool = True
    ) -> OpenCodeResult:
        """
        Execute a desktop action via OpenCode CLI or Browser service.
        
        Browser actions (research, form_fill, screenshot) use Playwright for visual automation.
        File/Document actions use OpenCode CLI.
        
        Args:
            action_type: The type of action to perform
            params: Parameters for the action
            emit_reasoning: Whether to include reasoning steps in result
            
        Returns:
            OpenCodeResult with success status, summary, and reasoning steps
        """
        if not self.enabled:
            return OpenCodeResult(
                success=False,
                summary="OpenCode is not enabled. Set OPENCODE_ENABLED=true to enable desktop automation.",
                error="OpenCode disabled"
            )
        
        # Route browser actions to the browser service (Playwright)
        if action_type in [DesktopActionType.BROWSER_RESEARCH, 
                          DesktopActionType.BROWSER_FORM_FILL, 
                          DesktopActionType.BROWSER_SCREENSHOT]:
            return await self._execute_browser_action(action_type, params, emit_reasoning)
        
        # Route skill actions to the skills service
        if action_type in [DesktopActionType.SKILL_EXECUTE, 
                          DesktopActionType.SKILL_CREATE, 
                          DesktopActionType.SKILL_LIST]:
            return await self._execute_skill_action(action_type, params, emit_reasoning)
        
        # Validate path permissions for file/document actions
        path = params.get("path") or params.get("source_path")
        if path and not self.is_path_allowed(path):
            return OpenCodeResult(
                success=False,
                summary=f"Access denied: Path '{path}' is not in the allowed folders list.",
                error="Permission denied"
            )
        
        destination = params.get("destination") or params.get("output_path")
        if destination and not self.is_path_allowed(destination):
            return OpenCodeResult(
                success=False,
                summary=f"Access denied: Destination '{destination}' is not in the allowed folders list.",
                error="Permission denied"
            )
        
        steps: List[ReasoningStep] = []
        
        # Build prompt and execute
        prompt = self._build_cli_prompt(action_type, params)
        
        if emit_reasoning:
            steps.append(ReasoningStep(
                step="executing",
                action_type=self._get_reasoning_action_type(action_type),
                message=self._get_action_message(action_type, params),
                details=params
            ))
        
        # Execute CLI
        cli_result = await self._execute_cli(prompt)
        
        # Parse output
        parsed = self._parse_cli_output(cli_result.get("output", ""), action_type)
        
        if cli_result["success"]:
            if emit_reasoning:
                steps.append(ReasoningStep(
                    step="complete",
                    action_type=self._get_completion_action_type(action_type),
                    message=parsed["summary"],
                    details={"output_files": parsed["output_files"]}
                ))
            
            return OpenCodeResult(
                success=True,
                summary=parsed["summary"],
                steps=steps,
                output_files=parsed["output_files"]
            )
        else:
            if emit_reasoning:
                steps.append(ReasoningStep(
                    step="error",
                    action_type="desktop_planning",
                    message=f"Failed: {cli_result.get('error', 'Unknown error')}",
                    details={"error": cli_result.get("error")}
                ))
            
            return OpenCodeResult(
                success=False,
                summary=f"Failed to complete {action_type.value}: {cli_result.get('error', 'Unknown error')}",
                error=cli_result.get("error"),
                steps=steps
            )
    
    async def _execute_browser_action(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any],
        emit_reasoning: bool = True
    ) -> OpenCodeResult:
        """
        Execute browser automation via Playwright (visual browser control).
        
        This opens a real browser window and performs visual actions.
        """
        steps: List[ReasoningStep] = []
        browser_service = get_browser_service()
        
        try:
            if emit_reasoning:
                steps.append(ReasoningStep(
                    step="browser_starting",
                    action_type="browser_researching",
                    message="Starting browser automation...",
                    details={"action": action_type.value}
                ))
            
            if action_type == DesktopActionType.BROWSER_RESEARCH:
                query = params.get("instructions", params.get("query", ""))
                url = params.get("url", "")
                
                # Normalize URL - if it looks like a domain but missing protocol, add it
                if url:
                    url = url.strip()
                    # Check if this is actually just a search query disguised as a URL
                    if url.lower() in ["google", "google.com", "www.google.com", "bing", "bing.com"]:
                        # These aren't specific pages - treat as a search query instead
                        logger.info(f"🌐 URL '{url}' is a search engine, treating as search query")
                        url = ""  # Clear URL so we do a search instead
                    elif not url.startswith("http://") and not url.startswith("https://"):
                        url = "https://" + url
                
                if emit_reasoning:
                    steps.append(ReasoningStep(
                        step="browser_navigating",
                        action_type="browser_researching",
                        message=f"Researching: {query}",
                        details={"query": query, "url": url}
                    ))
                
                # If a specific URL is provided (not just a search engine), navigate to it first
                if url:
                    nav_result = await browser_service.navigate(url)
                    if not nav_result.success:
                        return OpenCodeResult(
                            success=False,
                            summary=f"Failed to navigate to {url}: {nav_result.message}",
                            error=nav_result.message,
                            steps=steps
                        )
                    
                    # Extract text from the page
                    text_result = await browser_service.extract_text()
                    
                    if emit_reasoning:
                        steps.append(ReasoningStep(
                            step="browser_complete",
                            action_type="browser_complete",
                            message=f"Extracted content from {url}",
                            details={"url": url}
                        ))
                    
                    return OpenCodeResult(
                        success=True,
                        summary=f"Researched: {url}\n\nContent:\n{text_result.data.get('text', '')[:2000]}...",
                        steps=steps
                    )
                else:
                    # Use agentic browser automation
                    if emit_reasoning:
                        steps.append(ReasoningStep(
                            step="browser_agent_starting",
                            action_type="browser_researching",
                            message=f"Starting agentic browser for: {query}",
                            details={"task": query}
                        ))
                    
                    result = await browser_service.agentic_browse(
                        task=query,
                        starting_url="https://www.google.com",
                        max_steps=8
                    )
                    
                    if result.success:
                        action_history = result.data.get("action_history", [])
                        steps_taken = result.data.get("steps_taken", 0)
                        
                        # Emit reasoning steps for each action taken
                        for action_item in action_history:
                            if emit_reasoning:
                                steps.append(ReasoningStep(
                                    step="browser_action",
                                    action_type="browser_navigating",
                                    message=f"Step {action_item.get('step')}: {action_item.get('action', action_item.get('error', 'Unknown'))}",
                                    details=action_item
                                ))
                        
                        if emit_reasoning:
                            steps.append(ReasoningStep(
                                step="browser_complete",
                                action_type="browser_complete",
                                message=result.message,
                                details={"steps_taken": steps_taken}
                            ))
                        
                        return OpenCodeResult(
                            success=True,
                            summary=f"Browser automation completed: {result.message}\n\nActions taken: {steps_taken}",
                            steps=steps
                        )
                    else:
                        return OpenCodeResult(
                            success=False,
                            summary=f"Browser automation failed: {result.message}",
                            error=result.message,
                            steps=steps
                        )
            
            elif action_type == DesktopActionType.BROWSER_SCREENSHOT:
                url = params.get("url", "")
                output_path = params.get("output_path", params.get("destination"))
                
                if url:
                    nav_result = await browser_service.navigate(url)
                    if not nav_result.success:
                        return OpenCodeResult(
                            success=False,
                            summary=f"Failed to navigate: {nav_result.message}",
                            error=nav_result.message,
                            steps=steps
                        )
                
                result = await browser_service.screenshot(output_path=output_path)
                
                if result.success:
                    if emit_reasoning:
                        steps.append(ReasoningStep(
                            step="browser_complete",
                            action_type="browser_complete",
                            message=f"Screenshot saved to {result.screenshot_path}",
                            details={"path": result.screenshot_path}
                        ))
                    
                    return OpenCodeResult(
                        success=True,
                        summary=f"Screenshot saved to {result.screenshot_path}",
                        output_files=[result.screenshot_path] if result.screenshot_path else [],
                        steps=steps
                    )
                else:
                    return OpenCodeResult(
                        success=False,
                        summary=f"Screenshot failed: {result.message}",
                        error=result.message,
                        steps=steps
                    )
            
            elif action_type == DesktopActionType.BROWSER_FORM_FILL:
                url = params.get("url", "")
                instructions = params.get("instructions", "")
                
                if emit_reasoning:
                    steps.append(ReasoningStep(
                        step="browser_agent_starting",
                        action_type="browser_researching",
                        message=f"Starting form fill agent for: {url}",
                        details={"url": url, "instructions": instructions}
                    ))
                
                # Build the task for the agentic browser
                task = f"Fill out the form on this page with the following information: {instructions}"
                starting_url = url if url else "about:blank"
                
                # Use agentic browser automation for intelligent form filling
                result = await browser_service.agentic_browse(
                    task=task,
                    starting_url=starting_url,
                    max_steps=12,  # More steps for complex forms
                    page_name="form_fill"
                )
                
                if result.success:
                    action_history = result.data.get("action_history", [])
                    steps_taken = result.data.get("steps_taken", 0)
                    
                    # Emit reasoning steps for each action taken
                    for action_item in action_history:
                        if emit_reasoning:
                            steps.append(ReasoningStep(
                                step="browser_action",
                                action_type="browser_navigating",
                                message=f"Step {action_item.get('step')}: {action_item.get('action', action_item.get('error', 'Unknown'))}",
                                details=action_item
                            ))
                    
                    if emit_reasoning:
                        steps.append(ReasoningStep(
                            step="browser_complete",
                            action_type="browser_complete",
                            message=f"Form filled: {result.message}",
                            details={"steps_taken": steps_taken}
                        ))
                    
                    return OpenCodeResult(
                        success=True,
                        summary=f"Form filling completed: {result.message}\n\nActions taken: {steps_taken}",
                        steps=steps
                    )
                else:
                    return OpenCodeResult(
                        success=False,
                        summary=f"Form filling failed: {result.message}",
                        error=result.message,
                        steps=steps
                    )
            
            else:
                return OpenCodeResult(
                    success=False,
                    summary=f"Unknown browser action: {action_type}",
                    error="Unknown action",
                    steps=steps
                )
                
        except Exception as e:
            logger.error(f"Browser action failed: {e}", exc_info=True)
            return OpenCodeResult(
                success=False,
                summary=f"Browser automation error: {str(e)}",
                error=str(e),
                steps=steps
            )
    
    async def _execute_browser_action_streaming(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any]
    ) -> AsyncGenerator[Union[ReasoningStep, BrowserAction], None]:
        """
        Execute browser automation with streaming action commands.
        
        Yields ReasoningStep for progress updates and BrowserAction for webview commands.
        The frontend's embedded webview executes the BrowserAction commands.
        """
        browser_service = get_browser_service()
        
        try:
            yield ReasoningStep(
                step="browser_starting",
                action_type="browser_researching",
                message="Starting browser automation...",
                details={"action": action_type.value}
            )
            
            if action_type == DesktopActionType.BROWSER_RESEARCH:
                query = params.get("instructions", params.get("query", ""))
                url = params.get("url", "")
                
                # Normalize URL
                if url:
                    url = url.strip()
                    if url.lower() in ["google", "google.com", "www.google.com", "bing", "bing.com"]:
                        logger.info(f"🌐 URL '{url}' is a search engine, treating as search query")
                        url = ""
                    elif not url.startswith("http://") and not url.startswith("https://"):
                        url = "https://" + url
                
                yield ReasoningStep(
                    step="browser_navigating",
                    action_type="browser_researching",
                    message=f"Researching: {query}",
                    details={"query": query, "url": url}
                )
                
                # If URL is provided, just navigate there
                if url:
                    # Emit navigate action for embedded webview
                    yield BrowserAction(action_type="navigate", url=url)
                    
                    nav_result = await browser_service.navigate(url)
                    if not nav_result.success:
                        yield ReasoningStep(
                            step="browser_error",
                            action_type="browser_error",
                            message=f"Navigation failed: {nav_result.message}",
                            details={}
                        )
                        return
                    
                    text_result = await browser_service.extract_text()
                    
                    yield ReasoningStep(
                        step="browser_complete",
                        action_type="browser_complete",
                        message=f"Extracted content from {url}",
                        details={"url": url, "content_preview": text_result.data.get('text', '')[:500]}
                    )
                else:
                    # Use streaming agentic browser
                    yield ReasoningStep(
                        step="browser_agent_starting",
                        action_type="browser_researching",
                        message=f"Starting agentic browser for: {query}",
                        details={"task": query}
                    )
                    
                    # Emit initial navigate action for webview
                    yield BrowserAction(action_type="navigate", url="https://www.google.com")
                    
                    async for event in browser_service.agentic_browse_streaming(
                        task=query,
                        starting_url="https://www.google.com",
                        max_steps=8
                    ):
                        event_type = event.get("type", "")
                        
                        # Convert browser events to actions for embedded webview
                        if event_type == "action":
                            action_str = event.get("action", "")
                            # Parse action to emit appropriate BrowserAction
                            if "navigate" in action_str.lower() or "go to" in action_str.lower():
                                url = event.get("url")
                                if url:
                                    yield BrowserAction(action_type="navigate", url=url)
                            elif "click" in action_str.lower():
                                selector = event.get("selector")
                                if selector:
                                    yield BrowserAction(action_type="click", selector=selector)
                            elif "type" in action_str.lower() or "fill" in action_str.lower():
                                selector = event.get("selector")
                                text = event.get("text")
                                if selector and text:
                                    yield BrowserAction(action_type="type", selector=selector, text=text)
                            elif "scroll" in action_str.lower():
                                direction = event.get("direction", "down")
                                yield BrowserAction(action_type="scroll", direction=direction)
                            
                            # Also emit as reasoning step
                            yield ReasoningStep(
                                step="browser_action",
                                action_type="browser_navigating",
                                message=action_str,
                                details={}
                            )
                        elif event_type == "url":
                            # URL changed - emit navigate action
                            url = event.get("url")
                            if url:
                                yield BrowserAction(action_type="navigate", url=url)
                        elif event_type == "error":
                            yield ReasoningStep(
                                step="browser_error",
                                action_type="browser_error",
                                message=event.get("error", "Unknown error"),
                                details={}
                            )
                        elif event_type == "complete":
                            yield ReasoningStep(
                                step="browser_complete",
                                action_type="browser_complete",
                                message=event.get("message", "Completed"),
                                details={"steps_taken": event.get("steps_taken", 0)}
                            )
            
            elif action_type == DesktopActionType.BROWSER_FORM_FILL:
                url = params.get("url", "")
                instructions = params.get("instructions", "")
                
                yield ReasoningStep(
                    step="browser_agent_starting",
                    action_type="browser_researching",
                    message=f"Starting form fill agent for: {url}",
                    details={"url": url, "instructions": instructions}
                )
                
                task = f"Fill out the form on this page with the following information: {instructions}"
                starting_url = url if url else "about:blank"
                
                # Emit initial navigate action
                if starting_url != "about:blank":
                    yield BrowserAction(action_type="navigate", url=starting_url)
                
                async for event in browser_service.agentic_browse_streaming(
                    task=task,
                    starting_url=starting_url,
                    max_steps=12,
                    page_name="form_fill"
                ):
                    event_type = event.get("type", "")
                    
                    if event_type == "action":
                        action_str = event.get("action", "")
                        # Parse action for webview
                        if "click" in action_str.lower():
                            selector = event.get("selector")
                            if selector:
                                yield BrowserAction(action_type="click", selector=selector)
                        elif "type" in action_str.lower() or "fill" in action_str.lower():
                            selector = event.get("selector")
                            text = event.get("text")
                            if selector and text:
                                yield BrowserAction(action_type="type", selector=selector, text=text)
                        yield ReasoningStep(step="browser_action", action_type="browser_navigating", message=action_str, details={})
                    elif event_type == "url":
                        url = event.get("url")
                        if url:
                            yield BrowserAction(action_type="navigate", url=url)
                    elif event_type == "error":
                        yield ReasoningStep(step="browser_error", action_type="browser_error", message=event.get("error", ""), details={})
                    elif event_type == "complete":
                        yield ReasoningStep(step="browser_complete", action_type="browser_complete", message=f"Form filled: {event.get('message', '')}", details={})
            
            elif action_type == DesktopActionType.BROWSER_SCREENSHOT:
                url = params.get("url", "")
                output_path = params.get("output_path", params.get("destination"))
                
                if url:
                    yield BrowserAction(action_type="navigate", url=url)
                    nav_result = await browser_service.navigate(url)
                    if not nav_result.success:
                        yield ReasoningStep(
                            step="browser_error",
                            action_type="browser_error", 
                            message=f"Navigation failed: {nav_result.message}",
                            details={}
                        )
                        return
                
                result = await browser_service.screenshot(output_path=output_path)
                
                if result.success:
                    yield ReasoningStep(
                        step="browser_complete",
                        action_type="browser_complete",
                        message=f"Screenshot saved to {result.screenshot_path}",
                        details={"path": result.screenshot_path}
                    )
                else:
                    yield ReasoningStep(
                        step="browser_error",
                        action_type="browser_error",
                        message=f"Screenshot failed: {result.message}",
                        details={}
                    )
            
        except Exception as e:
            logger.error(f"Browser action streaming failed: {e}", exc_info=True)
            yield ReasoningStep(
                step="browser_error",
                action_type="browser_error",
                message=str(e),
                details={}
            )
    
    async def _execute_skill_action(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any],
        emit_reasoning: bool = True
    ) -> OpenCodeResult:
        """
        Execute a skill-related action (execute, create, list).
        
        Args:
            action_type: The type of skill action
            params: Parameters for the action
            emit_reasoning: Whether to collect reasoning steps
            
        Returns:
            OpenCodeResult with execution details
        """
        steps: List[ReasoningStep] = []
        skills_service = get_skills_service()
        
        try:
            if action_type == DesktopActionType.SKILL_LIST:
                # List available skills
                tags = params.get("tags", [])
                skills = skills_service.list_skills(tags=tags if tags else None)
                
                skill_summaries = []
                for skill in skills:
                    skill_summaries.append(
                        f"• **{skill.name}** ({skill.id}): {skill.description}"
                    )
                
                if emit_reasoning:
                    steps.append(ReasoningStep(
                        step="skill_list",
                        action_type="skill_complete",
                        message=f"Found {len(skills)} skills",
                        details={"count": len(skills), "skills": [s.id for s in skills]}
                    ))
                
                return OpenCodeResult(
                    success=True,
                    summary=f"Available Skills ({len(skills)}):\n\n" + "\n".join(skill_summaries) if skill_summaries else "No skills found.",
                    steps=steps
                )
            
            elif action_type == DesktopActionType.SKILL_CREATE:
                # Create a new skill
                name = params.get("name", "")
                description = params.get("description", "")
                actions = params.get("actions", [])
                tags = params.get("tags", [])
                variables = params.get("variables", {})
                trigger_phrases = params.get("trigger_phrases", [])
                
                if not name:
                    return OpenCodeResult(
                        success=False,
                        summary="Skill name is required",
                        error="Missing name",
                        steps=steps
                    )
                
                skill = skills_service.create_skill(
                    name=name,
                    description=description,
                    actions=actions,
                    tags=tags,
                    variables=variables,
                    trigger_phrases=trigger_phrases
                )
                
                if emit_reasoning:
                    steps.append(ReasoningStep(
                        step="skill_created",
                        action_type="skill_complete",
                        message=f"Created skill: {skill.name}",
                        details={"skill_id": skill.id, "name": skill.name}
                    ))
                
                return OpenCodeResult(
                    success=True,
                    summary=f"Created skill **{skill.name}** ({skill.id})\n\nDescription: {skill.description}\n\nActions: {len(skill.actions)}",
                    steps=steps
                )
            
            elif action_type == DesktopActionType.SKILL_EXECUTE:
                # Execute a skill
                skill_id = params.get("skill_id", "")
                skill_name = params.get("skill_name", "")
                variables = params.get("variables", {})
                
                # Find skill by ID or name
                skill = None
                if skill_id:
                    skill = skills_service.get_skill(skill_id)
                elif skill_name:
                    skill = skills_service.get_skill_by_name(skill_name)
                
                if not skill:
                    # Try to find by trigger phrase
                    query = params.get("query", "")
                    if query:
                        skill = skills_service.find_skill_by_trigger(query)
                
                if not skill:
                    return OpenCodeResult(
                        success=False,
                        summary=f"Skill not found: {skill_id or skill_name}",
                        error="Skill not found",
                        steps=steps
                    )
                
                if emit_reasoning:
                    steps.append(ReasoningStep(
                        step="skill_starting",
                        action_type="skill_executing",
                        message=f"Executing skill: {skill.name}",
                        details={"skill_id": skill.id, "actions_count": len(skill.actions)}
                    ))
                
                # Execute skill and collect steps
                execution_steps = []
                async for step in skills_service.execute_skill(
                    skill_id=skill.id,
                    variables=variables,
                    emit_reasoning=True
                ):
                    execution_steps.append(step)
                    if emit_reasoning:
                        steps.append(step)
                
                # Check if execution was successful (last step should be skill_complete or skill_error)
                success = any(s.step == "skill_complete" for s in execution_steps)
                
                return OpenCodeResult(
                    success=success,
                    summary=f"Skill '{skill.name}' {'completed' if success else 'failed'}",
                    steps=steps
                )
            
            else:
                return OpenCodeResult(
                    success=False,
                    summary=f"Unknown skill action: {action_type}",
                    error="Unknown action",
                    steps=steps
                )
                
        except Exception as e:
            logger.error(f"Skill action failed: {e}", exc_info=True)
            return OpenCodeResult(
                success=False,
                summary=f"Skill error: {str(e)}",
                error=str(e),
                steps=steps
            )
    
    async def execute_streaming(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any]
    ) -> AsyncGenerator[ReasoningStep, None]:
        """
        Execute an action and yield reasoning steps.
        
        Note: CLI execution doesn't support real-time streaming,
        so this emits steps before and after execution.
        """
        if not self.enabled:
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message="OpenCode is not enabled",
                details={"error": "disabled"}
            )
            return
        
        # Validate permissions
        path = params.get("path") or params.get("source_path")
        if path and not self.is_path_allowed(path):
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message=f"Access denied: Path '{path}' is not allowed",
                details={"error": "permission_denied"}
            )
            return
        
        # Emit execution step
        yield ReasoningStep(
            step="executing",
            action_type=self._get_reasoning_action_type(action_type),
            message=self._get_action_message(action_type, params),
            details=params
        )
        
        # Execute and emit result
        result = await self.execute_action(action_type, params, emit_reasoning=False)
        
        if result.success:
            yield ReasoningStep(
                step="complete",
                action_type=self._get_completion_action_type(action_type),
                message=result.summary,
                details={
                    "success": True,
                    "output_files": result.output_files,
                    "summary": result.summary
                }
            )
        else:
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message=f"Failed: {result.error}",
                details={
                    "success": False,
                    "error": result.error
                }
            )
    
    async def execute_streaming_with_thinking(
        self,
        action_type: DesktopActionType,
        params: Dict[str, Any]
    ) -> AsyncGenerator[Union[ReasoningStep, ThinkingToken, BrowserAction], None]:
        """
        Execute an action with BOTH reasoning steps AND thinking tokens.
        
        For browser actions, also yields BrowserAction events for the embedded webview.
        
        Thinking tokens provide conversational narrative like 
        "I'll help you organize your files..."
        
        Yields:
            Union[ReasoningStep, ThinkingToken, BrowserAction]: Reasoning steps, thinking tokens, or browser actions
        """
        if not self.enabled:
            yield ThinkingToken(token="OpenCode is not enabled. ", is_complete=False)
            yield ThinkingToken(token="Please set OPENCODE_ENABLED=true to enable desktop automation.", is_complete=True)
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message="OpenCode is not enabled",
                details={"error": "disabled"}
            )
            return
        
        # Validate permissions
        path = params.get("path") or params.get("source_path")
        if path and not self.is_path_allowed(path):
            yield ThinkingToken(token=f"I don't have permission to access '{path}'. ", is_complete=False)
            yield ThinkingToken(token="Please add it to OPENCODE_ALLOWED_FOLDERS.", is_complete=True)
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message=f"Access denied: Path '{path}' is not allowed",
                details={"error": "permission_denied"}
            )
            return
        
        # Generate conversational thinking tokens for better UX
        action_verb = self._get_action_verb(action_type)
        target = self._get_action_target(action_type, params)
        
        # Stream initial thinking narrative
        thinking_phrases = [
            f"I'll help you {action_verb}",
            f" {target}. ",
            "Let me ",
            f"{self._get_setup_phrase(action_type)}...\n\n"
        ]
        
        for phrase in thinking_phrases:
            yield ThinkingToken(token=phrase, is_complete=False)
            await asyncio.sleep(0.03)  # Small delay for typewriter effect
        
        yield ThinkingToken(token="", is_complete=True)  # Mark initial thinking complete
        
        # Check CLI availability
        if not self._check_cli_available():
            yield ThinkingToken(token="I couldn't find the OpenCode CLI. ", is_complete=False)
            yield ThinkingToken(token="Please install it with: npm install -g opencode-ai\n\n", is_complete=True)
            yield ReasoningStep(
                step="error",
                action_type="desktop_planning",
                message="OpenCode CLI not found",
                details={"error": "cli_not_found", "suggestion": "npm install -g opencode-ai"}
            )
            return
        
        # Emit planning step
        yield ReasoningStep(
            step="planning",
            action_type="desktop_planning",
            message=f"Planning {action_type.value.replace('_', ' ')} operation...",
            details={"action_type": action_type.value}
        )
        
        # Stream progress thinking
        yield ThinkingToken(token="Executing the operation now...\n\n", is_complete=True)
        
        # Emit execution step
        yield ReasoningStep(
            step="executing",
            action_type=self._get_reasoning_action_type(action_type),
            message=self._get_action_message(action_type, params),
            details=params
        )
        
        # Check if this is a browser action - use streaming version for real-time updates
        is_browser_action = action_type in [
            DesktopActionType.BROWSER_RESEARCH,
            DesktopActionType.BROWSER_FORM_FILL,
            DesktopActionType.BROWSER_SCREENSHOT
        ]
        
        if is_browser_action:
            # Use streaming browser action for real-time screenshot updates
            final_success = False
            final_message = ""
            
            async for item in self._execute_browser_action_streaming(action_type, params):
                yield item  # Forward all events (ReasoningStep, BrowserAction)
                
                # Track completion status
                if isinstance(item, ReasoningStep):
                    if item.step == "browser_complete":
                        final_success = True
                        final_message = item.message
                    elif item.step == "browser_error":
                        final_success = False
                        final_message = item.message
            
            # Emit completion thinking
            if final_success:
                yield ThinkingToken(token="Done! ", is_complete=False)
                yield ThinkingToken(token=f"{final_message}\n\n", is_complete=True)
            else:
                yield ThinkingToken(token=f"I encountered an issue: {final_message}\n\n", is_complete=True)
        else:
            # Execute CLI command (file/document/skill actions)
            result = await self.execute_action(action_type, params, emit_reasoning=False)
            
            # Emit completion
            if result.success:
                yield ThinkingToken(token="Done! ", is_complete=False)
                yield ThinkingToken(token=f"{result.summary}\n\n", is_complete=True)
                
                yield ReasoningStep(
                    step="complete",
                    action_type=self._get_completion_action_type(action_type),
                    message=result.summary,
                    details={
                        "success": True,
                        "output_files": result.output_files,
                        "summary": result.summary
                    }
                )
            else:
                yield ThinkingToken(token=f"I encountered an issue: {result.error}\n\n", is_complete=True)
                
                yield ReasoningStep(
                    step="error",
                    action_type="desktop_planning",
                    message=f"Failed: {result.error}",
                    details={
                        "success": False,
                        "error": result.error
                    }
                )
    
    def _get_action_verb(self, action_type: DesktopActionType) -> str:
        """Get a conversational verb for the action type"""
        verbs = {
            DesktopActionType.FILE_ORGANIZE: "organize",
            DesktopActionType.FILE_RENAME: "rename the files in",
            DesktopActionType.FILE_MOVE: "move the files from",
            DesktopActionType.FILE_SORT: "sort the files in",
            DesktopActionType.DOCUMENT_CREATE: "create a document at",
            DesktopActionType.DOCUMENT_SUMMARIZE: "summarize the document at",
            DesktopActionType.DOCUMENT_REWRITE: "rewrite the document at",
            DesktopActionType.BROWSER_RESEARCH: "research",
            DesktopActionType.BROWSER_FORM_FILL: "fill out the form at",
            DesktopActionType.BROWSER_SCREENSHOT: "take a screenshot of",
            DesktopActionType.SKILL_EXECUTE: "run the skill",
            DesktopActionType.SKILL_CREATE: "create a skill for",
            DesktopActionType.SKILL_LIST: "list available skills",
        }
        return verbs.get(action_type, "perform the action on")
    
    def _get_action_target(self, action_type: DesktopActionType, params: Dict[str, Any]) -> str:
        """Get the target description for thinking tokens"""
        path = params.get("path", params.get("source_path", ""))
        destination = params.get("destination", params.get("output_path", ""))
        url = params.get("url", "")
        instructions = params.get("instructions", "")
        
        if action_type in [DesktopActionType.FILE_ORGANIZE, DesktopActionType.FILE_SORT, 
                          DesktopActionType.FILE_RENAME]:
            return f"'{path}'" if path else "your files"
        elif action_type == DesktopActionType.FILE_MOVE:
            return f"'{path}' to '{destination}'" if path and destination else "your files"
        elif action_type in [DesktopActionType.DOCUMENT_CREATE, DesktopActionType.DOCUMENT_SUMMARIZE,
                            DesktopActionType.DOCUMENT_REWRITE]:
            return f"'{destination or path}'" if (destination or path) else "the document"
        elif action_type == DesktopActionType.BROWSER_RESEARCH:
            topic = instructions[:50] + "..." if len(instructions) > 50 else instructions
            return f"'{topic}'" if topic else "the topic"
        elif action_type in [DesktopActionType.BROWSER_FORM_FILL, DesktopActionType.BROWSER_SCREENSHOT]:
            return f"'{url}'" if url else "the webpage"
        elif action_type == DesktopActionType.SKILL_EXECUTE:
            skill_name = params.get("skill_name", params.get("skill_id", ""))
            return f"'{skill_name}'" if skill_name else "the skill"
        elif action_type == DesktopActionType.SKILL_CREATE:
            name = params.get("name", "")
            return f"'{name}'" if name else "your automation"
        elif action_type == DesktopActionType.SKILL_LIST:
            return "your saved skills"
        
        return "the target"
    
    def _get_setup_phrase(self, action_type: DesktopActionType) -> str:
        """Get a setup phrase for thinking tokens"""
        phrases = {
            DesktopActionType.FILE_ORGANIZE: "analyze the folder contents",
            DesktopActionType.FILE_RENAME: "scan the files",
            DesktopActionType.FILE_MOVE: "prepare the file transfer",
            DesktopActionType.FILE_SORT: "read the file metadata",
            DesktopActionType.DOCUMENT_CREATE: "set up the document",
            DesktopActionType.DOCUMENT_SUMMARIZE: "read the document content",
            DesktopActionType.DOCUMENT_REWRITE: "analyze the document structure",
            DesktopActionType.BROWSER_RESEARCH: "open the browser",
            DesktopActionType.BROWSER_FORM_FILL: "navigate to the form",
            DesktopActionType.BROWSER_SCREENSHOT: "load the page",
            DesktopActionType.SKILL_EXECUTE: "load the skill definition",
            DesktopActionType.SKILL_CREATE: "set up the skill",
            DesktopActionType.SKILL_LIST: "read the skills database",
        }
        return phrases.get(action_type, "set up the operation")
    
    def _get_action_message(self, action_type: DesktopActionType, params: Dict[str, Any]) -> str:
        """Get a human-readable message for the action"""
        path = params.get("path", params.get("source_path", ""))
        destination = params.get("destination", params.get("output_path", ""))
        skill_name = params.get("skill_name", params.get("skill_id", ""))
        
        messages = {
            DesktopActionType.FILE_ORGANIZE: f"Organizing files in {path}",
            DesktopActionType.FILE_RENAME: f"Renaming files in {path}",
            DesktopActionType.FILE_MOVE: f"Moving files from {path} to {destination}",
            DesktopActionType.FILE_SORT: f"Sorting files in {path}",
            DesktopActionType.DOCUMENT_CREATE: f"Creating document at {destination}",
            DesktopActionType.DOCUMENT_SUMMARIZE: f"Summarizing document at {path}",
            DesktopActionType.DOCUMENT_REWRITE: f"Rewriting document at {path}",
            DesktopActionType.BROWSER_RESEARCH: f"Researching: {params.get('instructions', '')}",
            DesktopActionType.BROWSER_FORM_FILL: f"Filling form at {params.get('url', '')}",
            DesktopActionType.BROWSER_SCREENSHOT: f"Taking screenshot of {params.get('url', '')}",
            DesktopActionType.SKILL_EXECUTE: f"Executing skill: {skill_name}",
            DesktopActionType.SKILL_CREATE: f"Creating skill: {params.get('name', '')}",
            DesktopActionType.SKILL_LIST: "Listing available skills",
        }
        
        return messages.get(action_type, f"Executing {action_type.value}")
    
    def _get_reasoning_action_type(self, action_type: DesktopActionType) -> str:
        """Map desktop action type to reasoning step action type"""
        mapping = {
            DesktopActionType.FILE_ORGANIZE: "file_organizing",
            DesktopActionType.FILE_RENAME: "file_organizing",
            DesktopActionType.FILE_MOVE: "file_organizing",
            DesktopActionType.FILE_SORT: "file_organizing",
            DesktopActionType.DOCUMENT_CREATE: "document_creating",
            DesktopActionType.DOCUMENT_SUMMARIZE: "document_creating",
            DesktopActionType.DOCUMENT_REWRITE: "document_creating",
            DesktopActionType.BROWSER_RESEARCH: "browser_researching",
            DesktopActionType.BROWSER_FORM_FILL: "browser_researching",
            DesktopActionType.BROWSER_SCREENSHOT: "browser_researching",
            DesktopActionType.SKILL_EXECUTE: "skill_executing",
            DesktopActionType.SKILL_CREATE: "skill_creating",
            DesktopActionType.SKILL_LIST: "skill_listing",
        }
        return mapping.get(action_type, "desktop_planning")
    
    def _get_completion_action_type(self, action_type: DesktopActionType) -> str:
        """Map desktop action type to completion step action type"""
        mapping = {
            DesktopActionType.FILE_ORGANIZE: "file_complete",
            DesktopActionType.FILE_RENAME: "file_complete",
            DesktopActionType.FILE_MOVE: "file_complete",
            DesktopActionType.FILE_SORT: "file_complete",
            DesktopActionType.DOCUMENT_CREATE: "document_complete",
            DesktopActionType.DOCUMENT_SUMMARIZE: "document_complete",
            DesktopActionType.DOCUMENT_REWRITE: "document_complete",
            DesktopActionType.BROWSER_RESEARCH: "browser_complete",
            DesktopActionType.BROWSER_FORM_FILL: "browser_complete",
            DesktopActionType.BROWSER_SCREENSHOT: "browser_complete",
            DesktopActionType.SKILL_EXECUTE: "skill_complete",
            DesktopActionType.SKILL_CREATE: "skill_complete",
            DesktopActionType.SKILL_LIST: "skill_complete",
        }
        return mapping.get(action_type, "complete")
    
    async def close(self):
        """Cleanup (no-op for CLI mode, kept for interface compatibility)"""
        pass


# Singleton instance
opencode_service = OpenCodeBridgeService()
