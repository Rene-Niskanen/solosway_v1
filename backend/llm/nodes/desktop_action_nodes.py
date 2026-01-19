"""
Desktop Action Nodes - LangGraph nodes for handling desktop automation requests.

These nodes handle file management, document creation, and browser automation
requests via the OpenCode bridge service.

Flow:
1. detect_desktop_intent_node: LLM determines if query is a desktop action request
2. handle_desktop_action: Executes the action via OpenCode and returns results
"""

import logging
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.types import MainWorkflowState
from backend.llm.config import config
from backend.services.opencode_bridge import opencode_service, DesktopActionType, OpenCodeResult, ReasoningStep, ThinkingToken, BrowserAction

logger = logging.getLogger(__name__)


async def detect_desktop_intent_llm(user_query: str) -> dict:
    """
    LLM-based detection of desktop automation intent.
    
    Uses a fast LLM to determine if the user wants to:
    - Perform file operations (organize, sort, rename, move)
    - Create/modify documents (create, summarize, rewrite)
    - Automate browser tasks (research, form fill, screenshot)
    
    Returns:
        dict with keys:
        - is_desktop_action: bool - True if this is a desktop action request
        - action_category: str or None - 'file_management', 'document_creation', 'browser_automation'
        - action_type: str or None - Specific action like 'organize', 'create', 'research'
        - params: dict - Extracted parameters (path, content, url, etc.)
        - reason: str - Why this decision was made
    """
    system_prompt = """You are a query intent classifier. Your job is to detect if the user wants DESKTOP AUTOMATION (browser, files, documents, or skills).

**CRITICAL RULE - MUST CHECK FIRST:**
If the query contains ANY of these words/patterns, it IS browser automation (is_desktop_action=true, action_category="browser_automation"):
- "google" → BROWSER AUTOMATION
- "website" → BROWSER AUTOMATION  
- "web" → BROWSER AUTOMATION
- "internet" → BROWSER AUTOMATION
- "online" → BROWSER AUTOMATION
- ".com" or ".org" or ".net" → BROWSER AUTOMATION
- "browser" → BROWSER AUTOMATION
- "search for" + topic (not documents) → BROWSER AUTOMATION
- "fill form" or "fill out form" → action_type: 'form_fill'

**BROWSER AUTOMATION** (action_category: 'browser_automation'):
- "go to google" → action_type: 'research'
- "go to google and search for cat pictures" → action_type: 'research'
- "please go to google and find me cat pictures" → action_type: 'research'
- "open google.com" → action_type: 'research'
- "search for X on the web" → action_type: 'research'
- "find X online" → action_type: 'research'
- "research X on the internet" → action_type: 'research'
- "open bbc.com" → action_type: 'research'
- "fill out the form on example.com" → action_type: 'form_fill'
- "complete the registration form" → action_type: 'form_fill'
- "log into the website" → action_type: 'form_fill'

**FILE MANAGEMENT** (action_category: 'file_management'):
- "organize my downloads folder" → action_type: 'organize'
- "sort files" → action_type: 'sort'
- "rename files" → action_type: 'rename'
- "move files" → action_type: 'move'

**DOCUMENT CREATION** (action_category: 'document_creation'):
- "create a document" → action_type: 'create'
- "summarize this file" → action_type: 'summarize'
- "rewrite this document" → action_type: 'rewrite'

**SKILLS** (action_category: 'skill'):
- "run the google search skill" → action_type: 'execute', params.skill_name: 'Google Search'
- "execute skill X" → action_type: 'execute'
- "list my skills" → action_type: 'list'
- "show available skills" → action_type: 'list'
- "create a skill to do X" → action_type: 'create'
- "save this as a skill" → action_type: 'create'

**NOT DESKTOP** (is_desktop_action=false):
- Queries about property values, documents in the system, map navigation
- "what is the value of the property" → NOT desktop
- "show me the highlands property" → NOT desktop (this is in-app navigation)
- "find the valuation report" → NOT desktop (document search)

Extract relevant parameters:
- path: folder/file path mentioned (e.g., "downloads", "~/Documents", "/Users/name/Desktop")
- destination: target folder for move operations
- pattern: organization pattern (by_type, by_date)
- content: text content for document creation
- url: website URL for browser tasks
- instructions: detailed instructions for the task
- skill_name: name of skill to execute
- skill_id: ID of skill to execute
- form_data: form field values for form_fill (e.g., {"email": "user@example.com", "password": "xxx"})

Respond in this exact JSON format:
{
  "is_desktop_action": true/false,
  "action_category": "file_management" | "document_creation" | "browser_automation" | "skill" | null,
  "action_type": "organize" | "sort" | "rename" | "move" | "create" | "summarize" | "rewrite" | "research" | "form_fill" | "screenshot" | "execute" | "list" | null,
  "params": {
    "path": "extracted path or null",
    "destination": "destination path or null",
    "pattern": "pattern or null",
    "content": "content or null",
    "url": "url or null",
    "instructions": "detailed instructions or null",
    "skill_name": "skill name or null",
    "skill_id": "skill id or null",
    "form_data": {"field": "value"} or null
  },
  "reason": "brief explanation"
}"""

    human_prompt = f'User query: "{user_query}"'
    
    try:
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model="gpt-4o-mini",
            temperature=0,
            timeout=5,  # Fast timeout
        )
        
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ])
        
        result_text = response.content.strip()
        
        # Parse JSON response
        import json
        
        # Handle markdown code blocks if present
        if result_text.startswith('```'):
            result_text = result_text.split('```')[1]
            if result_text.startswith('json'):
                result_text = result_text[4:]
        
        result = json.loads(result_text)
        
        logger.info(f"🖥️ [DESKTOP_DETECT] LLM result: is_desktop={result.get('is_desktop_action')}, "
                   f"category={result.get('action_category')}, type={result.get('action_type')}")
        
        return result
        
    except json.JSONDecodeError as e:
        logger.warning(f"🖥️ [DESKTOP_DETECT] JSON parse error: {e}, response: {result_text[:200]}")
        return {
            "is_desktop_action": False,
            "action_category": None,
            "action_type": None,
            "params": {},
            "reason": f"JSON parse error: {str(e)}"
        }
    except Exception as e:
        logger.warning(f"🖥️ [DESKTOP_DETECT] LLM detection failed: {e}, defaulting to NOT desktop")
        return {
            "is_desktop_action": False,
            "action_category": None,
            "action_type": None,
            "params": {},
            "reason": f"LLM error, defaulting to not desktop: {str(e)}"
        }


async def detect_desktop_intent_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node that runs LLM-based desktop intent detection.
    Sets desktop_intent in state for router to use.
    """
    user_query = state.get("user_query", "").strip()
    is_agent_mode = state.get("is_agent_mode", False)
    
    # Only detect desktop intents in agent mode
    if not is_agent_mode or not user_query:
        return {"desktop_intent": None}
    
    # Check if OpenCode is enabled
    if not opencode_service.enabled:
        logger.debug("🖥️ [DESKTOP_DETECT] OpenCode disabled, skipping detection")
        return {"desktop_intent": None}
    
    logger.info(f"🖥️ [DESKTOP_DETECT] Running LLM detection for: '{user_query[:60]}...'")
    
    result = await detect_desktop_intent_llm(user_query)
    
    return {"desktop_intent": result}


def _map_action_to_desktop_type(action_category: str, action_type: str) -> Optional[DesktopActionType]:
    """Map detected action to DesktopActionType enum"""
    mapping = {
        ('file_management', 'organize'): DesktopActionType.FILE_ORGANIZE,
        ('file_management', 'sort'): DesktopActionType.FILE_SORT,
        ('file_management', 'rename'): DesktopActionType.FILE_RENAME,
        ('file_management', 'move'): DesktopActionType.FILE_MOVE,
        ('document_creation', 'create'): DesktopActionType.DOCUMENT_CREATE,
        ('document_creation', 'summarize'): DesktopActionType.DOCUMENT_SUMMARIZE,
        ('document_creation', 'rewrite'): DesktopActionType.DOCUMENT_REWRITE,
        ('browser_automation', 'research'): DesktopActionType.BROWSER_RESEARCH,
        ('browser_automation', 'form_fill'): DesktopActionType.BROWSER_FORM_FILL,
        ('browser_automation', 'screenshot'): DesktopActionType.BROWSER_SCREENSHOT,
        ('skill', 'execute'): DesktopActionType.SKILL_EXECUTE,
        ('skill', 'create'): DesktopActionType.SKILL_CREATE,
        ('skill', 'list'): DesktopActionType.SKILL_LIST,
    }
    return mapping.get((action_category, action_type))


async def handle_desktop_action(state: MainWorkflowState) -> MainWorkflowState:
    """
    Handle desktop automation requests via OpenCode bridge.
    
    This node:
    1. Extracts action type and parameters from state
    2. Executes via OpenCode service with STREAMING to collect reasoning steps
    3. Returns results with accumulated reasoning steps for SSE emission
    
    Returns:
        State with final_summary, agent_actions, reasoning steps, and thinking tokens
    """
    desktop_intent = state.get("desktop_intent", {})
    user_query = state.get("user_query", "")
    
    if not desktop_intent or not desktop_intent.get("is_desktop_action"):
        logger.warning("🖥️ [DESKTOP_ACTION] Called without desktop intent")
        return {
            "final_summary": "I'm sorry, I couldn't understand that as a desktop action request.",
            "agent_actions": [],
            "desktop_reasoning_steps": [],
            "thinking_tokens": []
        }
    
    action_category = desktop_intent.get("action_category")
    action_type = desktop_intent.get("action_type")
    params = desktop_intent.get("params", {})
    
    logger.info(f"🖥️ [DESKTOP_ACTION] Executing: {action_category}/{action_type}")
    logger.info(f"🖥️ [DESKTOP_ACTION] Params: {params}")
    
    # Map to DesktopActionType
    desktop_action_type = _map_action_to_desktop_type(action_category, action_type)
    
    if not desktop_action_type:
        logger.error(f"🖥️ [DESKTOP_ACTION] Unknown action: {action_category}/{action_type}")
        return {
            "final_summary": f"I'm sorry, I don't know how to perform that action: {action_type}",
            "agent_actions": [],
            "desktop_reasoning_steps": [],
            "thinking_tokens": []
        }
    
    # Build parameters for OpenCode
    opencode_params = {}
    
    if action_category == 'file_management':
        opencode_params = {
            'path': params.get('path', ''),
            'destination': params.get('destination'),
            'pattern': params.get('pattern'),
            'filter_pattern': params.get('filter_pattern'),
            'instructions': user_query  # Pass original query for context
        }
    elif action_category == 'document_creation':
        opencode_params = {
            'content': params.get('content'),
            'source_path': params.get('path'),
            'output_path': params.get('destination') or params.get('path', '').replace('.', '_output.'),
            'template': params.get('pattern'),
            'instructions': user_query
        }
    elif action_category == 'browser_automation':
        opencode_params = {
            'url': params.get('url'),
            'instructions': params.get('instructions') or user_query,
            'output_path': params.get('destination'),
            'form_data': params.get('form_data')  # For form_fill action
        }
    elif action_category == 'skill':
        opencode_params = {
            'skill_id': params.get('skill_id'),
            'skill_name': params.get('skill_name'),
            'query': user_query,  # For trigger phrase matching
            'variables': params.get('form_data') or {},  # Use form_data as variables
            # For skill creation
            'name': params.get('skill_name'),
            'description': params.get('instructions') or user_query,
            'actions': params.get('actions', []),
            'tags': params.get('tags', []),
            'trigger_phrases': [user_query] if action_type == 'create' else []
        }
    
    # Collect reasoning steps and thinking tokens during streaming execution
    reasoning_steps = []
    thinking_tokens = []
    final_result = None
    
    # Use streaming execution to collect reasoning steps as they happen
    logger.info(f"🖥️ [DESKTOP_ACTION] Starting streaming execution...")
    
    # Collect browser actions for embedded webview in frontend
    browser_actions = []
    
    try:
        async for item in opencode_service.execute_streaming_with_thinking(
            action_type=desktop_action_type,
            params=opencode_params
        ):
            if isinstance(item, ThinkingToken):
                thinking_tokens.append({
                    'token': item.token,
                    'is_complete': item.is_complete
                })
                token_preview = item.token[:30] if item.token else ""
                logger.debug(f"🖥️ [DESKTOP_ACTION] Collected thinking token: {token_preview}...")
            elif isinstance(item, BrowserAction):
                browser_actions.append({
                    'action_type': item.action_type,
                    'url': item.url,
                    'selector': item.selector,
                    'text': item.text,
                    'direction': item.direction
                })
                logger.info(f"🖥️ [DESKTOP_ACTION] Collected browser action: {item.action_type}")
            elif isinstance(item, ReasoningStep):
                reasoning_steps.append({
                    'step': item.step,
                    'action_type': item.action_type,
                    'message': item.message,
                    'details': item.details
                })
                logger.info(f"🖥️ [DESKTOP_ACTION] Collected reasoning step: {item.action_type} - {item.message}")
                
                # Check for final result in the step details
                # Browser actions emit 'browser_complete', other actions emit 'complete'
                if item.step in ('complete', 'browser_complete', 'error', 'browser_error'):
                    final_result = item.details
                    # Mark success based on step type
                    if item.step in ('complete', 'browser_complete'):
                        final_result['success'] = True
                        final_result['summary'] = item.message
                    elif item.step in ('error', 'browser_error'):
                        final_result['success'] = False
                        final_result['error'] = item.message
    except Exception as e:
        logger.error(f"🖥️ [DESKTOP_ACTION] Streaming execution error: {e}", exc_info=True)
        # Fall back to non-streaming execution
        result = await opencode_service.execute_action(
            action_type=desktop_action_type,
            params=opencode_params,
            emit_reasoning=True
        )
        final_result = {
            'success': result.success,
            'summary': result.summary,
            'output_files': result.output_files,
            'error': result.error
        }
        # Convert result steps to dict format
        for step in result.steps:
            reasoning_steps.append({
                'step': step.step,
                'action_type': step.action_type,
                'message': step.message,
                'details': step.details
            })
    
    logger.info(f"🖥️ [DESKTOP_ACTION] Collected {len(reasoning_steps)} reasoning steps, {len(thinking_tokens)} thinking tokens")
    
    # Determine success from final result or last step
    success = False
    summary = ""
    output_files = []
    error = None
    
    if final_result:
        success = final_result.get('success', False)
        summary = final_result.get('summary', '')
        output_files = final_result.get('output_files', [])
        error = final_result.get('error')
    elif reasoning_steps:
        # Check last step for success/error
        last_step = reasoning_steps[-1]
        if last_step.get('step') == 'complete':
            success = True
            summary = last_step.get('message', 'Operation completed')
        elif last_step.get('step') == 'error':
            success = False
            error = last_step.get('message', 'Unknown error')
    
    # Build agent actions for frontend
    agent_actions = []
    
    if success:
        # Add desktop completion action
        agent_actions.append({
            'action': 'desktop_complete',
            'action_category': action_category,
            'action_type': action_type,
            'output_files': output_files,
            'reason': f"Completed {action_type} operation"
        })
    else:
        agent_actions.append({
            'action': 'desktop_error',
            'action_category': action_category,
            'action_type': action_type,
            'error': error,
            'reason': f"Failed to complete {action_type} operation"
        })
    
    # Build summary
    if success:
        if not summary:
            summary = f"Successfully completed {action_type} operation."
        if output_files:
            summary += f"\n\nOutput files:\n" + "\n".join(f"- {f}" for f in output_files)
    else:
        if not summary:
            summary = f"I encountered an issue while trying to {action_type}: {error or 'Unknown error'}\n\n"
            summary += "Please make sure:\n"
            summary += "- OpenCode CLI is installed (`npm install -g @opencode/cli`)\n"
            summary += "- The folder path is correct and accessible\n"
            summary += f"- The folder is in the allowed list (OPENCODE_ALLOWED_FOLDERS)"
    
    return {
        "final_summary": summary,
        "agent_actions": agent_actions,
        "desktop_result": {
            "success": success,
            "action_category": action_category,
            "action_type": action_type,
            "output_files": output_files,
            "error": error,
            "summary": summary
        },
        "desktop_reasoning_steps": reasoning_steps,
        "thinking_tokens": thinking_tokens,
        "browser_actions": browser_actions  # Browser action commands for embedded webview
    }
