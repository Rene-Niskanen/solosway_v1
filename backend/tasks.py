import os
import boto3
from celery import shared_task
import time
from .models import db, Document, DocumentStatus
from typing import List, Optional, Dict
from pydantic import BaseModel, Field
import uuid
import requests
from requests_aws4auth import AWS4Auth
import sys
import tempfile
import shutil
import json
from datetime import datetime
from geopy.geocoders import Nominatim, GoogleV3
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import logging

# imports for LlamaIndex, LlamaParse, and LlamaExtract
from llama_parse import LlamaParse
from llama_cloud_services import LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ExtractTarget
from llama_cloud_services.extract import SourceText
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.openai import OpenAIEmbedding
from .services.extraction_schemas import SUBJECT_PROPERTY_EXTRACTION_SCHEMA


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Helper function to sync document status to Supabase
def sync_document_to_supabase(document_id, status=None, additional_data=None):
    """
    Helper function to keep Supabase documents table in sync with PostgreSQL.
    This ensures both databases have the same document status and metadata.
    """
    try:
        from .services.supabase_document_service import SupabaseDocumentService
        doc_service = SupabaseDocumentService()
        
        if status:
            success = doc_service.update_document_status(
                str(document_id), 
                status, 
                additional_data=additional_data
            )
            if success:
                logger.info(f"✅ Synced status '{status}' to Supabase for document {document_id}")
            else:
                logger.warning(f"⚠️ Failed to sync status to Supabase")
        return True
    except Exception as e:
        logger.warning(f"⚠️ Supabase sync failed (non-fatal): {e}")
        return False


# Create enhanced geocoding function for addresses
def geocode_address_parallel(addresses: list, max_workers: int = 3) -> list:
    """Geocode multiple addresses in parallel for much faster processing"""
    results = []
    
    def geocode_single(address):
        return geocode_address(address)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all geocoding tasks
        future_to_address = {executor.submit(geocode_single, addr): addr for addr in addresses}
        
        # Collect results as they complete
        for future in as_completed(future_to_address):
            address = future_to_address[future]
            try:
                result = future.result()
                results.append((address, result))
            except Exception as e:
                print(f"❌ Error geocoding {address}: {e}")
                results.append((address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "error"}))
    
    return results

def geocode_address(address: str, max_retries: int = 2) -> dict:
    """Enhanced geocoding function with address preprocessing and fallback strategies"""
    if not address or address.strip() == "":
        return {"latitude": None, "longitude": None, "confidence": 0.0, "status": "empty_address"}
    
    # Clean and preprocess the address
    cleaned_address = preprocess_address(address)
    
    # Try Google Geocoding API first (much faster and more accurate)
    google_api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
    if google_api_key:
        try:
            geolocator = GoogleV3(api_key=google_api_key, timeout=5)
            location = geolocator.geocode(cleaned_address, exactly_one=True, timeout=5)
            
            if location:
                print(f"✅ Google geocoding successful for: '{cleaned_address}'")
                return {
                    "latitude": location.latitude,
                    "longitude": location.longitude,
                    "confidence": 0.9,  # Google is more accurate
                    "status": "success",
                    "geocoded_address": location.address,
                    "original_address": address,
                    "used_variation": cleaned_address
                }
        except Exception as e:
            print(f"⚠️  Google geocoding failed: {e}, falling back to Nominatim")
    
    # Fallback to Nominatim (slower but free)
    geolocator = Nominatim(user_agent="solosway_mvp", timeout=8)
    
    # Try multiple address variations for better success rate
    address_variations = generate_address_variations(cleaned_address)
    
    for variation in address_variations:
        print(f"🔍 Trying geocoding with: '{variation}'")
        
        for attempt in range(max_retries):
            try:
                location = geolocator.geocode(variation, exactly_one=True, timeout=8)
                
                if location:
                    print(f"✅ Geocoding successful for: '{variation}'")
                    return {
                        "latitude": location.latitude,
                        "longitude": location.longitude,
                        "confidence": 0.8,  # Nominatim doesn't provide confidence scores
                        "status": "success",
                        "geocoded_address": location.address,
                        "original_address": address,
                        "used_variation": variation
                    }
                    
            except (GeocoderTimedOut, GeocoderUnavailable) as e:
                logger.warning(f"Geocoding attempt {attempt + 1} failed for '{variation}': {e}")
                if attempt == max_retries - 1:
                    continue  # Try next variation
                time.sleep(0.5)  # Shorter wait before retry
            
            except Exception as e:
                logger.warning(f"Unexpected error geocoding '{variation}': {e}")
                break  # Move to next variation
        
        # Rate limiting - shorter wait between address variations
        time.sleep(0.3)
    
    print(f"❌ All geocoding attempts failed for: '{address}'")
    return {
        "latitude": None,
        "longitude": None,
        "confidence": 0.0,
        "status": "not_found",
        "original_address": address,
        "tried_variations": len(address_variations)
    }

def preprocess_address(address: str) -> str:
    """Clean and preprocess address for better geocoding results"""
    if not address:
        return ""
    
    # Remove common formatting issues
    cleaned = address.strip()
    
    # Remove bracketed content that might confuse geocoding
    import re
    cleaned = re.sub(r'\[.*?\]', '', cleaned)
    cleaned = re.sub(r'\(.*?\)', '', cleaned)
    
    # Clean up extra whitespace and commas
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r',\s*,', ',', cleaned)
    cleaned = cleaned.strip(', ')
    
    return cleaned

def generate_address_variations(address: str) -> list:
    """Generate multiple address variations to improve geocoding success"""
    variations = [address]  # Start with original
    
    # Extract postcode for UK addresses
    import re
    postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', address, re.IGNORECASE)
    postcode = postcode_match.group(1) if postcode_match else None
    
    if postcode:
        # For UK addresses, add UK context to avoid US geocoding
        parts = address.split(',')
        if len(parts) >= 2:
            # Try last two parts (usually town and postcode) + UK
            town_postcode = ','.join(parts[-2:]).strip()
            variations.append(f"{town_postcode}, UK")
            
            # Try just postcode + UK
            variations.append(f"{postcode}, UK")
    
    # Try without specific house names/buildings
    simplified = re.sub(r'^[^,]+,\s*', '', address)  # Remove first part (house name)
    if simplified != address:
        variations.append(simplified)
    
    # Try with just the main road and postcode + UK
    if postcode:
        road_match = re.search(r'([^,]+(?:Road|Street|Lane|Way|Drive|Avenue|Close|Gardens|Manor|House|Farm)[^,]*)', address, re.IGNORECASE)
        if road_match:
            road_name = road_match.group(1).strip()
            variations.append(f"{road_name}, {postcode}, UK")
    
    # Remove duplicates while preserving order
    seen = set()
    unique_variations = []
    for variation in variations:
        if variation and variation not in seen:
            seen.add(variation)
            unique_variations.append(variation)
    
    return unique_variations

def create_property_document(property_data: dict, geocoding_result: dict) -> str:
    """Create a rich text document for property vector embedding"""
    
    # Build comprehensive property description
    description_parts = []
    
    # Basic info
    if property_data.get("property_address"):
        description_parts.append(f"Address: {property_data['property_address']}")
    
    if property_data.get("property_type"):
        description_parts.append(f"Property Type: {property_data['property_type']}")
    
    if property_data.get("number_bedrooms"):
        description_parts.append(f"Bedrooms: {property_data['number_bedrooms']}")
    
    if property_data.get("number_bathrooms"):
        description_parts.append(f"Bathrooms: {property_data['number_bathrooms']}")
    
    if property_data.get("size_sqft"):
        description_parts.append(f"Size: {property_data['size_sqft']} sq ft")
    
    # Pricing info
    pricing_info = []
    if property_data.get("asking_price"):
        pricing_info.append(f"Asking Price: £{property_data['asking_price']:,.0f}")
    if property_data.get("sold_price"):
        pricing_info.append(f"Sold Price: £{property_data['sold_price']:,.0f}")
    if property_data.get("rent_pcm"):
        pricing_info.append(f"Monthly Rent: £{property_data['rent_pcm']:,.0f}")
    if property_data.get("price_per_sqft"):
        pricing_info.append(f"Price per sq ft: £{property_data['price_per_sqft']:,.0f}")
    
    if pricing_info:
        description_parts.append("Pricing: " + ", ".join(pricing_info))
    
    # Market info
    market_info = []
    if property_data.get("condition"):
        market_info.append(f"Condition: {property_data['condition']}")
    if property_data.get("epc_rating"):
        market_info.append(f"EPC Rating: {property_data['epc_rating']}")
    if property_data.get("days_on_market"):
        market_info.append(f"Days on Market: {property_data['days_on_market']}")
    if property_data.get("tenure"):
        market_info.append(f"Tenure: {property_data['tenure']}")
    
    if market_info:
        description_parts.append("Market Info: " + ", ".join(market_info))
    
    # Transaction dates info
    transaction_info = []
    if property_data.get("transaction_date"):
        transaction_info.append(f"Transaction Date: {property_data['transaction_date']}")
    if property_data.get("sold_date"):
        transaction_info.append(f"Date of Sale: {property_data['sold_date']}")
    if property_data.get("rented_date"):
        transaction_info.append(f"Date Rented: {property_data['rented_date']}")
    if property_data.get("leased_date"):
        transaction_info.append(f"Date Leased: {property_data['leased_date']}")
    
    if transaction_info:
        description_parts.append("Transaction Info: " + ", ".join(transaction_info))
    
    # Features
    if property_data.get("other_amenities"):
        description_parts.append(f"Amenities: {property_data['other_amenities']}")
    
    if property_data.get("notes"):
        description_parts.append(f"Notes: {property_data['notes']}")
    
    # Location context
    if geocoding_result.get("geocoded_address"):
        description_parts.append(f"Location: {geocoding_result['geocoded_address']}")
    
    return "\n".join(description_parts)

def _check_llamaextract_api() -> bool:
    """Check if LlamaExtract API is accessible"""
    try:
        import requests
        api_key = os.environ.get('LLAMA_CLOUD_API_KEY')
        if not api_key:
            print("   API Key not found in environment")
            return False
        
        # Try multiple endpoints to check API accessibility
        endpoints = [
            'https://api.cloud.llamaindex.ai/api/v1/health',
            'https://api.cloud.llamaindex.ai/api/health',
            'https://api.cloud.llamaindex.ai/health'
        ]
        
        headers = {'Authorization': f'Bearer {api_key}'}
        
        for endpoint in endpoints:
            try:
                response = requests.get(endpoint, headers=headers, timeout=5)
                if response.status_code == 200:
                    print(f"   API accessible via {endpoint}")
                    return True
            except Exception as e:
                print(f"   Endpoint {endpoint} failed: {e}")
                continue
        
        print("   All API endpoints failed")
        return False
        
    except Exception as e:
        print(f"   API health check failed: {e}")
        return False

def _enhanced_fallback_extraction(document_text: str, filename: str) -> dict:
    """Enhanced fallback text-based extraction when LlamaExtract fails"""
    import re
    from datetime import datetime
    
    logger.info("🔄 Using enhanced fallback text-based extraction...")
    
    # PRIORITY 1: Extract address from filename first (most reliable)
    extracted_address = None
    postcode = None
    
    if filename:
        logger.info(f"🔍 Extracting address from filename: {filename}")
        
        # Extract postcode from filename first
        postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', filename, re.IGNORECASE)
        if postcode_match:
            postcode = postcode_match.group(1).upper()
            logger.info(f"📍 Found postcode in filename: {postcode}")
        
        # Extract full address from filename (more comprehensive patterns)
        filename_patterns = [
            # Full address with postcode: "Highlands, Berden Road, Berden, Bishop's Stortford, CM23 1AB"
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm)[^,]*,\s*[^,]+,\s*[^,]+,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})',
            # Address with road name and postcode: "Highlands Berden Road Berden Bishops Stortford CM23 1AB"
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm)[^,]*,\s*[^,]+,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})',
            # Simple road name with postcode: "Berden Road, CM23 1AB"
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm)[^,]*,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})',
            # Just road name: "Berden Road"
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm))'
        ]
        
        for pattern in filename_patterns:
            match = re.search(pattern, filename, re.IGNORECASE)
            if match:
                extracted_address = match.group(1).strip()
                # Clean up the address
                extracted_address = re.sub(r'\s+', ' ', extracted_address)
                extracted_address = re.sub(r'[^\w\s,.-]', '', extracted_address)
                logger.info(f"✅ Extracted address from filename: {extracted_address}")
                break
    
    # PRIORITY 2: If no address from filename, try document content
    if not extracted_address and document_text:
        logger.info("🔍 Extracting address from document content...")
        
        # Extract postcode from document if not found in filename
        if not postcode:
            postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', document_text, re.IGNORECASE)
            if postcode_match:
                postcode = postcode_match.group(1).upper()
                logger.info(f"📍 Found postcode in document: {postcode}")
        
        # More comprehensive address patterns for document content
        content_patterns = [
            # Full UK address with postcode
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm)[^,]*,\s*[^,]+,\s*[^,]+,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})',
            # Address with road and postcode
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm)[^,]*,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})',
            # Simple road name
            r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm))'
        ]
        
        for pattern in content_patterns:
            match = re.search(pattern, document_text, re.IGNORECASE)
            if match:
                extracted_address = match.group(1).strip()
                # Clean up the address
                extracted_address = re.sub(r'\s+', ' ', extracted_address)
                extracted_address = re.sub(r'[^\w\s,.-]', '', extracted_address)
                logger.info(f"✅ Extracted address from document: {extracted_address}")
                break
    
    # PRIORITY 3: If still no address, try to construct from available parts
    if not extracted_address and filename:
        logger.info("🔍 Attempting to construct address from filename parts...")
        
        # Extract property name and road from filename
        property_name_match = re.search(r'([A-Za-z]+)', filename)
        road_match = re.search(r'([A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl|Close|Crescent|Gardens|Manor|House|Farm))', filename, re.IGNORECASE)
        
        if property_name_match and road_match:
            property_name = property_name_match.group(1)
            road_name = road_match.group(1).strip()
            extracted_address = f"{property_name}, {road_name}"
            if postcode:
                extracted_address += f", {postcode}"
            logger.info(f"✅ Constructed address: {extracted_address}")
    
    # Extract basic property info
    bedrooms_match = re.search(r'(\d+)\s*(?:bed|bedroom|bedrooms)', document_text, re.IGNORECASE) if document_text else None
    bathrooms_match = re.search(r'(\d+)\s*(?:bath|bathroom|bathrooms)', document_text, re.IGNORECASE) if document_text else None
    size_match = re.search(r'(\d+(?:,\d+)*)\s*(?:sq\s*ft|sqft|square\s*feet)', document_text, re.IGNORECASE) if document_text else None
    
    # Extract price information (rental and purchase)
    price_patterns = [
        r'£(\d+(?:,\d+)*)',
        r'(\d+(?:,\d+)*)\s*(?:pounds?|GBP)',
        r'asking\s*(?:price|value)[:\s]*£?(\d+(?:,\d+)*)',
        r'valuation[:\s]*£?(\d+(?:,\d+)*)',
        r'market\s*value[:\s]*£?(\d+(?:,\d+)*)',
        r'assessed\s*value[:\s]*£?(\d+(?:,\d+)*)',
        r'rent[:\s]*£?(\d+(?:,\d+)*)',
        r'(\d+(?:,\d+)*)\s*per\s*(?:month|calendar\s*month|pcm)'
    ]
    
    extracted_price = None
    if document_text:
        for pattern in price_patterns:
            match = re.search(pattern, document_text, re.IGNORECASE)
            if match:
                try:
                    extracted_price = float(match.group(1).replace(',', ''))
                    break
                except ValueError:
                    continue
    
    # Extract property type
    property_types = ['house', 'flat', 'apartment', 'detached', 'semi-detached', 'terraced', 'bungalow', 'cottage', 'mansion', 'townhouse']
    extracted_type = None
    if document_text:
        for prop_type in property_types:
            if prop_type.lower() in document_text.lower():
                extracted_type = prop_type.title()
                break
    
    # Final validation - ensure we have a reasonable address
    if extracted_address and len(extracted_address) < 5:
        logger.warning(f"⚠️ Address too short, rejecting: {extracted_address}")
        extracted_address = None
    
    logger.info(f"🎯 Final extraction result:")
    logger.info(f"   Address: {extracted_address or 'NOT FOUND'}")
    logger.info(f"   Postcode: {postcode or 'NOT FOUND'}")
    logger.info(f"   Property Type: {extracted_type or 'NOT FOUND'}")
    logger.info(f"   Price: {extracted_price or 'NOT FOUND'}")
    
    return {
        'properties': [{
            'property_address': extracted_address or 'Address not found',
            'property_type': extracted_type or 'Property',
            'number_bedrooms': int(bedrooms_match.group(1)) if bedrooms_match else None,
            'number_bathrooms': int(bathrooms_match.group(1)) if bathrooms_match else None,
            'size_sqft': int(size_match.group(1).replace(',', '')) if size_match else None,
            'asking_price': extracted_price,
            'postcode': postcode,
            'notes': f'Extracted using enhanced fallback text analysis from {filename}',
            'extraction_method': 'enhanced_fallback',
            'document_date': datetime.utcnow().isoformat()
        }]
    }

def _fallback_text_extraction(document_text: str, filename: str) -> dict:
    """Fallback text-based extraction when LlamaExtract fails"""
    import re
    from datetime import datetime
    
    print("🔄 Using fallback text-based extraction...")
    
    # Extract address from text using multiple patterns
    address_patterns = [
        r'\d+\s+[\w\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Place|Pl)',
        r'[A-Za-z\s]+,\s*[A-Za-z\s]+,\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}',
        r'[A-Za-z\s]+,\s*[A-Za-z\s]+'
    ]
    
    extracted_address = None
    for pattern in address_patterns:
        match = re.search(pattern, document_text, re.IGNORECASE)
        if match:
            extracted_address = match.group(0).strip()
            break
    
    # Extract basic property info
    bedrooms_match = re.search(r'(\d+)\s*(?:bed|bedroom|bedrooms)', document_text, re.IGNORECASE)
    bathrooms_match = re.search(r'(\d+)\s*(?:bath|bathroom|bathrooms)', document_text, re.IGNORECASE)
    size_match = re.search(r'(\d+(?:,\d+)*)\s*(?:sq\s*ft|sqft|square\s*feet)', document_text, re.IGNORECASE)
    
    # Extract price information
    price_patterns = [
        r'£(\d+(?:,\d+)*)',
        r'(\d+(?:,\d+)*)\s*(?:pounds?|GBP)',
        r'asking\s*(?:price|value)[:\s]*£?(\d+(?:,\d+)*)',
        r'valuation[:\s]*£?(\d+(?:,\d+)*)'
    ]
    
    extracted_price = None
    for pattern in price_patterns:
        match = re.search(pattern, document_text, re.IGNORECASE)
        if match:
            try:
                extracted_price = float(match.group(1).replace(',', ''))
                break
            except ValueError:
                continue
    
    # Extract property type
    property_types = ['house', 'flat', 'apartment', 'detached', 'semi-detached', 'terraced', 'bungalow', 'cottage']
    extracted_type = None
    for prop_type in property_types:
        if prop_type.lower() in document_text.lower():
            extracted_type = prop_type.title()
            break
    
    return {
        'subject_property': {
            'property_address': extracted_address or 'Address not found',
            'property_type': extracted_type or 'Property',
            'number_bedrooms': int(bedrooms_match.group(1)) if bedrooms_match else None,
            'number_bathrooms': int(bathrooms_match.group(1)) if bathrooms_match else None,
            'size_sqft': int(size_match.group(1).replace(',', '')) if size_match else None,
            'asking_price': extracted_price,
            'notes': f'Extracted using fallback text analysis from {filename}'
        }
    }

def clean_extracted_property(property_data):
    """Clean extracted data to ensure proper data types"""
    cleaned = {}
    
    # Clean numeric fields
    numeric_fields = ['number_bedrooms', 'number_bathrooms', 'size_sqft', 'asking_price', 'sold_price', 'rent_pcm', 'price_per_sqft', 'yield_percentage']
    for field in numeric_fields:
        value = property_data.get(field)
        if value is not None:
            import re
            if isinstance(value, str):
                # Extract first number from strings like "5 (all en-suites)"
                match = re.search(r'(\d+(?:\.\d+)?)', value)
                if match:
                if field in ['number_bedrooms', 'number_bathrooms']:
                        # Always convert to int for bedrooms/bathrooms
                        cleaned[field] = int(float(match.group(1)))
                else:
                        cleaned[field] = float(match.group(1))
                else:
                    cleaned[field] = None
            elif isinstance(value, (int, float)):
                # Handle numeric values - convert floats to ints for bedrooms/bathrooms
                if field in ['number_bedrooms', 'number_bathrooms']:
                    cleaned[field] = int(value)  # Convert float to int
                else:
                    cleaned[field] = float(value) if isinstance(value, float) else value
            else:
                cleaned[field] = value
        else:
            cleaned[field] = None
    
    # Copy other fields as-is
    for key, value in property_data.items():
        if key not in numeric_fields:
            cleaned[key] = value
    
    return cleaned


# Old extract_images_from_document function removed - now using ImageExtractionService

# Old schema removed - using extraction_schemas.py instead

# AstraDB session function removed - using Supabase only

@shared_task(bind=True)
def process_document_classification(self, document_id, file_content, original_filename, business_id):
    """
    Step 1: Document Classification with Event Logging
    """
    from . import create_app
    from .models import db, Document, DocumentStatus
    from .services.classification_service import DocumentClassificationService
    from .services.processing_history_service import ProcessingHistoryService
    from .services.filename_address_service import FilenameAddressService
    from llama_parse import LlamaParse
    import tempfile
    import os
    
    app = create_app()
    
    with app.app_context():
        document = Document.query.get(document_id)
        if not document:
            logger.error(f"Document with id {document_id} not found.")
            return {"error": "Document not found"}
        
        # Initialize processing history service
        history_service = ProcessingHistoryService()
        
        try:
            logger.info(f"Starting document classification for document_id: {document_id}")
            
            # NEW: Extract address from filename FIRST (before document extraction)
            logger.info(f"🔍 Attempting to extract address from filename: {original_filename}")
            filename_service = FilenameAddressService()
            filename_address = filename_service.extract_address_from_filename(original_filename)
            
            if filename_address:
                filename_confidence = filename_service.confidence_score(filename_address)
                logger.info(f"📍 Extracted address from filename: '{filename_address}' (confidence: {filename_confidence:.2f})")
                
                # Store filename address in document metadata for later use
                document.metadata_json = json.dumps({
                    'filename_address': filename_address,
                    'filename_address_confidence': filename_confidence,
                    'address_source': 'filename'
                })
                db.session.commit()
                logger.info(f"✅ Saved filename address to document metadata")
            else:
                logger.info(f"ℹ️  No address found in filename, will rely on document content extraction")
            
            # Log step start
            history_id = history_service.log_step_start(
                document_id=str(document_id),
                step_name='classification',
                step_metadata={
                    'filename': original_filename,
                    'file_size': len(file_content),
                    'business_id': business_id
                }
            )
            
            # Update document status
            document.status = DocumentStatus.PROCESSING
            db.session.commit()
            
            # Create document in Supabase if it doesn't exist
            try:
                from .services.supabase_document_service import SupabaseDocumentService
                doc_service = SupabaseDocumentService()
                
                # Check if document exists in Supabase
                existing_doc = doc_service.get_document_by_id(str(document_id))
                if not existing_doc:
                    # Create document in Supabase
                    doc_data = {
                        'id': str(document_id),
                        'original_filename': original_filename,
                        's3_path': document.s3_path,
                        'file_type': document.file_type,
                        'file_size': document.file_size,
                        'uploaded_by_user_id': str(document.uploaded_by_user_id),
                        'business_id': business_id,
                        'status': 'processing',
                        'created_at': document.created_at.isoformat() if document.created_at else None,
                        'updated_at': datetime.utcnow().isoformat()
                    }
                    doc_service.create_document(doc_data)
                    logger.info(f"✅ Created document in Supabase: {document_id}")
                else:
                    # Update existing document status
                    doc_service.update_document_status(str(document_id), 'processing')
                    logger.info(f"✅ Updated document status in Supabase: {document_id}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to sync document to Supabase: {e}")
                # Continue processing - don't fail the task
            
            # Save file temporarily for parsing
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            try:
                # Extract text using LlamaParse
                logger.info(f"Extracting text from: {original_filename}")
                parser = LlamaParse(
                    api_key=os.environ['LLAMA_CLOUD_API_KEY'],
                    result_type="text"
                )
                parsed_docs = parser.load_data(temp_file_path)
                document_text = "\n".join([doc.text for doc in parsed_docs])
                
                logger.info(f"Extracted {len(document_text)} characters of text")
                
                # Store parsed text
                document.parsed_text = document_text
                db.session.commit()
                
                # Log text extraction success
                history_service.log_step_completion(
                    history_id=history_id,
                    step_message=f"Text extraction completed: {len(document_text)} characters",
                    step_metadata={'text_length': len(document_text)}
                )
                
            except Exception as e:
                logger.error(f"LlamaParse extraction failed: {e}")
                # Use fallback text extraction
                document_text = f"Document: {original_filename}\nSize: {len(file_content)} bytes"
                document.parsed_text = document_text
                
                # Log text extraction with fallback
                history_service.log_step_completion(
                    history_id=history_id,
                    step_message=f"Text extraction completed with fallback: {len(document_text)} characters",
                    step_metadata={
                        'text_length': len(document_text),
                        'fallback_used': True,
                        'extraction_error': str(e)
                    }
                )
            
            # Classify the document
            logger.info(f"Classification document: {original_filename}")
            from .services.classification_service import classify_document_sync

            try:
                classification_result = classify_document_sync(temp_file_path, document_text)
                logger.info(f"Document classified as: {classification_result['type']} (confidence: {classification_result['confidence']:.2f})")
            except Exception as e:
                logger.error(f"Error in classification: {e}")
                raise
            
            
            # Classes the document with classification results
            document.classification_type = classification_result['type']
            document.classification_confidence = classification_result['confidence']
            document.classification_reasoning = classification_result['reasoning']
            document.classification_timestamp = datetime.utcnow()
            document.status = DocumentStatus.COMPLETED
            db.session.commit()
            
            # Sync classification to Supabase
            try:
                from .services.supabase_document_service import SupabaseDocumentService
                doc_service = SupabaseDocumentService()
                
                additional_data = {
                'classification_type': classification_result['type'],
                'classification_confidence': classification_result['confidence'],
                'classification_timestamp': document.classification_timestamp.isoformat()
                }
                
                doc_service.update_document_status(str(document_id), 'completed', additional_data)
                logger.info(f"✅ Updated classification in Supabase: {document_id}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to sync classification to Supabase: {e}")
            
            # Log classification completion
            history_service.log_step_completion(
                history_id=history_id,
                step_message=f"Document classified as '{classification_result['type']}' with confidence {classification_result['confidence']:.2f}",
                step_metadata={
                    'classification_type': classification_result['type'],
                    'classification_confidence': classification_result['confidence'],
                    'classification_reasoning': classification_result['reasoning']
                }
            )
            
            logger.info(f"✅ Document classified as '{classification_result['type']}' with confidence {classification_result['confidence']:.2f}")
            
            # Trigger appropriate extraction pipeline based on classification
            if classification_result['type'] in ['valuation_report', 'market_appraisal']:
                logger.info(f"🎯 CLASSIFICATION COMPLETE: {classification_result['type']}")
                logger.info(f"🔄 TRIGGERING FULL EXTRACTION: process_document_with_dual_stores")
                logger.info(f"   Document ID: {document_id}")
                logger.info(f"   Business ID: {business_id}")
                logger.info(f"   Filename: {original_filename}")
                
                task = process_document_with_dual_stores.delay(
                    document_id=document_id,
                    file_content=file_content,
                    original_filename=original_filename,
                    business_id=business_id
                )
                
                logger.info(f"✅ EXTRACTION TASK QUEUED: {task.id}")
                return task
            else:
                logger.info(f"🎯 CLASSIFICATION COMPLETE: {classification_result['type']}")
                logger.info(f"🔄 TRIGGERING MINIMAL EXTRACTION: process_document_minimal_extraction")
                
                task = process_document_minimal_extraction.delay(
                    document_id=document_id,
                    file_content=file_content,
                    original_filename=original_filename,
                    business_id=business_id
                )
                
                logger.info(f"✅ MINIMAL EXTRACTION TASK QUEUED: {task.id}")
                return task
            
            return {
                "status": "classified",
                "type": classification_result['type'],
                "confidence": classification_result['confidence'],
                "reasoning": classification_result['reasoning'],
                "history_id": history_id
            }
            
        except Exception as e:
            logger.error(f"❌ Error in document classification: {e}")
            
            # Log failure if we have a history_id
            if 'history_id' in locals():
                history_service.log_step_failure(
                    history_id=history_id,
                    error_message=str(e),
                    step_metadata={'error_type': type(e).__name__}
                )
            
            try:
                document.status = DocumentStatus.FAILED
                db.session.commit()
            except:
                pass
            return {"error": str(e)}
        
        finally:
            # Clean up temporary file
            try:
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
            except:
                pass

@shared_task(bind=True)
def process_document_minimal_extraction(self, document_id, file_content, original_filename, business_id):
    """
    Minimal extraction pipeline for non-valuation documents.
    Only extracts basic property information if available, and document metadata.
    """
    from . import create_app
    from .models import db, Document, DocumentStatus
    from .services.processing_history_service import ProcessingHistoryService
    from llama_parse import LlamaParse
    from .services.extraction_schemas import MINIMAL_EXTRACTION_SCHEMA
    import tempfile
    import os

    app = create_app()

    with app.app_context():
        document = Document.query.get(document_id)
        if not document:
            logger.error(f"Document with id {document_id} not found.")
            return {'error': 'Document not found'}

        # Initialise processing history service 
        history_service = ProcessingHistoryService()

        try:
            logger.info(f"Starting minimal extraction for document: {document_id}")

            # log the step start
            history_id = history_service.log_step_start(
                document_id=str(document_id),
                step_name='minimal_extraction',
                step_metadata={
                    'filename': original_filename,
                    'file_size': len(file_content),
                    'business_id': business_id
                }
            )

            # update the document status
            document.status = DocumentStatus.PROCESSING
            db.session.commit()

            # save file temporarily for parsing
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            try:
                # Extract the text using Llamaparse
                logger.info(f"Extracting text from: {original_filename}")
                parser = LlamaParse(
                    api_key=os.environ['LLAMA_CLOUD_API_KEY'],
                    result_type="text"
                )
                parsed_docs = parser.load_data(temp_file_path)
                document_text = "\n".join([doc.text for doc in parsed_docs])

                # store parsed text
                document.parsed_text = document_text
                db.session.commit()

                # Extract the minimal information using dedicated LlamaExtract agent for other_documents
                extractor = LlamaExtract(api_key=os.environ['LLAMA_CLOUD_API_KEY'])
                
                # Get the appropriate schema based on document classification
                from .services.extraction_schemas import get_extraction_schema
                classification_type = document.classification_type or 'other_documents'
                extraction_schema = get_extraction_schema(classification_type)
                
                logger.info(f"🎯 Using extraction schema for: {classification_type}")
                
                # Add timeout handling for minimal extraction
                import signal
                
                def timeout_handler(signum, frame):
                    raise TimeoutError("LlamaExtract job timed out after 3 minutes")
                
                # Set timeout to 3 minutes for minimal extraction
                signal.signal(signal.SIGALRM, timeout_handler)
                signal.alarm(180)
                
                try:
                    # Create or get dedicated agent for other_documents
                    if classification_type == 'other_documents':
                        agent_name = "other-documents-property-extraction"
                        logger.info(f"🔄 Creating/getting dedicated agent for other_documents: {agent_name}")
                        
                        try:
                            # Try to get existing agent first
                            agent = extractor.get_agent(name=agent_name)
                            logger.info(f"✅ Found existing agent: {agent_name}")
                        except Exception as get_error:
                            logger.info(f"⚠️ Agent '{agent_name}' not found: {get_error}")
                            logger.info(f"🔄 Creating new agent: {agent_name}")
                            
                            # Create new agent with specialized schema
                            from llama_cloud import ExtractConfig, ExtractMode, ExtractTarget
                            config = ExtractConfig(
                                extraction_mode=ExtractMode.MULTIMODAL,
                                extraction_target=ExtractTarget.PER_DOC,
                                high_resolution_mode=True,
                                cite_sources=True,
                                use_reasoning=False,
                                confidence_scores=True,
                            )
                            
                            agent = extractor.create_agent(
                                name=agent_name,
                                data_schema=extraction_schema,
                                config=config
                            )
                            logger.info(f"✅ Successfully created new agent: {agent_name}")
                        
                        # Use the agent for extraction
                        logger.info(f"🔄 Using agent extraction for other_documents...")
                        result = agent.extract(temp_file_path)
                        extracted_data = result.data
                        logger.info("✅ Agent extraction completed successfully")
                        
                    else:
                        # For non-other_documents, use direct extraction
                        logger.info("🔄 Using direct extraction for non-other_documents...")
                        
                        # Try different LlamaExtract methods
                        if hasattr(extractor, 'extract_from_file'):
                            extraction_result = extractor.extract_from_file(
                                schema=extraction_schema,
                                file_path=temp_file_path
                            )
                            extracted_data = extraction_result
                            logger.info("✅ LlamaExtract completed using extract_from_file")
                        
                        elif hasattr(extractor, 'extract'):
                            extraction_result = extractor.extract(
                                schema=extraction_schema,
                                file_path=temp_file_path
                            )
                            extracted_data = extraction_result
                            logger.info("✅ LlamaExtract completed using extract")
                        
                        elif hasattr(extractor, 'extract_from_text'):
                            extraction_result = extractor.extract_from_text(
                                schema=extraction_schema,
                                text=document_text
                            )
                            extracted_data = extraction_result
                            logger.info("✅ LlamaExtract completed using extract_from_text")
                        
                        else:
                            raise AttributeError("No suitable LlamaExtract method found")
                    
                    signal.alarm(0)  # Cancel the alarm
                    
                except AttributeError as e:
                    signal.alarm(0)  # Cancel the alarm
                    logger.warning(f"⚠️ LlamaExtract method not available: {e}")
                    logger.info("🔄 Falling back to enhanced text extraction...")
                    
                    # Enhanced fallback extraction
                    extracted_data = _enhanced_fallback_extraction(document_text, original_filename)
                    
                except TimeoutError:
                    signal.alarm(0)  # Cancel the alarm
                    logger.warning("⚠️ LlamaExtract timed out, using enhanced fallback")
                    extracted_data = _enhanced_fallback_extraction(document_text, original_filename)
                    
                except Exception as e:
                    signal.alarm(0)  # Cancel the alarm
                    logger.warning(f"⚠️ LlamaExtract failed: {e}, using enhanced fallback")
                    extracted_data = _enhanced_fallback_extraction(document_text, original_filename)

                # store the extracted data
                document.extracted_json = json.dumps(extracted_data)
                document.status = DocumentStatus.COMPLETED  # FIXED: EXTRACTED doesn't exist in enum
                db.session.commit()
                
                # Sync completion to Supabase
                sync_document_to_supabase(document_id, 'completed')

                # ========================================================================
                # PROPERTY LINKING FOR MINIMAL EXTRACTION
                # ========================================================================
                
                logger.info("🔗 Starting property linking for minimal extraction...")
                
                # Handle different extraction data formats
                extracted_properties = []
                
                if classification_type == 'other_documents' and 'subject_property' in extracted_data:
                    # New format: subject_property object
                    subject_prop = extracted_data['subject_property']
                    if subject_prop and subject_prop.get('property_address'):
                        extracted_properties = [subject_prop]
                        logger.info(f"📍 Found subject property in other_documents format")
                elif 'properties' in extracted_data:
                    # Legacy format: properties array
                    extracted_properties = extracted_data.get('properties', [])
                    logger.info(f"📍 Found {len(extracted_properties)} properties in legacy format")
                
                if extracted_properties:
                    logger.info(f"📍 Processing {len(extracted_properties)} extracted properties")
                    
                    from .services.address_service import AddressNormalizationService
                    from .services.supabase_property_hub_service import SupabasePropertyHubService
                    
                    address_service = AddressNormalizationService()
                    property_hub_service = SupabasePropertyHubService()
                    
                    # Process each extracted property
                    for i, prop in enumerate(extracted_properties):
                        property_address = prop.get('property_address')
                        if property_address and property_address != 'Address not found':
                            logger.info(f"📍 Processing property {i+1}: {property_address}")
                            
                            try:
                                # Normalize address and compute hash
                                normalized = address_service.normalize_address(property_address)
                                address_hash = address_service.compute_address_hash(normalized)
                                geocoding_result = address_service.geocode_address(property_address)
                                
                                address_data = {
                                    'original_address': property_address,
                                    'normalized_address': normalized,
                                    'address_hash': address_hash,
                                    'latitude': geocoding_result.get('latitude'),
                                    'longitude': geocoding_result.get('longitude'),
                                    'formatted_address': geocoding_result.get('formatted_address'),
                                    'geocoding_status': geocoding_result.get('status'),
                                    'geocoding_confidence': geocoding_result.get('confidence'),
                                    'geocoder_used': geocoding_result.get('geocoder', 'none')
                                }
                                
                                logger.info(f"✅ Address processed: {address_data['formatted_address']}")
                                
                                # Create property hub using enhanced matching
                                hub_result = property_hub_service.create_property_with_relationships(
                                    address_data=address_data,
                                    document_id=str(document_id),
                                    business_id=business_id,
                                    extracted_data=prop
                                )
                                
                                if hub_result['success']:
                                    logger.info(f"✅ Property linked successfully: {hub_result['property_id']}")
                                    logger.info(f"   Match type: {hub_result['match_type']}")
                                    logger.info(f"   Confidence: {hub_result['confidence']:.2f}")
                                    logger.info(f"   Action: {hub_result['action']}")
                                else:
                                    logger.warning(f"⚠️ Property linking failed: {hub_result.get('error', 'Unknown error')}")
                                    
                            except Exception as e:
                                logger.error(f"❌ Error processing property {i+1}: {e}")
                                continue
                        else:
                            logger.info(f"⚠️ Property {i+1} has no valid address: {property_address}")
                else:
                    logger.info("ℹ️ No properties found in minimal extraction - skipping property linking")

                # log history completion
                history_service.log_step_completion(
                    history_id=history_id,
                    step_message=f"Minimal extraction completed with property linking",
                    step_metadata={
                        'extracted_properties': len(extracted_data.get('properties', [])),
                        'text_length': len(document_text),
                        'property_linking_attempted': len(extracted_properties) > 0
                    }
                )

                return {
                    'status': 'completed',  # FIXED: Return 'completed' instead of 'extracted'
                    'properties': extracted_data.get('properties', []),
                    'history_id': history_id
                }

            except Exception as e:
                logger.error(f"Error in minimal extraction: {e}")
                document.status = DocumentStatus.FAILED
                db.session.commit()

                if 'history_id' in locals():
                    history_service.log_step_failure(
                        history_id=history_id,
                        error_message=str(e)
                    )

                return {"error": str(e)}

            finally:
                # clean up temp file
                try:
                    if os.path.exists(temp_file_path):
                        os.unlink(temp_file_path)
                except:
                    pass
        
        except Exception as e:
            logger.error(f"❌ Error in minimal extraction task: {e}")
            try:
                document.status = DocumentStatus.FAILED
                db.session.commit()
            except:
                pass
            return {"error": str(e)}

@shared_task(bind=True)
def process_document_with_dual_stores(self, document_id, file_content, original_filename, business_id):
    """
    Celery task to process an uploaded document:
    1. Receives file content directly.
    2. Saves content to a temporary file.
    3. Parses with LlamaParse.
    4. Extracts structured data using LlamaExtract.
    5. Stores data in Supabase.
    """
    from . import create_app
    app = create_app()
    
    with app.app_context():
        print("=" * 80)
        print("🚀 EXTRACTION TASK STARTED: process_document_with_dual_stores")
        print(f"   Document ID: {document_id}")
        print(f"   Business ID: {business_id}")
        print(f"   Filename: {original_filename}")
        print(f"   File size: {len(file_content)} bytes")
        print("=" * 80)
        
        document = Document.query.get(document_id)
        if not document:
            print(f"❌ Document with id {document_id} not found.")
            return

        temp_dir = None
        try:
            print(f"🔄 Starting direct content processing for document_id: {document_id}")
            document.status = DocumentStatus.PROCESSING
            db.session.commit()

            # --- 1. Save received file content to a temporary file ---
            temp_dir = tempfile.mkdtemp()
            temp_image_dir = os.path.join(temp_dir, 'images')
            os.makedirs(temp_image_dir, exist_ok=True)
            temp_file_path = os.path.join(temp_dir, original_filename)
            with open(temp_file_path, 'wb') as f:
                f.write(file_content)
            
            print(f"Successfully saved direct content to {temp_file_path}")
            print(f"Processing document for business_id: {business_id}")
            print(f"Image extraction directory: {temp_image_dir}")
        
            # --- 2. Parse with LlamaParse (text only - images via LlamaExtract schema) ---
            parser = LlamaParse(
                api_key=os.environ['LLAMA_CLOUD_API_KEY'],
                result_type="markdown",  # or "text" - we just need text for extraction
                verbose=False,  # Reduce logging overhead
                language="en"
            )
            
            # Use aparse to get the JobResult object
            import asyncio
            llama_parse_result = asyncio.run(parser.aparse(temp_file_path))
            
            # Extract pages from result
            parsed_docs = None
            if hasattr(llama_parse_result, 'pages'):
                parsed_docs = llama_parse_result.pages
            elif isinstance(llama_parse_result, (list, tuple)):
                parsed_docs = llama_parse_result
            elif isinstance(llama_parse_result, dict):
                parsed_docs = llama_parse_result.get('pages', [])
            
            if not parsed_docs:
                parsed_docs = []
            
            print(f"✅ Parsed document: {len(parsed_docs)} pages")

            # --- Content Validation ---
            has_content = any(hasattr(page, 'text') and page.text and page.text.strip() not in ['', 'NO_CONTENT_HERE'] for page in parsed_docs)
            if not has_content:
                raise ValueError("LlamaParse did not return any meaningful content.")

            # Content validation completed

            # Extract text from parsed documents for fallback
            document_text = "\n".join([page.text for page in parsed_docs if hasattr(page, 'text') and page.text])
            print(f"📄 Extracted {len(document_text)} characters of text for processing")

            # --- 3. Extract structured data using LlamaExtract with timeout handling ---
            print("🔄 Starting property extraction with timeout protection...")
            
            # Add timeout and error handling for LlamaExtract
            import signal
            
            def timeout_handler(signum, frame):
                raise TimeoutError("LlamaExtract job timed out after 5 minutes")
            
            # Set timeout to 5 minutes (300 seconds)
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(300)
            
            try:
                # Environment validation and debugging
                print("🔍 LlamaExtract Configuration Check:")
                print(f"   API Key present: {'✅' if os.environ.get('LLAMA_CLOUD_API_KEY') else '❌'}")
                print(f"   File path: {temp_file_path}")
                print(f"   File exists: {'✅' if os.path.exists(temp_file_path) else '❌'}")
                print(f"   File size: {os.path.getsize(temp_file_path) if os.path.exists(temp_file_path) else 'N/A'} bytes")
                
                # Check API accessibility
                api_accessible = _check_llamaextract_api()
                print(f"   API accessible: {'✅' if api_accessible else '❌'}")
                
                if not api_accessible:
                    print("⚠️ LlamaExtract API not accessible, using fallback immediately")
                    signal.alarm(0)  # Cancel the alarm
                    extracted_data = _fallback_text_extraction(document_text, original_filename)
                else:
                    print("Initializing LlamaExtract with multimodal mode...")
                    extractor = LlamaExtract(api_key=os.environ['LLAMA_CLOUD_API_KEY'])
                    
                    # Use the correct pattern from documentation
                    config = ExtractConfig(
                        extraction_mode=ExtractMode.MULTIMODAL,
                        extraction_target=ExtractTarget.PER_DOC,
                        high_resolution_mode=True,
                        cite_sources=True,
                        use_reasoning=False,
                        confidence_scores=False,
                    )
                    
                    agent_name = f"advanced-pipeline-extraction-v2"
                    
                    try:
                        # Step 1: Try to get existing agent first (most efficient)
                        print(f"🔍 Looking for existing agent: {agent_name}")
                        agent = extractor.get_agent(name=agent_name)
                        print(f"✅ Found existing agent: {agent_name}")
                        
                    except Exception as get_error:
                        print(f"⚠️ Agent '{agent_name}' not found: {get_error}")
                        print(f"🔄 Creating new agent: {agent_name}")
                        
                        try:
                            # Step 2: Create new agent with schema-based name
                            agent = extractor.create_agent(
                                name=agent_name,
                                data_schema=SUBJECT_PROPERTY_EXTRACTION_SCHEMA,
                                config=config
                            )
                            print(f"✅ Successfully created new agent: {agent_name}")
                            
                        except Exception as create_error:
                            print(f"❌ Failed to create agent '{agent_name}': {create_error}")
                            print("🔄 Falling back to direct extraction...")
                            
                            # Step 3: Fallback to direct extraction
                            try:
                                result = extractor.extract_from_file(
                                    file_path=temp_file_path,
                                    schema=SUBJECT_PROPERTY_EXTRACTION_SCHEMA
                                )
                                extracted_data = result.data
                                print("✅ Direct extraction completed successfully")
                                
                                # Skip agent extraction and continue
                                signal.alarm(0)
                                # Continue to agent extraction
                                
                            except Exception as direct_error:
                                print(f"❌ Direct extraction also failed: {direct_error}")
                                print("🔄 Using text fallback...")
                                extracted_data = _fallback_text_extraction(document_text, original_filename)
                                signal.alarm(0)
                                # Continue to agent extraction
                    
                    # Step 4: Use the agent (either existing or newly created)
                    try:
                        print(f"🔄 Using agent extraction with: {agent_name}")
                        result = agent.extract(temp_file_path)
                        extracted_data = result.data
                        print("✅ Agent extraction completed successfully")
                        
                    except Exception as agent_error:
                        print(f"❌ Agent extraction failed: {agent_error}")
                        print("🔄 Falling back to direct extraction...")
                        
                        try:
                            result = extractor.extract_from_file(
                                file_path=temp_file_path,
                                schema=SUBJECT_PROPERTY_EXTRACTION_SCHEMA
                            )
                            extracted_data = result.data
                            print("✅ Direct extraction completed successfully")
                            
                        except Exception as direct_error:
                            print(f"❌ Direct extraction also failed: {direct_error}")
                            print("🔄 Using text fallback...")
                            extracted_data = _fallback_text_extraction(document_text, original_filename)
                    
                            # Cancel the alarm
                            signal.alarm(0)
                
            except Exception as e:
                print(f"❌ LlamaExtract failed: {e}")
                signal.alarm(0)  # Cancel the alarm
                # Fallback to text-based extraction
                extracted_data = _fallback_text_extraction(document_text, original_filename)
                
            except TimeoutError:
                print("❌ LlamaExtract job timed out after 5 minutes")
                signal.alarm(0)  # Cancel the alarm
                # Fallback to text-based extraction
                extracted_data = _fallback_text_extraction(document_text, original_filename)
                
            except AttributeError as e:
                print(f"❌ Direct extract method not available: {e}")
                signal.alarm(0)  # Cancel the alarm
                print("🔄 Falling back to agent-based approach...")
                
                try:
                    agent_name = "advanced-pipeline-extraction"
                    agent = extractor.get_agent(name=agent_name)
                    print(f"✅ Using existing Velora extraction agent: {agent_name}")
                    
                    # Set timeout for agent extraction too
                    signal.alarm(300)
                    result = agent.extract(temp_file_path)
                    extracted_data = result.data
                    signal.alarm(0)
                    print("✅ Agent extraction completed successfully")
                    
                except Exception as agent_error:
                    print(f"❌ Agent extraction failed: {agent_error}")
                    signal.alarm(0)  # Cancel the alarm
                    # Fallback to text-based extraction
                    extracted_data = _fallback_text_extraction(document_text, original_filename)
                    
            except Exception as e:
                print(f"❌ LlamaExtract failed: {e}")
                signal.alarm(0)  # Cancel the alarm
                # Fallback to text-based extraction
                extracted_data = _fallback_text_extraction(document_text, original_filename)

            # Data extraction completed successfully

            # Parse extracted data from Velora agent
            if isinstance(extracted_data, dict):
                # Handle the new subject_property schema format
                if 'data' in extracted_data:
                    # Match llama extract output
                    subject_property = extracted_data['data'].get('subject_property')
                else:
                    # Match direct format
                    subject_property = extracted_data.get('subject_property')
                
                if subject_property:
                    # Clean the data before processing
                    subject_property = clean_extracted_property(subject_property)
                    subject_properties = [subject_property]
                    
                    print(f"✅ Successfully extracted and cleaned subject property")
                    print(f"   📍 Address: {subject_property.get('property_address', 'N/A')}")
                    print(f"   🏠 Type: {subject_property.get('property_type', 'N/A')}")
                    print(f"   🛏️  Bedrooms: {subject_property.get('number_bedrooms', 'N/A')}")
                    print(f"   🚿 Bathrooms: {subject_property.get('number_bathrooms', 'N/A')}")
                    print(f"   📐 Size: {subject_property.get('size_sqft', 'N/A')} sq ft")
                    
                    # Process images from LlamaExtract schema result
                    # Handle null values from LlamaExtract (null becomes None in Python)
                    property_images_data = subject_property.get('property_images') or []
                    if property_images_data is None:
                        property_images_data = []
                    primary_image = subject_property.get('primary_image')
                    
                    if property_images_data or primary_image:
                        print(f"🖼️ Processing {len(property_images_data)} images from extraction schema...")
                        
                        try:
                            from .services.image_extraction_service import ImageExtractionService
                            image_service = ImageExtractionService()
                            
                            processed_images = image_service.process_extraction_schema_images(
                                images_data=property_images_data,
                                primary_image=primary_image,
                                document_id=str(document_id),
                                business_id=business_id,
                                property_id=None  # Will be linked later
                            )
                            
                            # Add processed images to subject_property
                            subject_property['property_images'] = processed_images['images']
                            subject_property['image_count'] = processed_images['image_count']
                            subject_property['primary_image_url'] = processed_images['primary_image_url']
                            subject_property['image_metadata'] = {
                                'extraction_method': 'llamæxtract_schema',
                                'extraction_timestamp': datetime.utcnow().isoformat(),
                                'total_extracted': len(property_images_data),
                                'successful_uploads': processed_images['image_count']
                            }
                            
                            print(f"✅ Processed {processed_images['image_count']} images from extraction schema")
                        except Exception as e:
                            print(f"⚠️ Failed to process images from extraction schema: {e}")
                            import traceback
                            traceback.print_exc()
                            # Set defaults if processing fails
                            subject_property['property_images'] = []
                            subject_property['image_count'] = 0
                            subject_property['primary_image_url'] = None
                            subject_property['image_metadata'] = {}
                    else:
                        print("ℹ️ No images found in extraction schema result")
                        subject_property['property_images'] = []
                        subject_property['image_count'] = 0
                        subject_property['primary_image_url'] = None
                        subject_property['image_metadata'] = {}
                else:
                    print("   ❌ No subject property found in extraction results")
                    subject_properties = []
                
                # Clean up the extracted address
                if subject_properties and subject_properties[0]:
                    raw_address = subject_properties[0].get('property_address', '')
                    if raw_address:
                        # Remove apartment numbers from the beginning
                        import re
                        # Pattern to match apartment numbers at the start
                        apartment_pattern = r'^[\d\s,]+(?=[A-Za-z])'
                        cleaned_address = re.sub(apartment_pattern, '', raw_address).strip()
                        # Remove leading comma if present
                        cleaned_address = re.sub(r'^,\s*', '', cleaned_address).strip()
                        
                        print(f"🧹 Address cleaning:")
                        print(f"   Original: {raw_address}")
                        print(f"   Cleaned:  {cleaned_address}")
                        
                        # Update the property with cleaned address
                        subject_properties[0]['property_address'] = cleaned_address
            else:
                # Handle object-style response
                subject_property = getattr(extracted_data, 'subject_property', None)
                
                if subject_property:
                    # Convert to dict if needed
                    if hasattr(subject_property, '__dict__'):
                        subject_property = subject_property.__dict__
                    elif hasattr(subject_property, 'dict'):
                        subject_property = subject_property.dict()
                    
                    # Clean the data before processing
                    subject_property = clean_extracted_property(subject_property)
                    subject_properties = [subject_property]
                    
                    print(f"✅ Successfully extracted and cleaned subject property")
                    print(f"   📍 Address: {subject_property.get('property_address', 'N/A')}")
                    print(f"   🏠 Type: {subject_property.get('property_type', 'N/A')}")
                    print(f"   🛏️  Bedrooms: {subject_property.get('number_bedrooms', 'N/A')}")
                    print(f"   🚿 Bathrooms: {subject_property.get('number_bathrooms', 'N/A')}")
                    print(f"   📐 Size: {subject_property.get('size_sqft', 'N/A')} sq ft")
                    
                    # Process images from LlamaExtract schema result
                    # Handle null values from LlamaExtract (null becomes None in Python)
                    property_images_data = subject_property.get('property_images') or []
                    if property_images_data is None:
                        property_images_data = []
                    primary_image = subject_property.get('primary_image')
                    
                    if property_images_data or primary_image:
                        print(f"🖼️ Processing {len(property_images_data)} images from extraction schema...")
                        
                        try:
                            from .services.image_extraction_service import ImageExtractionService
                            image_service = ImageExtractionService()
                            
                            processed_images = image_service.process_extraction_schema_images(
                                images_data=property_images_data,
                                primary_image=primary_image,
                                document_id=str(document_id),
                                business_id=business_id,
                                property_id=None  # Will be linked later
                            )
                            
                            # Add processed images to subject_property
                            subject_property['property_images'] = processed_images['images']
                            subject_property['image_count'] = processed_images['image_count']
                            subject_property['primary_image_url'] = processed_images['primary_image_url']
                            subject_property['image_metadata'] = {
                                'extraction_method': 'llamæxtract_schema',
                                'extraction_timestamp': datetime.utcnow().isoformat(),
                                'total_extracted': len(property_images_data),
                                'successful_uploads': processed_images['image_count']
                            }
                            
                            print(f"✅ Processed {processed_images['image_count']} images from extraction schema")
                        except Exception as e:
                            print(f"⚠️ Failed to process images from extraction schema: {e}")
                            import traceback
                            traceback.print_exc()
                            # Set defaults if processing fails
                            subject_property['property_images'] = []
                            subject_property['image_count'] = 0
                            subject_property['primary_image_url'] = None
                            subject_property['image_metadata'] = {}
                    else:
                        print("ℹ️ No images found in extraction schema result")
                        subject_property['property_images'] = []
                        subject_property['image_count'] = 0
                        subject_property['primary_image_url'] = None
                        subject_property['image_metadata'] = {}
                else:
                    print("   ❌ No subject property found in extraction results")
                    subject_properties = []
            
            print(f"Successfully extracted data for {len(subject_properties)} properties.")
            print(f"Successfully extracted {len(subject_properties)} properties from document.")
            
            # ========================================================================
            # PHASE 2: PROPERTY LINKING
            # ========================================================================
            
            print("=" * 80)
            print("🔗 STARTING PROPERTY LINKING PHASE")
            print("=" * 80)
            
            from .services.address_service import AddressNormalizationService
            import asyncio
            
            address_service = AddressNormalizationService()
            
            # Step 1: Determine which address to use (Priority: Filename > Content)
            property_address = None
            address_source = None
            subject_property = subject_properties[0] if subject_properties else None
            
            # Priority 1: Try to use filename address if available
            try:
                if document.metadata_json:
                    metadata = json.loads(document.metadata_json)
                    filename_address = metadata.get('filename_address')
                    
                    if filename_address:
                        property_address = filename_address
                        address_source = 'filename'
                        print(f"🎯 Using address from FILENAME: '{property_address}'")
                        print(f"   Confidence: {metadata.get('filename_address_confidence', 0.0):.2f}")
            except Exception as e:
                print(f"⚠️  Error parsing document metadata: {e}")
            
            # Priority 2: Use extracted subject property address if filename didn't have one
            if not property_address and subject_property:
                property_address = subject_property.get('property_address')
                if property_address:
                    address_source = 'extraction'
                    print(f"🎯 Using address from CONTENT EXTRACTION: '{property_address}'")
            
            # Step 2: Process address and link to property node
            if property_address:
                print(f"📍 Processing property linking for address: '{property_address}'")
                print(f"   Address source: {address_source}")
                
                try:
                    # Normalize address and compute hash
                    print(f"🔄 Normalizing address and geocoding...")
                    
                    normalized = address_service.normalize_address(property_address)
                    address_hash = address_service.compute_address_hash(normalized)
                    geocoding_result = address_service.geocode_address(property_address)
                    
                    address_data = {
                        'original_address': property_address,
                        'normalized_address': normalized,
                        'address_hash': address_hash,
                        'latitude': geocoding_result.get('latitude'),
                        'longitude': geocoding_result.get('longitude'),
                        'formatted_address': geocoding_result.get('formatted_address'),
                        'geocoding_status': geocoding_result.get('status'),
                        'geocoding_confidence': geocoding_result.get('confidence'),
                        'geocoder_used': geocoding_result.get('geocoder', 'none')
                    }
                    
                    print(f"✅ Address normalized:")
                    print(f"   Original: {address_data['original_address']}")
                    print(f"   Normalized: {address_data['normalized_address']}")
                    print(f"   Hash: {address_data['address_hash'][:16]}...")
                    print(f"   Geocoded: {address_data.get('formatted_address', 'N/A')}")
                    print(f"   Coordinates: ({address_data.get('latitude', 'N/A')}, {address_data.get('longitude', 'N/A')})")
                    
                    # Create property hub using new Property Hub Service
                    print(f"🔄 Creating property hub with new service...")
                    try:
                        from .services.supabase_property_hub_service import SupabasePropertyHubService
                        property_hub_service = SupabasePropertyHubService()
                        
                        # Validate required data before processing
                        if not address_data.get('original_address'):
                            print("❌ No address data available for property creation")
                            print("   Document will be processed without property association")
                            return
                        
                        if not business_id:
                            print("❌ No business ID provided for property creation")
                            print("   Document will be processed without property association")
                            return
                        
                        # Prepare extracted data for the service
                        extracted_data = subject_properties[0] if subject_properties else {}
                        
                        print(f"   📍 Address: {address_data.get('original_address', 'N/A')}")
                        print(f"   🏢 Business: {business_id}")
                        print(f"   📄 Document: {document_id}")
                        print(f"   🏠 Extracted data: {len(extracted_data)} fields")
                        
                        # Create complete property hub with enhanced error handling
                        hub_result = property_hub_service.create_property_with_relationships(
                            address_data=address_data,
                            document_id=str(document_id),
                            business_id=business_id,
                            extracted_data=extracted_data
                        )
                        
                        if hub_result['success']:
                            print(f"✅ Property hub created successfully: {hub_result['property_id']}")
                            print(f"   Property: {hub_result.get('property', {}).get('id', 'N/A')}")
                            print(f"   Relationship: {hub_result.get('relationship', {}).get('id', 'N/A')}")
                            print(f"   Property Details: {'✅' if hub_result.get('property_details') else '❌'}")
                            print(f"   Comparable Data: {'✅' if hub_result.get('comparable_data') else '❌'}")
                        else:
                            error_msg = hub_result.get('error', 'Unknown error')
                            print(f"❌ Failed to create property hub: {error_msg}")
                            
                            # Log detailed error information
                            if 'duplicate key' in str(error_msg).lower():
                                print("   💡 This appears to be a duplicate property - this is expected behavior")
                                print("   📝 Document will be processed without creating new property")
                            elif 'foreign key' in str(error_msg).lower():
                                print("   💡 This appears to be a foreign key constraint issue")
                                print("   📝 Check if document exists in Supabase")
                            else:
                                print("   💡 Unknown error - check logs for details")
                            
                            # Don't return here - continue processing without property association
                            print("   ⚠️  Continuing document processing without property association")
                            
                    except ImportError as e:
                        print(f"❌ Import error for Property Hub Service: {e}")
                        print("   📝 Check if supabase_property_hub_service.py exists and is properly configured")
                        print("   ⚠️  Continuing document processing without property association")
                    except Exception as e:
                        print(f"❌ Unexpected error creating property hub: {e}")
                        print(f"   Error type: {type(e).__name__}")
                        import traceback
                        traceback.print_exc()
                        print("   ⚠️  Continuing document processing without property association")
                    
                    # Only show success message if property hub was created successfully
                    if 'hub_result' in locals() and hub_result.get('success'):
                        print(f"✅ Document linked to property successfully")
                        print(f"   Property ID: {hub_result['property_id']}")
                        print(f"   Property Address: {address_data['formatted_address']}")
                        print(f"   Relationship created: {hub_result['relationship']['id']}")
                    else:
                        print(f"⚠️  Document processed without property association")
                        print(f"   Address: {address_data.get('formatted_address', 'N/A')}")
                        print(f"   Reason: Property hub creation failed or skipped")
                    
                except Exception as e:
                    print(f"❌ Error in property linking: {e}")
                    import traceback
                    traceback.print_exc()
            
            else:
                print("⚠️  No property address found - skipping property linking")
                print("   Document will be processed without property association")
            
                print("=" * 80)
                print("🔄 Property linking completed")
                print("=" * 80)

            # --- 4. Images are now extracted via LlamaExtract schema ---
            # Images have already been processed in Phase 2 (after subject_property extraction)
            # No additional image extraction needed
            
            property_uuids = [uuid.uuid4() for _ in subject_properties]
            property_image_mapping = {}
            unassigned_image_paths = []

            # --- 5. Store structured data in Supabase ---
            print("Storing structured data in Supabase...")
            
            # Get geocoding results for all properties (reuse from parallel processing)
            addresses = [prop.get('property_address', '') for prop in subject_properties]
            geocoding_results = geocode_address_parallel(addresses, max_workers=3)
            geocoding_map = {addr: result for addr, result in geocoding_results}
            
            # Add debug logging before Supabase storage
            print(f"🔍 DEBUG: About to store in Supabase:")
            print(f"   subject_properties count: {len(subject_properties)}")
            if subject_properties:
                print(f"   First property address: {subject_properties[0].get('property_address', 'N/A')}")
                print(f"   First property type: {subject_properties[0].get('property_type', 'N/A')}")
            print(f"   property_uuids: {property_uuids}")
            print(f"   business_id: {business_id}")
            print(f"   document_id: {document_id}")
            
            # Store in Supabase - use correct key for the storage function
            supabase_success = store_extracted_properties_in_supabase(
                {"subject_property": subject_properties[0] if subject_properties else None}, 
                        business_id,
                document_id, 
                property_uuids, 
                geocoding_map
            )
            
            print(f"📊 Storage Results:")
            print(f"   Supabase: {'✅ Success' if supabase_success else '❌ Failed'}")
            print(f"   Subject Property UUIDs captured: {[str(uuid) for uuid in property_uuids]}")


            # --- 7. Vector Processing with Supabase pgvector ---
            print("🔄 Starting document vector embedding...")
            
            try:
                from .services.vector_service import SupabaseVectorService
                vector_service = SupabaseVectorService()
                
                # Process document chunks with minimal logging
                document_vectors_stored = 0
                for i, doc in enumerate(parsed_docs):
                    try:
                        # Chunk the document text
                        chunks = vector_service.chunk_text(doc.text, chunk_size=512, overlap=50)
                        
                        # Prepare metadata
                        metadata = {
                            'business_id': business_id,
                            'document_id': str(document_id),
                            'property_id': str(property_uuids[0]) if property_uuids else None,
                            'classification_type': 'valuation_report',  # Default for now
                            'address_hash': None  # Will be set if available
                        }
                        
                        # Store document vectors
                        success = vector_service.store_document_vectors(
                            str(document_id), 
                            chunks, 
                            metadata
                        )
                        
                        if success:
                            document_vectors_stored += len(chunks)
                            
                    except Exception as e:
                        continue
                
                print(f"✅ Document vector embedding completed: {document_vectors_stored} vectors stored")
                
            except Exception as e:
                print(f"❌ Vector service failed: {e}")
                import traceback
                traceback.print_exc()
                print("⚠️ Continuing without vector storage...")

            # --- 8. Property Vector Store Processing with Supabase ---
            print("🔄 Starting property vector embedding...")
            try:
                from .services.vector_service import SupabaseVectorService
                vector_service = SupabaseVectorService()
                
                property_vectors_stored = 0
                for i, (prop, property_uuid) in enumerate(zip(subject_properties, property_uuids), 1):
                    try:
                        # Use the already computed geocoding result from parallel processing
                        address = prop.get('property_address', '')
                        geocoding_result = geocoding_map.get(address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "not_found"})
                        
                        # Create property document
                        property_document = create_property_document(prop, geocoding_result)
                        
                        # Prepare metadata for property vector
                        metadata = {
                            'business_id': business_id,
                            'property_id': str(property_uuid),
                            'property_address': prop.get('property_address', ''),
                            'address_hash': None,  # Will be computed if needed
                            'source_document_id': str(document_id),
                            'latitude': geocoding_result.get('latitude'),
                            'longitude': geocoding_result.get('longitude'),
                            'geocoded_address': geocoding_result.get('geocoded_address'),
                            'geocoding_confidence': geocoding_result.get('confidence'),
                            'geocoding_status': geocoding_result.get('status'),
                            'asking_price': prop.get('asking_price'),
                            'sold_price': prop.get('sold_price'),
                            'rent_pcm': prop.get('rent_pcm'),
                            'size_sqft': prop.get('size_sqft'),
                            'number_bedrooms': prop.get('number_bedrooms'),
                            'number_bathrooms': prop.get('number_bathrooms'),
                            'transaction_date': prop.get('transaction_date'),
                            'sold_date': prop.get('sold_date'),
                            'rented_date': prop.get('rented_date'),
                            'leased_date': prop.get('leased_date')
                        }
                        
                        # Store property vectors
                        success = vector_service.store_property_vectors(
                            str(property_uuid),
                            property_document,
                            metadata
                        )
                        
                        if success:
                            property_vectors_stored += 1
                        
                    except Exception as e:
                        continue
                
                print(f"✅ Property vector embedding completed: {property_vectors_stored}/{len(subject_properties)} properties stored")
                    
            except Exception as e:
                print(f"❌ Property vector service failed: {e}")
                import traceback
                traceback.print_exc()
                print("⚠️ Continuing without property vector storage...")

            # Check if document still exists before updating status
            document = Document.query.get(document_id)
            if document:
                document.status = DocumentStatus.COMPLETED
                db.session.commit()
                
                # Sync completion to Supabase
                sync_document_to_supabase(document_id, 'completed')
                
                print(f"Document processing completed for document_id: {document_id}")
            else:
                print(f"Document {document_id} no longer exists - processing completed but document was deleted")

        except Exception as e:
            print(f"Error processing document {document_id}: {e}", file=sys.stderr)
            try:
                # Check if document still exists before updating status
                document = Document.query.get(document_id)
                if document:
                    document.status = DocumentStatus.FAILED
                    db.session.commit()
                    print(f"Updated document status to FAILED for document_id: {document_id}")
                else:
                    print(f"Document {document_id} no longer exists - skipping status update")
            except Exception as status_error:
                print(f"Error updating document status: {status_error}", file=sys.stderr)
                db.session.rollback()
        
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                print("Cleanup of temporary files completed.") 

# is_property_photo_adaptive function removed - now using ImageExtractionService._is_property_photo_adaptive


# extract_property_images_from_multiple_documents function removed - now using ImageExtractionService


# classify_image_type function removed - now using ImageExtractionService._classify_image_type


# extract_images_from_markdown function removed - now using ImageExtractionService._extract_images_from_markdown


# extract_images_from_document_enhanced function removed - now using ImageExtractionService.extract_images

@shared_task(bind=True)
def process_document_simple(self, document_id, file_content, original_filename, business_id):
    """
    Simplified document processing that focuses on basic functionality
    without heavy AI processing to avoid memory issues
    """
    from . import create_app
    from .models import db, Document, DocumentStatus
    
    app = create_app()
    
    with app.app_context():
        document = Document.query.get(document_id)
        if not document:
            print(f"Document with id {document_id} not found.")
            return

        try:
            print(f"Starting simplified processing for document_id: {document_id}")
            document.status = DocumentStatus.PROCESSING
            db.session.commit()
            
            # Basic processing - just store the file info and mark as completed
            print(f"Processing document: {original_filename}")
            print(f"File size: {len(file_content)} bytes")
            print(f"Business ID: {business_id}")
            
            # Simulate some processing time
            import time
            time.sleep(2)
            
            # Update document status to completed
            document.status = DocumentStatus.COMPLETED
            db.session.commit()
            
            print(f"✅ Simplified document processing completed for document_id: {document_id}")
            return "Document processed successfully"
            
        except Exception as e:
            print(f"❌ Error in simplified document processing: {e}")
            try:
                document.status = DocumentStatus.FAILED
                db.session.commit()
            except:
                pass
            return f"Error: {e}"

@shared_task(bind=True)
def process_document_task(self, document_id, file_content, original_filename, business_id):
    """
    Main document processing task that starts with classification
    """
    return process_document_classification.delay(document_id, file_content, original_filename, business_id)


def get_s3_client():
    """Get S3 client with AWS credentials"""
    return boto3.client(
        's3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
    )

# AstraDB tabular storage function removed - using Supabase only

def store_extracted_properties_in_supabase(extracted_data, business_id, document_id, property_uuids, geocoding_map=None):
    """Store extracted properties using the new Property Hub Service"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        property_hub_service = SupabasePropertyHubService()
        
        # Handle both old and new schema formats
        properties = []
        if extracted_data:
            if "subject_property" in extracted_data:
                # New Velora agent format
                subject_prop = extracted_data["subject_property"]
                if subject_prop:
                    properties = [subject_prop]
                    logger.info("✅ Found subject property in new Velora format")
            elif "subject_properties" in extracted_data:
                # Transitional format
                properties = extracted_data["subject_properties"]
                logger.info("✅ Found properties in subject_properties format")
            elif "all_properties" in extracted_data:
                # Legacy format
                properties = extracted_data["all_properties"]
                logger.info("✅ Found properties in legacy format")
            else:
                logger.warning("❌ No properties found in any format")
                return True  # Not an error, just no data to store
        
        if not properties:
            logger.warning("No valid property records to store")
            return True
        
        # Use the new property hub service for each property
        results = []
        for i, prop in enumerate(properties):
            try:
                # Prepare address data from geocoding map
                address = prop.get('property_address', '')
                geocoding_result = geocoding_map.get(address, {}) if geocoding_map else {}
                
                address_data = {
                    'original_address': address,
                    'normalized_address': geocoding_result.get('normalized_address', address),
                    'address_hash': geocoding_result.get('address_hash', f'hash_{address}'),
                    'formatted_address': geocoding_result.get('formatted_address', address),
                    'latitude': geocoding_result.get('latitude'),
                    'longitude': geocoding_result.get('longitude'),
                    'geocoding_status': geocoding_result.get('status', 'unknown'),
                    'geocoding_confidence': geocoding_result.get('confidence', 0.0),
                    'address_source': 'extraction'
                }
                
                # Create property hub using the service
                hub_result = property_hub_service.create_property_with_relationships(
                    address_data=address_data,
                    document_id=str(document_id),
                    business_id=business_id,
                    extracted_data=prop
                )
                
                if hub_result['success']:
                    results.append(hub_result)
                    logger.info(f"✅ Property hub {i+1} created: {hub_result['property_id']}")
                else:
                    logger.error(f"❌ Failed to create property hub {i+1}: {hub_result.get('error')}")
                    
            except Exception as e:
                logger.error(f"Error processing property {i+1}: {e}")
                continue
        
        if results:
            logger.info(f"✅ Stored {len(results)} property hubs using new service")
            return True
        else:
            logger.error("❌ Failed to store any property hubs")
            return False
            
    except Exception as e:
        logger.error(f"Error in store_extracted_properties_in_supabase: {e}")
        return False

