"""
Document Classification Service using LlamaClassify
"""
import os
import asyncio
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

class DocumentClassificationService:
    """Service for classifying documents using LlamaCloud Classify"""
    
    def __init__(self):
        self.api_key = os.environ.get('LLAMA_CLOUD_API_KEY')
        if not self.api_key:
            raise ValueError("LLAMA_CLOUD_API_KEY environment variable is required")
        
        # Classification rules for document types
        self.classification_rules = {
            'valuation_report': {
                'description': 'Formal property valuation with assessed value, comparable properties, market analysis, and professional surveyor details',
                'keywords': [
                    'valuation report', 'surveyor', 'assessed value', 'market value', 
                    'comparable properties', 'professional valuation', 'surveyor report',
                    'valuation', 'property valuation', 'market analysis', 'valuation date',
                    'valuation methodology', 'valuation summary', 'property details',
                    'floor area', 'gross internal area', 'net internal area',
                    'accommodation', 'bedrooms', 'bathrooms', 'reception rooms',
                    'valuation certificate', 'valuation for', 'valuation of',
                    'property inspection', 'inspection report', 'survey report',
                    'valuation basis', 'valuation approach', 'valuation conclusion',
                    'market value assessment', 'property assessment', 'valuation opinion'
                ]
            },
            'market_appraisal': {
                'description': 'Market analysis document with property comparables, pricing trends, and market positioning',
                'keywords': ['market analysis', 'appraisal', 'comparable', 'market trends', 'pricing analysis', 'market appraisal', 'market research', 'property market', 'market conditions']
            },
            'other_documents': {
                'description': 'Any other property-related document including contracts, floor plans, inspection reports, emails, letters, offers, or photos',
                'keywords': ['floor plan', 'inspection', 'contract', 'email', 'photo', 'planning', 'permit', 'letter', 'offer', 'proposal', 'agreement', 'lease', 'tenancy', 'rental', 'sale agreement', 'correspondence', 'communication']
            }
        }
    
    async def classify_document(self, file_path: str, document_text: str) -> Dict[str, Any]:
        """
        Document classification using keyword analysis with filename priority
        
        Args:
            file_path: Path to the document file
            document_text: Extracted text from the document
            
        Returns:
            Dict containing classification type, confidence, and metadata
        """
        try:
            # First check filename for obvious document types
            filename = file_path.lower()
            
            # Check for specific document types in filename
            if any(keyword in filename for keyword in ['letter', 'offer', 'proposal', 'agreement', 'contract', 'lease', 'tenancy']):
                return {
                    'type': 'other_documents',
                    'confidence': 0.9,
                    'reasoning': f"Filename-based classification: {filename} contains document type keywords",
                    'method': 'filename_analysis'
                }
            
            # Use document_text for keyword analysis
            content = document_text.lower()
            
            # Count keyword matches for each category
            scores = {}
            for doc_type, config in self.classification_rules.items():
                score = 0
                matched_keywords = []
                for keyword in config['keywords']:
                    if keyword.lower() in content:
                        score += 1
                        matched_keywords.append(keyword)
                
                # Boost score for valuation reports with specific indicators
                if doc_type == 'valuation_report':
                    valuation_boosters = [
                        'floor area', 'gross internal area', 'net internal area',
                        'accommodation', 'bedrooms', 'bathrooms', 'reception rooms',
                        'property details', 'valuation methodology', 'valuation approach'
                    ]
                    for booster in valuation_boosters:
                        if booster in content:
                            score += 0.5
                            matched_keywords.append(f"{booster} (booster)")
                
                scores[doc_type] = {
                    'score': score,
                    'matched_keywords': matched_keywords
                }
        
            # Find best match
            best_type = max(scores.keys(), key=lambda x: scores[x]['score'])
            best_score = scores[best_type]['score']
            total_keywords = sum(scores[doc_type]['score'] for doc_type in scores.keys())
        
            if total_keywords == 0:
                confidence = 0.3  # Low confidence for no keywords found
                best_type = 'other_documents'
            else:
                # Calculate confidence based on score and keyword density
                confidence = min(0.95, (best_score / max(total_keywords, 1)) * 0.8 + (best_score / max(len(self.classification_rules[best_type]['keywords']), 1)) * 0.2)
                confidence = max(0.6, confidence)  # Ensure minimum confidence
        
            return {
                'type': best_type,
                'confidence': confidence,
                'reasoning': f"Keyword analysis: {best_type} scored {best_score} matches out of {total_keywords} total. Matched: {', '.join(scores[best_type]['matched_keywords'][:5])}",
                'scores': scores,
                'method': 'keyword_analysis'
            }
        
        except Exception as e:
            logger.error(f"Error in synchronous classification: {e}")
            return {
                'type': 'other_documents',
                'confidence': 0.3,
                'reasoning': f"Classification failed: {str(e)}",
                'method': 'error_fallback'
            }


    async def _classify_by_keywords(self, file_path: str) -> Dict[str, Any]:
        """
        Simple keyword-based classification as fallback
        """
        try:
            # Read file content for keyword analysis
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read().lower()
            
            # Count keyword matches for each category
            scores = {}
            for doc_type, config in self.classification_rules.items():
                score = 0
                for keyword in config['keywords']:
                    score += content.count(keyword.lower())
                scores[doc_type] = score
            
            # Find best match
            best_type = max(scores, key=scores.get)
            total_keywords = sum(scores.values())
            
            if total_keywords == 0:
                confidence = 0.3  # Low confidence for no keywords found
                best_type = 'other_documents'
            else:
                confidence = min(0.9, scores[best_type] / total_keywords + 0.3)
            
            return {
                'type': best_type,
                'confidence': confidence,
                'method': 'keyword_analysis',
                'scores': scores
            }
            
        except Exception as e:
            logger.error(f"Error in keyword classification: {e}")
            return {
                'type': 'other_documents',
                'confidence': 0.3,
                'method': 'error_fallback',
                'error': str(e)
            }
    
    def get_classification_rules(self) -> Dict[str, Any]:
        """Get the current classification rules"""
        return self.classification_rules
    
    def update_classification_rules(self, new_rules: Dict[str, Any]):
        """Update classification rules"""
        self.classification_rules = new_rules
        logger.info("Classification rules updated")

# Async wrapper for synchronous usage
def classify_document_sync(file_path: str, document_text: str) -> Dict[str, Any]:
    """Synchronous wrapper for document classification"""
    service = DocumentClassificationService()
    return asyncio.run(service.classify_document(file_path, document_text))
