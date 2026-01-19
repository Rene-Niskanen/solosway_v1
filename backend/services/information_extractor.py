"""
Information Extractor Service - Extract structured data from ARIA snapshots.

This service uses an LLM to intelligently extract relevant information
from page content (ARIA snapshots) based on the current goal.

Enables the agent to accumulate findings across multiple pages.
"""

import logging
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.services.working_memory_service import Finding, ExtractionMethod
from backend.services.task_planner_service import SubGoal

logger = logging.getLogger(__name__)


@dataclass
class ExtractionResult:
    """Result of an extraction attempt"""
    findings: List[Dict[str, Any]]
    goal_achievable: bool
    should_continue: bool
    reasoning: str
    suggested_next_action: Optional[str] = None


class InformationExtractor:
    """
    Service for extracting structured information from page content.
    
    Uses LLM to identify and extract relevant data based on the
    current sub-goal, returning structured findings with confidence scores.
    """
    
    def __init__(self):
        self.llm = None
        self._quick_check_llm = None
    
    def _get_llm(self) -> ChatOpenAI:
        """Lazy-load main extraction LLM"""
        if self.llm is None:
            self.llm = ChatOpenAI(
                api_key=config.openai_api_key,
                model="gpt-4o-mini",
                temperature=0,
                timeout=30
            )
        return self.llm
    
    def _get_quick_check_llm(self) -> ChatOpenAI:
        """Lazy-load fast LLM for quick relevance checks"""
        if self._quick_check_llm is None:
            self._quick_check_llm = ChatOpenAI(
                api_key=config.openai_api_key,
                model="gpt-4o-mini",
                temperature=0,
                timeout=10,
                max_tokens=100
            )
        return self._quick_check_llm
    
    async def should_extract(
        self, 
        aria_snapshot: str, 
        goal: SubGoal,
        current_url: str
    ) -> bool:
        """
        Quick check if the current page likely has relevant information.
        
        This is a fast pre-check to avoid expensive extraction on irrelevant pages.
        
        Args:
            aria_snapshot: ARIA snapshot of current page
            goal: Current sub-goal we're working on
            current_url: Current page URL
            
        Returns:
            True if extraction should be attempted
        """
        # Quick heuristics first
        goal_lower = goal.description.lower()
        url_lower = current_url.lower()
        
        # If goal mentions specific sites and we're on them, likely relevant
        site_keywords = ["google", "amazon", "rightmove", "zoopla", "wikipedia"]
        for site in site_keywords:
            if site in goal_lower and site in url_lower:
                return True
        
        # If this is an extract/find goal, always try
        extract_keywords = ["extract", "find", "get", "collect", "gather", "note", "record"]
        if any(kw in goal_lower for kw in extract_keywords):
            return True
        
        # For search results pages, usually worth extracting
        if "search" in url_lower or "q=" in current_url:
            return True
        
        # If snapshot is very short, probably not much to extract
        if len(aria_snapshot) < 500:
            return False
        
        # Use LLM for borderline cases
        try:
            llm = self._get_quick_check_llm()
            
            # Truncate snapshot for quick check
            snapshot_preview = aria_snapshot[:2000] if len(aria_snapshot) > 2000 else aria_snapshot
            
            prompt = f"""Quick check: Does this page likely contain information for this goal?

GOAL: {goal.description}
URL: {current_url}

PAGE PREVIEW:
{snapshot_preview}

Answer only YES or NO."""

            response = await llm.ainvoke([HumanMessage(content=prompt)])
            answer = response.content.strip().upper()
            
            return answer.startswith("YES")
            
        except Exception as e:
            logger.warning(f"🔍 [EXTRACTOR] Quick check failed: {e}, defaulting to True")
            return True  # When in doubt, try extraction
    
    async def extract_from_snapshot(
        self,
        aria_snapshot: str,
        current_url: str,
        goal: SubGoal,
        existing_findings: Optional[List[Finding]] = None
    ) -> ExtractionResult:
        """
        Extract structured information from page content.
        
        Uses LLM to identify and extract facts relevant to the current goal.
        
        Args:
            aria_snapshot: ARIA snapshot of the page
            current_url: Current page URL
            goal: The sub-goal we're trying to achieve
            existing_findings: Findings we already have (to avoid duplicates)
            
        Returns:
            ExtractionResult with findings and status
        """
        logger.info(f"🔍 [EXTRACTOR] Extracting for goal: {goal.description[:50]}...")
        
        # Check if this is an image-related goal
        goal_lower = goal.description.lower()
        is_image_goal = any(kw in goal_lower for kw in ["image", "photo", "picture", "show me"])
        is_google_images = "udm=2" in current_url or "/images" in current_url
        
        # If image goal and on image search page, extract images first
        image_findings = []
        if is_image_goal and is_google_images:
            try:
                images = await self.extract_images_from_snapshot(aria_snapshot, current_url, goal)
                # Convert images to findings format
                for img in images:
                    image_findings.append({
                        "fact": f"Image: {img.get('alt_text', 'No description')}",
                        "confidence": img.get("confidence", 0.8),
                        "element_ref": None,
                        "raw_text": f"Image URL: {img.get('url', '')}, Source: {img.get('source_url', 'N/A')}",
                        "image_data": img  # Include full image data
                    })
                if image_findings:
                    logger.info(f"🖼️ [EXTRACTOR] Extracted {len(image_findings)} images as findings")
            except Exception as e:
                logger.warning(f"🖼️ [EXTRACTOR] Image extraction failed: {e}, continuing with text extraction")
        
        # Format existing findings for context
        existing_facts = ""
        if existing_findings:
            facts_list = [f"• {f.fact}" for f in existing_findings]
            existing_facts = f"""

ALREADY FOUND (don't repeat these):
{chr(10).join(facts_list)}"""
        
        system_prompt = """You are an information extraction agent. Your job is to extract specific, factual information from web page content (ARIA snapshots) based on a given goal.

RULES:
1. Extract SPECIFIC facts, not vague summaries
2. Include numbers, prices, dates, names when present
3. Assign confidence scores based on how clear/authoritative the source is
4. Don't repeat information we already have
5. Note the element ref [ref=eN] if the fact comes from a specific element
6. If the page doesn't have the information, say so clearly

CONFIDENCE GUIDELINES:
- 1.0: Official source, exact figure clearly stated
- 0.8: Reliable source, specific information
- 0.6: General source, approximate information  
- 0.4: Indirect or inferred information
- 0.2: Speculation or very uncertain

Output valid JSON only, no markdown:
{
  "findings": [
    {
      "fact": "Specific factual statement extracted from the page",
      "confidence": 0.8,
      "element_ref": "e5",
      "raw_text": "Original text from the page"
    }
  ],
  "goal_achievable": true,
  "should_continue": true,
  "reasoning": "Brief explanation of what was found and what's missing",
  "suggested_next_action": "Click on X for more details" or null
}

If nothing relevant found:
{
  "findings": [],
  "goal_achievable": false,
  "should_continue": true,
  "reasoning": "This page doesn't contain relevant information because...",
  "suggested_next_action": "Navigate back and try a different search"
}"""

        # Truncate snapshot if too long
        max_snapshot_len = 12000
        if len(aria_snapshot) > max_snapshot_len:
            aria_snapshot = aria_snapshot[:max_snapshot_len] + "\n... (truncated)"
        
        human_prompt = f"""Extract information for this goal:

GOAL: {goal.description}
EXPECTED RESULT: {goal.expected_result}
CURRENT URL: {current_url}
{existing_facts}

PAGE CONTENT (ARIA Snapshot):
{aria_snapshot}

Extract any facts relevant to the goal. Return JSON."""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt)
            ])
            
            result_text = response.content.strip()
            
            # Handle markdown code blocks
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
                if result_text.startswith('json'):
                    result_text = result_text[4:].strip()
            
            # Parse JSON
            data = json.loads(result_text)
            
            findings = data.get("findings", [])
            
            # Merge image findings with text findings (images first if available)
            if image_findings:
                findings = image_findings + findings
                # If we extracted images, goal is more likely achievable
                if is_image_goal:
                    goal_achievable = True
                else:
                    goal_achievable = data.get("goal_achievable", True)
            else:
                goal_achievable = data.get("goal_achievable", True)
            
            should_continue = data.get("should_continue", True)
            reasoning = data.get("reasoning", "")
            suggested_next = data.get("suggested_next_action")
            
            # Update reasoning if images were extracted
            if image_findings:
                reasoning = f"Extracted {len(image_findings)} images. " + reasoning
            
            logger.info(f"🔍 [EXTRACTOR] Extracted {len(findings)} findings ({len(image_findings)} images), goal_achievable={goal_achievable}")
            for f in findings[:5]:  # Log first 5
                logger.info(f"  • {f.get('fact', '')[:60]}... (conf: {f.get('confidence', 0.5)})")
            
            return ExtractionResult(
                findings=findings,
                goal_achievable=goal_achievable,
                should_continue=should_continue,
                reasoning=reasoning,
                suggested_next_action=suggested_next
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"🔍 [EXTRACTOR] JSON parse error: {e}")
            return ExtractionResult(
                findings=[],
                goal_achievable=True,
                should_continue=True,
                reasoning=f"Extraction failed: {e}"
            )
        except Exception as e:
            logger.error(f"🔍 [EXTRACTOR] Extraction error: {e}")
            return ExtractionResult(
                findings=[],
                goal_achievable=True,
                should_continue=True,
                reasoning=f"Extraction error: {e}"
            )
    
    async def extract_specific_data(
        self,
        aria_snapshot: str,
        current_url: str,
        data_type: str,
        context: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Extract a specific type of data from a page.
        
        Useful for targeted extraction like "prices", "dates", "names", etc.
        
        Args:
            aria_snapshot: ARIA snapshot of the page
            current_url: Current URL
            data_type: Type of data to extract (price, date, name, etc.)
            context: Additional context about what to look for
            
        Returns:
            List of extracted data items
        """
        logger.info(f"🔍 [EXTRACTOR] Targeted extraction for: {data_type}")
        
        prompt = f"""Extract all {data_type} from this page.

URL: {current_url}
{f"Context: {context}" if context else ""}

PAGE CONTENT:
{aria_snapshot[:8000]}

Return JSON array of extracted items:
[
  {{"value": "the extracted {data_type}", "element_ref": "eN", "confidence": 0.8}},
  ...
]

If no {data_type} found, return empty array: []"""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            
            result_text = response.content.strip()
            
            # Handle markdown
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
                if result_text.startswith('json'):
                    result_text = result_text[4:].strip()
            
            data = json.loads(result_text)
            return data if isinstance(data, list) else []
            
        except Exception as e:
            logger.error(f"🔍 [EXTRACTOR] Targeted extraction error: {e}")
            return []
    
    async def validate_finding(
        self,
        finding: Dict[str, Any],
        aria_snapshot: str
    ) -> bool:
        """
        Validate that a finding is still present/accurate on the page.
        
        Useful for re-checking extracted data.
        
        Args:
            finding: The finding to validate
            aria_snapshot: Current ARIA snapshot
            
        Returns:
            True if finding appears valid
        """
        fact = finding.get("fact", "")
        element_ref = finding.get("element_ref")
        
        # Quick check: if the fact text appears in snapshot, likely valid
        if fact.lower() in aria_snapshot.lower():
            return True
        
        # Check if element ref still exists
        if element_ref and f"[ref={element_ref}]" in aria_snapshot:
            return True
        
        return False
    
    async def extract_images_from_snapshot(
        self,
        aria_snapshot: str,
        current_url: str,
        goal: SubGoal,
        max_images: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Extract image URLs and metadata from Google Images or image search results.
        
        Args:
            aria_snapshot: ARIA snapshot of the page
            current_url: Current page URL
            goal: The sub-goal we're trying to achieve
            max_images: Maximum number of images to extract
            
        Returns:
            List of image data dictionaries with url, thumbnail_url, alt_text, source_url, confidence
        """
        logger.info(f"🖼️ [EXTRACTOR] Extracting images for goal: {goal.description[:50]}...")
        
        # Check if this is an image search page
        is_google_images = "udm=2" in current_url or "/images" in current_url or "google.com/search" in current_url
        goal_lower = goal.description.lower()
        is_image_goal = any(kw in goal_lower for kw in ["image", "photo", "picture", "show me"])
        
        if not (is_google_images or is_image_goal):
            logger.info("🖼️ [EXTRACTOR] Not an image search page, skipping image extraction")
            return []
        
        # Truncate snapshot if too long, but try to keep image-related content
        max_snapshot_len = 15000
        if len(aria_snapshot) > max_snapshot_len:
            # Try to keep image-related content
            aria_snapshot = aria_snapshot[:max_snapshot_len] + "\n... (truncated)"
        
        system_prompt = """You are an image extraction agent. Your job is to extract image URLs and metadata from Google Images search results or image-rich pages.

RULES:
1. Look for image elements in the ARIA snapshot (img tags, image links, etc.)
2. Extract the actual image URL (not just thumbnails when possible)
3. Extract alt text or description for each image
4. Extract source URL if available (where the image links to)
5. Only extract images that are relevant to the goal
6. Prioritize images that match the search query/goal description
7. Limit to the most relevant images (don't extract everything)

OUTPUT FORMAT (JSON):
{
  "images": [
    {
      "url": "Direct image URL (full size if available)",
      "thumbnail_url": "Thumbnail URL if different from main URL",
      "alt_text": "Alt text or description of the image",
      "source_url": "URL where this image is from (if available)",
      "confidence": 0.8
    }
  ]
}

CONFIDENCE GUIDELINES:
- 1.0: Image clearly matches the goal, high quality source
- 0.8: Image matches goal, good quality
- 0.6: Image somewhat relevant
- 0.4: Image may be relevant but unclear
- 0.2: Image unlikely to be relevant

If no images found or page is not an image search page:
{
  "images": []
}"""

        human_prompt = f"""Extract images for this goal:

GOAL: {goal.description}
EXPECTED RESULT: {goal.expected_result}
CURRENT URL: {current_url}
MAX IMAGES: {max_images}

PAGE CONTENT (ARIA Snapshot):
{aria_snapshot}

Extract relevant images. Return JSON with images array."""

        try:
            llm = self._get_llm()
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt)
            ])
            
            result_text = response.content.strip()
            
            # Handle markdown code blocks
            if result_text.startswith('```'):
                lines = result_text.split('\n')
                result_text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])
                if result_text.startswith('json'):
                    result_text = result_text[4:].strip()
            
            # Parse JSON
            data = json.loads(result_text)
            images = data.get("images", [])
            
            # Limit to max_images, sorted by confidence
            images = sorted(images, key=lambda x: x.get("confidence", 0.5), reverse=True)[:max_images]
            
            logger.info(f"🖼️ [EXTRACTOR] Extracted {len(images)} images")
            for img in images[:3]:  # Log first 3
                logger.info(f"  • {img.get('alt_text', 'No alt text')[:50]}... (conf: {img.get('confidence', 0.5)})")
            
            return images
            
        except json.JSONDecodeError as e:
            logger.error(f"🖼️ [EXTRACTOR] JSON parse error: {e}")
            return []
        except Exception as e:
            logger.error(f"🖼️ [EXTRACTOR] Image extraction error: {e}")
            return []


# Global singleton instance
information_extractor = InformationExtractor()
