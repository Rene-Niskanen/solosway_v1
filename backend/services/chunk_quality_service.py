"""
Chunk Quality Scoring Service

Scores chunk quality (0.0-1.0) based on:
- Length sanity (not too short/long)
- Sentence completeness
- Boilerplate ratio
- Symbol density (HTML, markdown artifacts)
- Table density
"""

import re
from typing import Dict, Any, Optional, List
import logging

logger = logging.getLogger(__name__)

class ChunkQualityService:
    """Service for computing chunk quality scores."""
    
    def __init__(self):
        """Initialize quality scoring service."""
        pass
    
    def compute_quality_score(
        self, 
        chunk_text: str, 
        metadata: Optional[Dict[str, Any]] = None
    ) -> float:
        """
        Compute quality score for a chunk (0.0-1.0).
        
        Scoring factors:
        - Length: Optimal 200-2000 chars (penalty if <100 or >5000)
        - HTML artifacts: Heavy penalty if HTML tags present
        - Markdown artifacts: Penalty if >10% markdown symbols
        - Boilerplate: Penalty if >30% boilerplate content
        - Sentence completeness: Minor penalty if doesn't end with punctuation
        
        Args:
            chunk_text: Clean chunk text (should already be cleaned)
            metadata: Optional chunk metadata (may contain boilerplate_ratio)
            
        Returns:
            Quality score between 0.0 and 1.0
        """
        if not chunk_text or not chunk_text.strip():
            return 0.0  # Empty chunk
        
        text_length = len(chunk_text.strip())
        
        # Base score starts at 1.0, then gets penalized
        score = 1.0
        
        # Factor 1: Length sanity
        if text_length < 50:
            return 0.0  # Too short, reject
        elif text_length < 100:
            score *= 0.6  # Very short, heavy penalty
        elif text_length < 200:
            score *= 0.8  # Short, moderate penalty
        elif text_length > 5000:
            score *= 0.7  # Very long, penalty
        elif text_length > 3000:
            score *= 0.9  # Long, minor penalty
        # Optimal: 200-2000 chars (no penalty)
        
        # Factor 2: HTML artifacts (should be removed by cleaning, but check anyway)
        html_tags = len(re.findall(r'<[^>]+>', chunk_text))
        if html_tags > 0:
            score *= 0.3  # Heavy penalty - HTML should not be present
            logger.warning(f"⚠️ Quality: Chunk contains {html_tags} HTML tags (should be cleaned)")
        
        # Factor 3: Markdown artifacts (excessive markdown indicates incomplete cleaning)
        markdown_symbols = len(re.findall(r'[#*_`\[\]]', chunk_text))
        markdown_ratio = markdown_symbols / text_length if text_length > 0 else 0
        if markdown_ratio > 0.1:  # >10% markdown symbols
            score *= 0.5  # Heavy penalty
        elif markdown_ratio > 0.05:  # >5% markdown symbols
            score *= 0.8  # Moderate penalty
        
        # Factor 4: Boilerplate ratio (if available in metadata)
        if metadata:
            boilerplate_ratio = metadata.get('boilerplate_ratio', 0)
            if boilerplate_ratio > 0.5:  # >50% boilerplate
                score *= 0.4  # Heavy penalty
            elif boilerplate_ratio > 0.3:  # >30% boilerplate
                score *= 0.7  # Moderate penalty
        
        # Factor 5: Sentence completeness
        # Check if chunk ends with proper punctuation (indicates complete thought)
        if chunk_text.strip() and chunk_text.strip()[-1] not in '.!?':
            # Minor penalty - not a complete sentence
            score *= 0.95  # Very minor penalty
        
        # Factor 6: Whitespace issues (excessive whitespace indicates formatting problems)
        whitespace_ratio = len(re.findall(r'\s+', chunk_text)) / text_length if text_length > 0 else 0
        if whitespace_ratio > 0.3:  # >30% whitespace
            score *= 0.9  # Minor penalty
        
        # Clamp to 0.0-1.0 range
        return max(0.0, min(1.0, score))
    
    def compute_quality_scores_batch(
        self,
        chunks: List[str],
        metadata_list: Optional[List[Dict[str, Any]]] = None
    ) -> List[float]:
        """
        Compute quality scores for multiple chunks in batch.
        
        Args:
            chunks: List of clean chunk texts
            metadata_list: Optional list of metadata dicts (one per chunk)
            
        Returns:
            List of quality scores (one per chunk)
        """
        if metadata_list is None:
            metadata_list = [None] * len(chunks)
        
        scores = []
        for i, chunk in enumerate(chunks):
            metadata = metadata_list[i] if i < len(metadata_list) else None
            score = self.compute_quality_score(chunk, metadata)
            scores.append(score)
        
        return scores

