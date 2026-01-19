"""
Reflection Engine Service - Evaluate progress and suggest corrections.

This service provides meta-cognition for the autonomous agent:
- Evaluates if actions achieved their intended purpose
- Detects when the agent is stuck or going in circles
- Suggests alternative approaches when needed
- Decides when to backtrack or replan

Enables smarter, more adaptive browsing behavior.
"""

import logging
import json
from typing import List, Dict, Any, Optional, Literal
from dataclasses import dataclass
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.services.task_planner_service import SubGoal
from backend.services.working_memory_service import Finding, ActionRecord

logger = logging.getLogger(__name__)


@dataclass
class ReflectionResult:
    """Result of reflecting on an action"""
    on_track: bool  # Are we making progress toward the goal?
    goal_achieved: bool  # Is the current sub-goal complete?
    should_extract: bool  # Should we extract information from this page?
    suggested_action: Literal["continue", "backtrack", "replan", "extract", "done"]
    reasoning: str
    confidence: float  # How confident is this assessment?
    alternative_approach: Optional[str] = None  # If stuck, what else to try


class ReflectionEngine:
    """
    Service for evaluating agent progress and suggesting corrections.
    
    Provides "thinking about thinking" capabilities to help the agent:
    - Recognize when actions aren't working
    - Detect loops and stuck states
    - Suggest alternative approaches
    - Know when a goal is truly complete
    """
    
    def __init__(self):
        self.llm = None
        self._stuck_threshold = 3  # Actions without progress before considering stuck
        self._loop_threshold = 2  # Repeated identical actions before detecting loop
    
    def _get_llm(self) -> ChatOpenAI:
        """Lazy-load LLM"""
        if self.llm is None:
            self.llm = ChatOpenAI(
                api_key=config.openai_api_key,
                model="gpt-4o-mini",
                temperature=0,
                timeout=20
            )
        return self.llm
    
    async def evaluate_step(
        self,
        action_taken: str,
        url_before: str,
        url_after: str,
        current_goal: SubGoal,
        findings_so_far: List[Finding],
        action_history: List[ActionRecord],
        aria_snapshot: Optional[str] = None
    ) -> ReflectionResult:
        """
        Evaluate whether the last action made progress toward the goal.
        
        Args:
            action_taken: The action that was just executed
            url_before: URL before the action
            url_after: URL after the action
            current_goal: The sub-goal we're working on
            findings_so_far: What we've found so far for this goal
            action_history: Recent action history
            aria_snapshot: Optional current page snapshot
            
        Returns:
            ReflectionResult with assessment and recommendations
        """
        logger.info(f"🤔 [REFLECTION] Evaluating action: {action_taken}")
        
        # Quick heuristic checks first
        url_changed = url_before != url_after
        
        # Check if images were extracted (for image-related goals)
        goal_lower = current_goal.description.lower()
        is_image_goal = any(kw in goal_lower for kw in ["image", "photo", "picture", "show me"])
        images_extracted = False
        if is_image_goal and findings_so_far:
            # Check if any findings contain image_data
            for finding in findings_so_far:
                if hasattr(finding, 'metadata') and finding.metadata.get('image_data'):
                    images_extracted = True
                    break
                # Also check raw finding dict format
                if isinstance(finding, dict) and finding.get('image_data'):
                    images_extracted = True
                    break
        
        # Check for CAPTCHA/reCAPTCHA pages
        captcha_detected = self._detect_captcha(url_after, aria_snapshot)
        if captcha_detected:
            logger.warning("🤔 [REFLECTION] CAPTCHA detected!")
            return ReflectionResult(
                on_track=False,
                goal_achieved=False,
                should_extract=False,
                suggested_action="replan",
                reasoning="CAPTCHA challenge detected - manual intervention may be required",
                confidence=0.95,
                alternative_approach="Wait a few moments and retry, or use an alternative search engine. User may need to complete CAPTCHA manually."
            )
        
        # Check for obvious loops
        if self._detect_loop(action_taken, action_history):
            logger.warning("🤔 [REFLECTION] Loop detected!")
            return ReflectionResult(
                on_track=False,
                goal_achieved=False,
                should_extract=False,
                suggested_action="backtrack",
                reasoning="Detected action loop - same action repeated without progress",
                confidence=0.9,
                alternative_approach="Try a different element or navigate to a different page"
            )
        
        # Check for stuck state
        if self._detect_stuck(action_history):
            logger.warning("🤔 [REFLECTION] Stuck state detected!")
            
            # Get more specific alternative based on recent failures
            recent_actions = [h.action_data.get("action", h.action_type) for h in action_history[-5:]]
            alternative = await self._suggest_retry_alternative(
                current_goal=current_goal,
                failed_actions=recent_actions,
                current_url=url_after,
                aria_snapshot=aria_snapshot
            )
            
            return ReflectionResult(
                on_track=False,
                goal_achieved=False,
                should_extract=False,
                suggested_action="replan",
                reasoning="Multiple actions without URL change or new findings",
                confidence=0.8,
                alternative_approach=alternative
            )
        
        # Check for consecutive failures (2-3 in a row)
        if len(action_history) >= 2:
            recent_failures = [h for h in action_history[-3:] if not h.success]
            if len(recent_failures) >= 2:
                logger.warning(f"🤔 [REFLECTION] {len(recent_failures)} consecutive failures detected!")
                # Suggest alternative approach for retry
                recent_action_types = [h.action_type for h in recent_failures]
                alternative = await self._suggest_retry_alternative(
                    current_goal=current_goal,
                    failed_actions=recent_action_types,
                    current_url=url_after,
                    aria_snapshot=aria_snapshot
                )
                
                # Don't return immediately - let LLM also evaluate, but add alternative
                # This will be used in the LLM evaluation prompt
        
        # Use LLM for nuanced evaluation
        return await self._llm_evaluate(
            action_taken=action_taken,
            url_before=url_before,
            url_after=url_after,
            url_changed=url_changed,
            current_goal=current_goal,
            findings_so_far=findings_so_far,
            aria_snapshot=aria_snapshot,
            images_extracted=images_extracted
        )
    
    def _detect_loop(
        self, 
        current_action: str, 
        history: List[ActionRecord]
    ) -> bool:
        """Detect if we're in an action loop"""
        if len(history) < self._loop_threshold:
            return False
        
        # Check if the same action is being repeated
        recent_actions = [h.action_data.get("action", "") for h in history[-3:]]
        
        # Normalize actions for comparison
        current_normalized = current_action.strip().lower()
        recent_normalized = [a.strip().lower() for a in recent_actions]
        
        # Count how many recent actions match current
        matches = sum(1 for a in recent_normalized if a == current_normalized)
        
        return matches >= self._loop_threshold
    
    def _detect_stuck(self, history: List[ActionRecord]) -> bool:
        """Detect if we're stuck (many actions without progress)"""
        if len(history) < self._stuck_threshold:
            return False
        
        recent = history[-self._stuck_threshold:]
        
        # Check if URLs haven't changed
        urls_unchanged = all(
            h.url_before == h.url_after 
            for h in recent
        )
        
        # Check if all recent actions failed
        all_failed = all(not h.success for h in recent)
        
        return urls_unchanged or all_failed
    
    def _detect_captcha(self, url: str, aria_snapshot: Optional[str] = None) -> bool:
        """
        Detect if the current page is a CAPTCHA/reCAPTCHA challenge.
        
        Args:
            url: Current URL
            aria_snapshot: Optional ARIA snapshot of the page
            
        Returns:
            True if CAPTCHA is detected
        """
        url_lower = url.lower()
        
        # Check URL patterns for CAPTCHA pages
        captcha_url_patterns = [
            'sorry/index',  # Google CAPTCHA
            'captcha',
            'recaptcha',
            'challenge',
            'verify',
            'unusual traffic'
        ]
        
        if any(pattern in url_lower for pattern in captcha_url_patterns):
            return True
        
        # Check ARIA snapshot for CAPTCHA indicators
        if aria_snapshot:
            snapshot_lower = aria_snapshot.lower()
            captcha_text_patterns = [
                'unusual traffic',
                'verify you\'re not a robot',
                'captcha',
                'recaptcha',
                'i\'m not a robot',
                'verify you are human'
            ]
            
            if any(pattern in snapshot_lower for pattern in captcha_text_patterns):
                return True
        
        return False
    
    async def _llm_evaluate(
        self,
        action_taken: str,
        url_before: str,
        url_after: str,
        url_changed: bool,
        current_goal: SubGoal,
        findings_so_far: List[Finding],
        aria_snapshot: Optional[str] = None,
        images_extracted: bool = False
    ) -> ReflectionResult:
        """Use LLM for nuanced action evaluation"""
        
        # Format findings
        findings_summary = "None yet"
        if findings_so_far:
            findings_summary = "\n".join(f"• {f.fact}" for f in findings_so_far)
        
        # Truncate snapshot for context
        snapshot_preview = ""
        if aria_snapshot:
            snapshot_preview = f"\n\nCURRENT PAGE PREVIEW:\n{aria_snapshot[:2000]}"
        
        system_prompt = """You are a reflection agent evaluating browser automation progress.

Your job is to assess:
1. Did the action achieve what was intended?
2. Are we making progress toward the goal?
3. Should we extract information from the current page?
4. Is the goal now complete?

DECISION FRAMEWORK:

ON_TRACK = true if:
- URL changed to a relevant page
- New information is visible that relates to the goal
- We're moving closer to the expected result

GOAL_ACHIEVED = true if:
- The expected result is now visible/found
- We have extracted the key information needed
- There's nothing more to find for this specific goal
- For "show photos/images" goals: We're on Google Images (udm=2 in URL) AND images have been extracted
- For image goals: If images were successfully extracted from the page (check findings for image_data)
- For "search for X" goals: We're on search results page with the correct query

SHOULD_EXTRACT = true if:
- The current page has relevant information
- We haven't already extracted from this page
- The data matches what we're looking for

SUGGESTED_ACTION:
- "continue": Keep going, we're on the right track
- "extract": Stop and extract information from this page
- "backtrack": Go back, this path isn't productive
- "replan": Need a different approach entirely
- "done": Goal is complete

Output valid JSON:
{
  "on_track": true/false,
  "goal_achieved": true/false,
  "should_extract": true/false,
  "suggested_action": "continue|extract|backtrack|replan|done",
  "reasoning": "Brief explanation",
  "confidence": 0.8,
  "alternative_approach": "If not on track, what to try instead" or null
}"""

        human_prompt = f"""Evaluate this action:

GOAL: {current_goal.description}
EXPECTED RESULT: {current_goal.expected_result}

ACTION TAKEN: {action_taken}
URL BEFORE: {url_before}
URL AFTER: {url_after}
URL CHANGED: {url_changed}

SPECIAL DETECTION:
- If goal mentions "photos", "images", or "show me" AND URL contains "udm=2" or "/images" AND images have been extracted: Goal is ACHIEVED
- If goal is image-related AND images were extracted (check findings for image_data): Goal is ACHIEVED
- If goal is to "search for X" AND URL is a Google search results page with query matching X: Goal is ACHIEVED

IMAGES EXTRACTED: {images_extracted} (check findings for image_data if True)

FINDINGS SO FAR:
{findings_summary}
{snapshot_preview}

Did this action make progress? Is the goal now complete? Return JSON."""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt)
            ])
            
            result_text = response.content.strip()
            
            # Handle markdown
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
                if result_text.startswith('json'):
                    result_text = result_text[4:].strip()
            
            data = json.loads(result_text)
            
            result = ReflectionResult(
                on_track=data.get("on_track", True),
                goal_achieved=data.get("goal_achieved", False),
                should_extract=data.get("should_extract", False),
                suggested_action=data.get("suggested_action", "continue"),
                reasoning=data.get("reasoning", ""),
                confidence=data.get("confidence", 0.7),
                alternative_approach=data.get("alternative_approach")
            )
            
            logger.info(f"🤔 [REFLECTION] Result: on_track={result.on_track}, "
                       f"goal_achieved={result.goal_achieved}, suggested={result.suggested_action}")
            
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"🤔 [REFLECTION] JSON parse error: {e}")
            # Default to continuing
            return ReflectionResult(
                on_track=True,
                goal_achieved=False,
                should_extract=False,
                suggested_action="continue",
                reasoning=f"Evaluation failed: {e}",
                confidence=0.5
            )
        except Exception as e:
            logger.error(f"🤔 [REFLECTION] Evaluation error: {e}")
            return ReflectionResult(
                on_track=True,
                goal_achieved=False,
                should_extract=False,
                suggested_action="continue",
                reasoning=f"Evaluation error: {e}",
                confidence=0.5
            )
    
    async def should_backtrack(
        self,
        action_history: List[ActionRecord],
        findings: List[Finding],
        current_goal: SubGoal
    ) -> bool:
        """
        Determine if we should abandon current path and try something else.
        
        Args:
            action_history: Recent actions
            findings: What we've found
            current_goal: Current sub-goal
            
        Returns:
            True if backtracking is recommended
        """
        # Quick check: if we have findings for this goal, don't backtrack
        goal_findings = [f for f in findings if f.goal_id == current_goal.id]
        if goal_findings:
            return False
        
        # Check if recent actions show no progress
        if len(action_history) < 5:
            return False
        
        recent = action_history[-5:]
        
        # If no URL changes in 5 actions, consider backtracking
        url_unchanged = all(h.url_before == h.url_after for h in recent)
        
        # If high failure rate, consider backtracking
        failures = sum(1 for h in recent if not h.success)
        high_failure = failures >= 3
        
        return url_unchanged or high_failure
    
    async def suggest_alternative(
        self,
        current_goal: SubGoal,
        attempted_actions: List[str],
        current_url: str
    ) -> str:
        """
        Suggest an alternative approach when stuck.
        
        Args:
            current_goal: What we're trying to achieve
            attempted_actions: What we've already tried
            current_url: Where we are now
            
        Returns:
            Suggested alternative approach
        """
        attempted_str = "\n".join(f"• {a}" for a in attempted_actions[-5:])
        
        prompt = f"""We're stuck trying to achieve this goal:

GOAL: {current_goal.description}
EXPECTED: {current_goal.expected_result}

CURRENT URL: {current_url}

ACTIONS ALREADY TRIED:
{attempted_str}

Suggest ONE specific alternative approach to try. Be concrete and actionable.
Just give the suggestion, no explanation needed."""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip()
        except Exception as e:
            logger.error(f"🤔 [REFLECTION] Alternative suggestion error: {e}")
            return "Try navigating directly to a different search engine or source"
    
    async def _suggest_retry_alternative(
        self,
        current_goal: SubGoal,
        failed_actions: List[str],
        current_url: str,
        aria_snapshot: Optional[str] = None
    ) -> str:
        """
        Suggest a specific retry alternative based on failed actions.
        
        This provides more targeted suggestions than the general suggest_alternative.
        
        Args:
            current_goal: Current sub-goal
            failed_actions: List of actions that failed
            current_url: Current URL
            aria_snapshot: Optional ARIA snapshot for context
            
        Returns:
            Specific alternative approach to try
        """
        # Quick heuristics for common failure patterns
        failed_str = " ".join(failed_actions).lower()
        
        # If clicks are failing, suggest typing or different selector
        if "click" in failed_str:
            if "search" in current_url.lower() or "google" in current_url.lower():
                return "Try using TYPE action on the search box instead of clicking. Look for a textbox element in the ARIA snapshot and TYPE your query, then PRESS Enter."
            else:
                return "Try a different element or use TYPE/NAVIGATE instead of CLICK. Check the ARIA snapshot for alternative interactive elements."
        
        # If typing is failing, suggest checking if element exists or using navigate
        if "type" in failed_str:
            return "The text input may not be ready or may not exist. Try waiting a moment, or use NAVIGATE to go directly to a search results page with the query in the URL."
        
        # If navigation is failing, suggest alternative URL or search engine
        if "navigate" in failed_str:
            if "google" in current_url.lower():
                return "Try using a different search engine (Bing, DuckDuckGo) or construct the URL differently. For Google Images, ensure 'udm=2' parameter is in the URL."
            else:
                return "Try navigating to a simpler URL or use a search engine to find the target page."
        
        # Default: use LLM for more nuanced suggestion
        try:
            snapshot_preview = aria_snapshot[:1000] if aria_snapshot else "No snapshot available"
            prompt = f"""Recent actions failed:
{failed_actions[-3:]}

Goal: {current_goal.description}
Current URL: {current_url}
Page preview: {snapshot_preview[:500]}

Suggest ONE specific alternative action to retry. Be concrete (e.g., "TYPE e5 [query] then PRESS Enter" or "NAVIGATE to https://...")."""
            
            llm = self._get_llm()
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip()
        except Exception as e:
            logger.error(f"🤔 [REFLECTION] Retry alternative suggestion error: {e}")
            return "Try a different action type or navigate to an alternative source"
    
    def calculate_progress_score(
        self,
        goals_completed: int,
        total_goals: int,
        findings_count: int,
        actions_taken: int
    ) -> float:
        """
        Calculate overall progress score for the session.
        
        Args:
            goals_completed: Number of completed sub-goals
            total_goals: Total sub-goals
            findings_count: Number of findings extracted
            actions_taken: Total actions taken
            
        Returns:
            Progress score 0-1
        """
        if total_goals == 0:
            return 0.0
        
        # Goal completion is primary factor
        goal_progress = goals_completed / total_goals * 0.6
        
        # Findings contribute
        findings_score = min(findings_count / 10, 1.0) * 0.3  # Cap at 10 findings
        
        # Efficiency bonus (fewer actions = better)
        if actions_taken > 0:
            efficiency = max(0, 1 - (actions_taken / 50)) * 0.1
        else:
            efficiency = 0.1
        
        return goal_progress + findings_score + efficiency


# Global singleton instance
reflection_engine = ReflectionEngine()
