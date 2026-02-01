"""
Chunk Validation Service

Validates chunks before embedding to prevent bad data.
"""

import re
from typing import Tuple, List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ChunkValidationService:
    """Service for validating chunks before embedding."""
    
    def __init__(self, strict_mode: bool = False):
        """
        Initialize validation service.
        
        Args:
            strict_mode: If True, reject chunks with any validation errors.
                        If False, log warnings but allow chunks through.
        """
        self.strict_mode = strict_mode
    
    def validate_chunk_clean(
        self, 
        chunk_text_clean: str,
        chunk_index: int = None
    ) -> Tuple[bool, List[str]]:
        """
        Validate cleaned chunk text.
        
        Checks:
        - HTML tags present (should be removed)
        - Excessive markdown symbols
        - Length constraints (too short/long)
        - Empty or whitespace-only
        
        Args:
            chunk_text_clean: Cleaned chunk text to validate
            chunk_index: Optional chunk index for logging
            
        Returns:
            (is_valid, list_of_errors)
        """
        errors = []
        
        if not chunk_text_clean:
            errors.append("Empty chunk text")
            return (False, errors)
        
        text_length = len(chunk_text_clean.strip())
        
        # Check 1: Length constraints
        if text_length < 50:
            errors.append(f"Too short ({text_length} chars, minimum 50)")
        elif text_length > 10000:
            errors.append(f"Too long ({text_length} chars, maximum 10000)")
        
        # Check 2: HTML tags (should be removed by cleaning)
        html_tags = re.findall(r'<[^>]+>', chunk_text_clean)
        if html_tags:
            errors.append(f"Contains {len(html_tags)} HTML tag(s): {html_tags[:3]}")
        
        # Check 3: Excessive markdown symbols
        markdown_count = len(re.findall(r'[#*_`\[\]]', chunk_text_clean))
        markdown_ratio = markdown_count / text_length if text_length > 0 else 0
        if markdown_ratio > 0.15:  # >15% markdown symbols
            errors.append(f"Excessive markdown symbols ({markdown_ratio:.1%})")
        
        # Check 4: Whitespace-only
        if not chunk_text_clean.strip():
            errors.append("Whitespace-only chunk")
        
        # Check 5: Excessive whitespace (indicates formatting issues)
        whitespace_ratio = len(re.findall(r'\s+', chunk_text_clean)) / text_length if text_length > 0 else 0
        if whitespace_ratio > 0.4:  # >40% whitespace
            errors.append(f"Excessive whitespace ({whitespace_ratio:.1%})")
        
        is_valid = len(errors) == 0
        
        if not is_valid and chunk_index is not None:
            logger.warning(f"⚠️ [VALIDATION] Chunk {chunk_index} validation failed: {', '.join(errors)}")
        elif not is_valid:
            logger.warning(f"⚠️ [VALIDATION] Chunk validation failed: {', '.join(errors)}")
        
        return (is_valid, errors)
    
    def validate_embedding_source(
        self,
        chunk_text_clean: str,
        embedding_source: str
    ) -> Tuple[bool, str]:
        """
        Validate that embedding was created from clean text.
        
        This is a sanity check to ensure we're not accidentally
        embedding non-cleaned text.
        
        Args:
            chunk_text_clean: The clean text that should have been embedded
            embedding_source: The text that was actually embedded (for comparison)
            
        Returns:
            (is_valid, error_message)
        """
        # Check if embedding_source contains HTML (should not)
        if re.search(r'<[^>]+>', embedding_source):
            return (False, "Embedding source contains HTML tags (should be clean)")
        
        # Check if embedding_source is significantly different from clean text
        # (allowing for minor differences due to enrichment)
        clean_length = len(chunk_text_clean.strip())
        source_length = len(embedding_source.strip())
        
        # If source is much longer, it might contain metadata prepending
        if source_length > clean_length * 1.5:
            return (False, f"Embedding source is {source_length/clean_length:.1f}x longer than clean text (may contain metadata)")
        
        return (True, "")
    
    def validate_batch(
        self,
        chunks: List[str],
        chunk_indices: List[int] = None
    ) -> Dict[int, Tuple[bool, List[str]]]:
        """
        Validate multiple chunks in batch.
        
        Args:
            chunks: List of cleaned chunk texts
            chunk_indices: Optional list of chunk indices for logging
            
        Returns:
            Dict mapping chunk index to (is_valid, errors)
        """
        if chunk_indices is None:
            chunk_indices = list(range(len(chunks)))
        
        results = {}
        for i, chunk in enumerate(chunks):
            chunk_idx = chunk_indices[i] if i < len(chunk_indices) else i
            is_valid, errors = self.validate_chunk_clean(chunk, chunk_idx)
            results[chunk_idx] = (is_valid, errors)
        
        return results

