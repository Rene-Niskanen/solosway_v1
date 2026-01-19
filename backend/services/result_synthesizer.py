"""
Result Synthesizer Service - Generate final answers from findings.

This service combines all extracted findings into a coherent, well-structured
response to the original task. It:
- Aggregates findings from multiple pages/sources
- Resolves conflicts between different sources
- Generates a natural language response
- Cites sources appropriately

Enables the agent to provide comprehensive, sourced answers.
"""

import logging
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.services.working_memory_service import Finding
from backend.services.task_planner_service import SubGoal

logger = logging.getLogger(__name__)


@dataclass
class SynthesizedResult:
    """Final synthesized answer to the original task"""
    answer: str  # Direct response to the original task
    findings: List[Finding]  # Supporting evidence
    sources: List[str]  # URLs used
    confidence: float  # Overall confidence in the answer
    caveats: List[str] = field(default_factory=list)  # Limitations/uncertainties
    summary: str = ""  # Brief one-line summary
    data_points: Dict[str, Any] = field(default_factory=dict)  # Structured data if applicable
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "answer": self.answer,
            "findings": [f.to_dict() for f in self.findings],
            "sources": self.sources,
            "confidence": self.confidence,
            "caveats": self.caveats,
            "summary": self.summary,
            "data_points": self.data_points
        }


class ResultSynthesizer:
    """
    Service for synthesizing final results from browsing sessions.
    
    Takes all accumulated findings and generates a coherent,
    well-structured response to the original task.
    """
    
    def __init__(self):
        self.llm = None
    
    def _get_llm(self) -> ChatOpenAI:
        """Lazy-load LLM"""
        if self.llm is None:
            self.llm = ChatOpenAI(
                api_key=config.openai_api_key,
                model="gpt-4o",  # Use more capable model for synthesis
                temperature=0.3,  # Slightly higher for natural writing
                timeout=60
            )
        return self.llm
    
    async def synthesize(
        self,
        original_task: str,
        findings: List[Finding],
        goals_completed: List[SubGoal],
        goals_failed: Optional[List[SubGoal]] = None
    ) -> SynthesizedResult:
        """
        Synthesize all findings into a final response.
        
        Args:
            original_task: The original user request
            findings: All findings extracted during the session
            goals_completed: Sub-goals that were successfully completed
            goals_failed: Sub-goals that could not be completed
            
        Returns:
            SynthesizedResult with the final answer
        """
        logger.info(f"📊 [SYNTHESIZER] Synthesizing {len(findings)} findings for: {original_task[:50]}...")
        
        # Collect unique sources
        sources = list(set(f.source_url for f in findings))
        
        # Format findings by goal
        findings_by_goal = {}
        for f in findings:
            goal_id = f.goal_id
            if goal_id not in findings_by_goal:
                findings_by_goal[goal_id] = []
            findings_by_goal[goal_id].append(f)
        
        # Format completed goals
        goals_info = []
        for g in goals_completed:
            goal_findings = findings_by_goal.get(g.id, [])
            facts = [f"  • {f.fact} [{f.confidence:.0%}]" for f in goal_findings]
            goals_info.append(f"✓ {g.description}\n" + "\n".join(facts) if facts else f"✓ {g.description}")
        
        # Format failed goals if any
        failed_info = ""
        if goals_failed:
            failed_info = "\n\nGOALS NOT COMPLETED:\n" + "\n".join(f"✗ {g.description}: {g.result}" for g in goals_failed)
        
        system_prompt = """You are a research synthesis agent. Your job is to combine findings from web research into a clear, accurate, and well-structured answer.

GUIDELINES:
1. Answer the original question directly and completely
2. Use the findings as your primary source of information
3. If findings conflict, note the discrepancy and use the higher-confidence source
4. Cite sources naturally (e.g., "According to Rightmove...")
5. Be specific with numbers, dates, and facts
6. Note any limitations or caveats
7. If information was incomplete, acknowledge what couldn't be found

OUTPUT FORMAT (JSON):
{
  "answer": "Complete answer to the original question, using the findings. Several sentences to a paragraph.",
  "summary": "One-line summary of the key finding",
  "confidence": 0.8,
  "caveats": ["List of limitations or uncertainties"],
  "data_points": {
    "key_metric_name": "value",
    "another_metric": "value"
  }
}

The data_points field should extract any key numerical or factual data that can be displayed in a structured way."""

        human_prompt = f"""Synthesize a response to this research task:

ORIGINAL TASK: {original_task}

GOALS COMPLETED:
{chr(10).join(goals_info) if goals_info else "No goals completed"}
{failed_info}

ALL FINDINGS:
{self._format_findings(findings)}

SOURCES USED:
{chr(10).join(f"• {s}" for s in sources)}

Create a comprehensive answer based on these findings. Return JSON."""

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
            
            result = SynthesizedResult(
                answer=data.get("answer", "Unable to generate answer"),
                findings=findings,
                sources=sources,
                confidence=data.get("confidence", 0.5),
                caveats=data.get("caveats", []),
                summary=data.get("summary", ""),
                data_points=data.get("data_points", {})
            )
            
            logger.info(f"📊 [SYNTHESIZER] Generated answer with {result.confidence:.0%} confidence")
            
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"📊 [SYNTHESIZER] JSON parse error: {e}")
            # Return a basic synthesis
            return self._fallback_synthesis(original_task, findings, sources)
        except Exception as e:
            logger.error(f"📊 [SYNTHESIZER] Synthesis error: {e}")
            return self._fallback_synthesis(original_task, findings, sources)
    
    def _format_findings(self, findings: List[Finding]) -> str:
        """Format findings for the LLM prompt"""
        if not findings:
            return "No findings extracted"
        
        lines = []
        for f in findings:
            conf_str = f"[{f.confidence:.0%}]"
            source_domain = self._extract_domain(f.source_url)
            lines.append(f"• {f.fact} {conf_str} (from {source_domain})")
        
        return "\n".join(lines)
    
    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL for cleaner display"""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            return parsed.netloc or url[:50]
        except:
            return url[:50]
    
    def _fallback_synthesis(
        self,
        task: str,
        findings: List[Finding],
        sources: List[str]
    ) -> SynthesizedResult:
        """Generate a basic synthesis when LLM fails"""
        if not findings:
            return SynthesizedResult(
                answer=f"Unable to find information for: {task}",
                findings=[],
                sources=sources,
                confidence=0.0,
                caveats=["No relevant information was found"]
            )
        
        # Create simple concatenation of findings
        facts = [f.fact for f in findings]
        answer = "Based on the research:\n\n" + "\n".join(f"• {fact}" for fact in facts)
        
        return SynthesizedResult(
            answer=answer,
            findings=findings,
            sources=sources,
            confidence=sum(f.confidence for f in findings) / len(findings),
            caveats=["This is a basic synthesis without LLM processing"]
        )
    
    async def generate_partial_summary(
        self,
        original_task: str,
        findings: List[Finding],
        completed_goals: int,
        total_goals: int
    ) -> str:
        """
        Generate a partial summary during the session.
        
        Useful for showing progress to the user.
        
        Args:
            original_task: Original task
            findings: Findings so far
            completed_goals: Number of goals completed
            total_goals: Total goals
            
        Returns:
            Brief progress summary string
        """
        if not findings:
            return f"Working on task... ({completed_goals}/{total_goals} goals complete)"
        
        # Quick summary without full LLM call
        facts_preview = [f.fact[:50] for f in findings[:3]]
        facts_str = ", ".join(facts_preview)
        if len(findings) > 3:
            facts_str += f"... and {len(findings) - 3} more"
        
        return f"Progress: {completed_goals}/{total_goals} goals. Found: {facts_str}"
    
    async def compare_findings(
        self,
        finding_groups: Dict[str, List[Finding]],
        comparison_criteria: str
    ) -> Dict[str, Any]:
        """
        Compare findings across different groups.
        
        Useful for comparison tasks like "compare X vs Y".
        
        Args:
            finding_groups: Dict of group_name -> findings
            comparison_criteria: What to compare on
            
        Returns:
            Comparison result with winner/summary
        """
        prompt = f"""Compare these findings groups based on: {comparison_criteria}

"""
        for group_name, group_findings in finding_groups.items():
            facts = [f.fact for f in group_findings]
            prompt += f"{group_name.upper()}:\n{chr(10).join(f'• {fact}' for fact in facts)}\n\n"
        
        prompt += """Return JSON:
{
  "comparison": "Detailed comparison explanation",
  "summary": {"group_name": "key_metric", ...},
  "winner": "group_name or null if no clear winner",
  "reasoning": "Why this group wins or why inconclusive"
}"""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            
            result_text = response.content.strip()
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
            
            return json.loads(result_text)
        except Exception as e:
            logger.error(f"📊 [SYNTHESIZER] Comparison error: {e}")
            return {
                "comparison": "Unable to compare",
                "summary": {},
                "winner": None,
                "reasoning": str(e)
            }
    
    def calculate_overall_confidence(self, findings: List[Finding]) -> float:
        """Calculate overall confidence based on findings"""
        if not findings:
            return 0.0
        
        # Weight by individual confidences
        total_confidence = sum(f.confidence for f in findings)
        avg_confidence = total_confidence / len(findings)
        
        # Boost if we have multiple corroborating sources
        unique_sources = len(set(f.source_url for f in findings))
        source_boost = min(unique_sources / 3, 1.0) * 0.1
        
        # Cap at 0.95
        return min(avg_confidence + source_boost, 0.95)


# Global singleton instance
result_synthesizer = ResultSynthesizer()
