"""
Universal Query-to-Section-Header Mapping System

Maps user queries to relevant section headers for all document types.
Works for valuation reports, EPCs, tenancy agreements, title deeds, surveys, etc.
"""
import re
import logging
from typing import List, Optional, Dict, Set

logger = logging.getLogger(__name__)

# Universal mapping: Query keyword → section header keywords
QUERY_TO_SECTION_MAPPINGS = {
    # Valuation-related
    "value": ["valuation", "market value", "price", "worth", "appraisal"],
    "valuation": ["valuation", "market value", "appraisal", "assessment"],
    "price": ["market value", "price", "valuation", "worth"],
    "worth": ["market value", "worth", "valuation", "price"],
    "appraisal": ["appraisal", "valuation", "market value", "assessment"],
    
    # Rent/Lease-related
    "rent": ["rent", "rental", "tenancy", "lease", "rental income"],
    "rental": ["rent", "rental", "tenancy", "lease"],
    "lease": ["lease", "tenancy", "rent", "rental"],
    "tenancy": ["tenancy", "lease", "rent", "rental"],
    
    # Energy/EPC-related
    "energy": ["energy performance", "current rating", "epc", "rating", "energy efficiency"],
    "rating": ["current rating", "energy rating", "epc rating", "rating"],
    "epc": ["energy performance", "epc", "current rating"],
    "efficiency": ["energy efficiency", "energy performance", "rating"],
    
    # Property details
    "bedroom": ["accommodation", "bedrooms", "rooms", "property details"],
    "bathroom": ["accommodation", "bathrooms", "rooms", "property details"],
    "bed": ["accommodation", "bedrooms", "rooms", "property details"],
    "bath": ["accommodation", "bathrooms", "rooms", "property details"],
    "address": ["property address", "location", "address", "property details"],
    "location": ["location", "address", "property address"],
    
    # Tenancy/Legal
    "deposit": ["deposit", "security deposit", "tenancy", "lease"],
    "term": ["term", "tenancy term", "lease term", "duration"],
    "tenant": ["tenant", "tenancy", "occupier"],
    "landlord": ["landlord", "lessor", "owner"],
    "obligations": ["obligations", "responsibilities", "duties"],
    
    # Title/Legal
    "title": ["title number", "proprietorship", "title"],
    "proprietor": ["proprietorship", "title", "owner"],
    "charges": ["charges", "mortgages", "restrictions"],
    "mortgage": ["mortgages", "charges", "restrictions"],
    "restrictions": ["restrictions", "charges", "covenants"],
    
    # Survey/Condition
    "condition": ["condition", "defects", "survey", "inspection"],
    "defects": ["defects", "condition", "recommendations"],
    "survey": ["survey", "inspection", "condition"],
    "inspection": ["inspection", "survey", "condition"],
    "recommendations": ["recommendations", "defects", "condition"],
    
    # Market analysis
    "comparable": ["comparable properties", "comparables", "market analysis"],
    "market": ["market analysis", "market value", "market conditions"],
    "comparables": ["comparable properties", "comparables", "market analysis"],
    
    # General document sections
    "summary": ["summary", "overview", "conclusion"],
    "details": ["property details", "details", "description"],
    "description": ["description", "property details", "details"],
}


def get_relevant_section_headers(query: str, document_type: Optional[str] = None) -> List[str]:
    """
    Identify relevant section headers for a query based on query keywords and document type.
    
    Args:
        query: User's search query
        document_type: Optional document classification type (e.g., "valuation_report", "epc_certificate")
        
    Returns:
        List of section header keywords to search for (normalized, lowercase)
    """
    if not query or not query.strip():
        return []
    
    query_lower = query.lower()
    words = query_lower.split()
    
    # Extract relevant keywords from query
    relevant_keywords = set()
    
    # Strategy 1: Direct keyword matching
    for word in words:
        # Remove punctuation
        word_clean = re.sub(r'[^\w\s]', '', word)
        if word_clean in QUERY_TO_SECTION_MAPPINGS:
            relevant_keywords.update(QUERY_TO_SECTION_MAPPINGS[word_clean])
    
    # Strategy 2: Phrase matching (multi-word queries)
    for phrase_key, section_headers in QUERY_TO_SECTION_MAPPINGS.items():
        if phrase_key in query_lower:
            relevant_keywords.update(section_headers)
    
    # Strategy 3: Document-type-aware matching
    if document_type:
        document_type_lower = document_type.lower()
        
        # EPC-specific: "energy" or "rating" queries on EPC documents
        if 'epc' in document_type_lower or 'energy' in document_type_lower:
            if any(term in query_lower for term in ['energy', 'rating', 'epc', 'efficiency']):
                relevant_keywords.update(["current rating", "energy performance", "epc", "rating"])
        
        # Valuation-specific: "value" queries on valuation documents
        if 'valuation' in document_type_lower:
            if any(term in query_lower for term in ['value', 'price', 'worth', 'valuation']):
                relevant_keywords.update(["valuation", "market value", "price"])
        
        # Tenancy-specific: "rent" queries on tenancy documents
        if 'tenancy' in document_type_lower or 'lease' in document_type_lower:
            if any(term in query_lower for term in ['rent', 'rental', 'lease', 'tenancy']):
                relevant_keywords.update(["rent", "rental", "tenancy", "lease"])
    
    # Strategy 4: Semantic matching (common synonyms)
    # "how much" → value/price queries
    if 'how much' in query_lower or 'cost' in query_lower:
        relevant_keywords.update(["market value", "price", "valuation", "worth"])
    
    # "what is" + property term → property details
    if 'what is' in query_lower:
        if any(term in query_lower for term in ['bedroom', 'bathroom', 'address', 'size']):
            relevant_keywords.update(["property details", "accommodation", "bedrooms", "bathrooms"])
    
    # Remove duplicates and return as sorted list
    result = sorted(list(relevant_keywords))
    
    if result:
        logger.debug(f"Query '{query}' → section headers: {result}")
    else:
        logger.debug(f"No section header matches found for query: '{query}'")
    
    return result


def should_use_header_retrieval(query: str, document_type: Optional[str] = None) -> bool:
    """
    Determine if header-priority retrieval should be used for this query.
    
    Args:
        query: User's search query
        document_type: Optional document classification type
        
    Returns:
        True if header retrieval should be used, False otherwise
    """
    relevant_headers = get_relevant_section_headers(query, document_type)
    return len(relevant_headers) > 0

