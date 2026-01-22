"""
Query characteristics detection utility.

Provides simple query analysis for adaptive content handling.
"""

import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


def detect_query_characteristics(query: str) -> Dict[str, Any]:
    """
    Analyze query to determine its characteristics for adaptive retrieval.
    
    Returns:
        Dictionary with:
        - complexity_score: 0.0-1.0 (higher = more complex)
        - needs_comprehensive: bool (True if query needs all information)
        - query_type: str (assessment, activity, attribute, relationship, general)
        - expects_later_pages: bool (True if info likely on later pages)
    """
    query_lower = query.lower()
    
    # Detect query type
    assessment_terms = ['valuation', 'market value', 'property value', 'assess', 'opinion', 'appraisal', 'evaluate', 'determine']
    activity_terms = ['sold', 'offer', 'listed', 'marketing', 'transaction', 'history']
    attribute_terms = ['bedroom', 'bathroom', 'size', 'area', 'floor', 'feature', 'amenity', 'condition']
    relationship_terms = ['who', 'valued', 'inspected', 'prepared', 'author', 'company']
    
    query_type = 'general'
    
    # Check precise terms first
    if any(term in query_lower for term in assessment_terms):
        query_type = 'assessment'
    elif any(term in query_lower for term in activity_terms):
        query_type = 'activity'
    elif any(term in query_lower for term in attribute_terms):
        query_type = 'attribute'
    elif any(term in query_lower for term in relationship_terms):
        query_type = 'relationship'
    
    # Check broad "value" term only if it appears with property/valuation context
    elif 'value' in query_lower:
        value_context_patterns = [
            'property value', 'market value', 'value of', 'value for', 
            'value is', 'value was', 'value at', 'value:', 'value =',
            'the value', 'its value', 'property\'s value', 'property value'
        ]
        has_value_context = any(pattern in query_lower for pattern in value_context_patterns)
        if has_value_context:
            query_type = 'assessment'
    
    # Complexity score (simple heuristic)
    complexity_indicators = [
        'compare', 'difference', 'relationship', 'why', 'how', 'analyze',
        'comprehensive', 'all', 'everything', 'summary', 'summarize'
    ]
    complexity_score = 0.3  # Base complexity
    if any(indicator in query_lower for indicator in complexity_indicators):
        complexity_score = 0.7
    if len(query.split()) > 10:
        complexity_score = min(1.0, complexity_score + 0.2)
    
    # Needs comprehensive (all information)
    comprehensive_indicators = [
        'all', 'everything', 'comprehensive', 'full', 'complete', 'entire',
        'summarize', 'summary', 'overview', 'list all'
    ]
    needs_comprehensive = any(indicator in query_lower for indicator in comprehensive_indicators)
    
    # Expects later pages (info likely on later pages)
    later_page_indicators = [
        'conclusion', 'summary', 'recommendation', 'final', 'overall',
        'assessment', 'valuation', 'opinion'
    ]
    expects_later_pages = any(indicator in query_lower for indicator in later_page_indicators)
    
    return {
        'complexity_score': complexity_score,
        'needs_comprehensive': needs_comprehensive,
        'query_type': query_type,
        'expects_later_pages': expects_later_pages
    }

