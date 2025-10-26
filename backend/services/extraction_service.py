"""
Document Extraction Service using LlamaExtract with conditional schemas
"""
import os
import json
import logging
from typing import Dict, Any, List
from llama_parse import LlamaParse
from llama_cloud_services import LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ExtractTarget
from llama_index.core import SimpleDirectoryReader
from .extraction_schemas import get_extraction_schema

logger = logging.getLogger(__name__)

class ExtractionService:
    """Service for extracting structured data from documents using LlamaExtract"""
    
    def __init__(self):
        self.llama_cloud_api_key = os.environ.get('LLAMA_CLOUD_API_KEY')
        if not self.llama_cloud_api_key:
            raise ValueError("LLAMA_CLOUD_API_KEY environment variable is required")
        
        # Initialize LlamaExtract
        self.extractor = LlamaExtract(api_key=self.llama_cloud_api_key)
        
        # Configuration for extraction
        self.extraction_config = ExtractConfig(
            extraction_mode=ExtractMode.MULTIMODAL,
            extraction_target=ExtractTarget.PER_DOC,
            high_resolution_mode=True,
            cite_sources=True,
            use_reasoning=False,
            confidence_scores=False,
            system_prompt="""Extract COMPARABLE PROPERTIES and SUBJECT PROPERTIES from this appraisal document with maximum precision. 

CRITICAL PROPERTY FILTERING:
- ONLY extract properties that are used for comparison purposes (comparable properties) or the main subject property
- EXCLUDE individual apartment units, flats, or units within the same building (e.g., "Apartment 710", "Flat 12", "Unit A")
- EXCLUDE council tax bandings, planning applications, or administrative data
- EXCLUDE individual rooms, floors, or internal spaces
- Focus on standalone properties that would be used for valuation comparison

CRITICAL ADDRESS EXTRACTION RULES:
- Extract the COMPLETE, FULL address exactly as written in the document
- NEVER use placeholders like '[location not stated]', '[comparable, local]', or '[address not fully specified]'
- Look for the actual street name, house name/number, town, city, and postcode
- Example format: 'Hill House, Arkeseden, Saffron Walden, CB11 4EX'
- If address spans multiple lines in a table, combine all parts into one complete address

PROPERTY EXTRACTION REQUIREMENTS:
- Extract ONLY comparable properties and subject properties with complete addresses
- For each property extract: complete address, type, size in sq ft, bedrooms, bathrooms, price, transaction date
- If bedroom/bathroom counts are missing, look for patterns like '6 Bed', '3 Bath', '5-bed', '4 bathroom'
- Extract exact numerical values for prices, sizes, and dates
- Preserve all amenities and features mentioned

TABLE PROCESSING:
- Process each table row as a separate property ONLY if it represents a standalone comparable property
- Skip rows that contain apartment numbers, unit numbers, or individual units within buildings
- Read address information from the leftmost 'Address' column completely
- Do not interpret table structure as part of the address content
- Extract the literal text content, not table metadata"""
        )
    
    def extract_by_classification(self, classification_type: str, file_path: str) -> Dict[str, Any]:
        """
        Extract data using appropriate schema based on classification
        
        Args:
            classification_type: The classified document type
            file_path: Path to the document file
            
        Returns:
            Extracted data dictionary
        """
        try:
            # Get appropriate schema
            schema = get_extraction_schema(classification_type)
            
            logger.info(f"Extracting from {classification_type} document using {'full' if classification_type in ['valuation_report', 'market_appraisal'] else 'minimal'} schema")
            
            if classification_type in ['valuation_report', 'market_appraisal']:
                return self.full_extraction(file_path, schema)
            else:
                return self.minimal_extraction(file_path, schema)
                
        except Exception as e:
            logger.error(f"Error in conditional extraction: {e}")
            # Fallback to minimal extraction
            return self.minimal_extraction(file_path, get_extraction_schema('other_documents'))
    
    def full_extraction(self, file_path: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Full extraction for valuation reports and market appraisals
        
        Args:
            file_path: Path to the document file
            schema: Full extraction schema
            
        Returns:
            Extracted data dictionary
        """
        try:
            # Use LlamaExtract with full schema
            result = self.extractor.extract(schema, self.extraction_config, file_path)
            extracted_data = result.data
            
            # Parse and validate extracted data
            if isinstance(extracted_data, dict):
                all_properties = extracted_data.get('all_properties', [])
            else:
                all_properties = getattr(extracted_data, 'all_properties', [])
            
            logger.info(f"Full extraction completed: {len(all_properties)} properties extracted")
            
            return {
                'extraction_type': 'full',
                'properties': all_properties,
                'total_properties': len(all_properties),
                'schema_used': 'full'
            }
            
        except Exception as e:
            logger.error(f"Error in full extraction: {e}")
            return {
                'extraction_type': 'full',
                'properties': [],
                'total_properties': 0,
                'error': str(e),
                'schema_used': 'full'
            }
    
    def minimal_extraction(self, file_path: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Minimal extraction for other document types
        
        Args:
            file_path: Path to the document file
            schema: Minimal extraction schema
            
        Returns:
            Extracted data dictionary
        """
        try:
            # For minimal extraction, we might use a simpler approach
            # or still use LlamaExtract but with minimal schema
            
            # Try LlamaExtract first
            try:
                result = self.extractor.extract(schema, self.extraction_config, file_path)
                extracted_data = result.data
                
                if isinstance(extracted_data, dict):
                    properties = extracted_data.get('properties', [])
                else:
                    properties = getattr(extracted_data, 'properties', [])
                    
            except Exception as extract_error:
                logger.warning(f"LlamaExtract failed for minimal extraction: {extract_error}")
                # Fallback to simple text parsing
                properties = self._simple_text_extraction(file_path)
            
            logger.info(f"Minimal extraction completed: {len(properties)} properties extracted")
            
            return {
                'extraction_type': 'minimal',
                'properties': properties,
                'total_properties': len(properties),
                'schema_used': 'minimal'
            }
            
        except Exception as e:
            logger.error(f"Error in minimal extraction: {e}")
            return {
                'extraction_type': 'minimal',
                'properties': [],
                'total_properties': 0,
                'error': str(e),
                'schema_used': 'minimal'
            }
    
    def _simple_text_extraction(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Simple text-based extraction as fallback
        
        Args:
            file_path: Path to the document file
            
        Returns:
            List of extracted properties
        """
        try:
            # Use LlamaParse to get text content
            parser = LlamaParse(
                api_key=self.llama_cloud_api_key,
                result_type="markdown",
                verbose=True
            )
            
            file_extractor = {
                ".pdf": parser,
                ".docx": parser,
                ".doc": parser,
                ".pptx": parser,
                ".ppt": parser
            }
            
            reader = SimpleDirectoryReader(input_dir=os.path.dirname(file_path), file_extractor=file_extractor)
            parsed_docs = reader.load_data()
            
            # Simple address extraction from text
            import re
            properties = []
            
            for doc in parsed_docs:
                text = doc.text
                
                # Look for UK postcode patterns
                postcode_pattern = r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})'
                postcodes = re.findall(postcode_pattern, text, re.IGNORECASE)
                
                # Extract addresses around postcodes
                for postcode in postcodes:
                    # Find address context around postcode
                    address_context = self._extract_address_context(text, postcode)
                    
                    if address_context:
                        properties.append({
                            'property_address': address_context,
                            'document_date': self._extract_date(text),
                            'document_type': 'other_documents',
                            'notes': f'Extracted from text near postcode {postcode}'
                        })
            
            return properties
            
        except Exception as e:
            logger.error(f"Error in simple text extraction: {e}")
            return []
    
    def _extract_address_context(self, text: str, postcode: str) -> str:
        """Extract address context around a postcode"""
        try:
            # Find the postcode in the text
            postcode_index = text.find(postcode)
            if postcode_index == -1:
                return None
            
            # Extract text around the postcode (50 characters before and after)
            start = max(0, postcode_index - 50)
            end = min(len(text), postcode_index + len(postcode) + 50)
            context = text[start:end].strip()
            
            # Clean up the context
            context = re.sub(r'\s+', ' ', context)
            return context
            
        except Exception as e:
            logger.error(f"Error extracting address context: {e}")
            return None
    
    def _extract_date(self, text: str) -> str:
        """Extract date from text"""
        try:
            import re
            from datetime import datetime
            
            # Look for common date patterns
            date_patterns = [
                r'(\d{1,2}/\d{1,2}/\d{4})',  # MM/DD/YYYY
                r'(\d{1,2}-\d{1,2}-\d{4})',  # MM-DD-YYYY
                r'(\d{4}-\d{1,2}-\d{1,2})',  # YYYY-MM-DD
                r'(\d{1,2}\s+\w+\s+\d{4})',  # DD Month YYYY
            ]
            
            for pattern in date_patterns:
                matches = re.findall(pattern, text)
                if matches:
                    return matches[0]
            
            return None
            
        except Exception as e:
            logger.error(f"Error extracting date: {e}")
            return None
