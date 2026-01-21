import os
import boto3
from celery import shared_task
import time
from .models import db, Document, DocumentStatus
from typing import List, Optional
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
from uuid import UUID

# Reducto imports
from .services.reducto_service import ReductoService
from .services.reducto_image_service import ReductoImageService
from .services.extraction_schemas import SUBJECT_PROPERTY_EXTRACTION_SCHEMA

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def convert_confidence_to_numeric(confidence_str: str) -> float:
    """Convert Reducto string confidence to numeric for compatibility"""
    confidence_map = {'high': 0.9, 'medium': 0.7, 'low': 0.5}
    return confidence_map.get(confidence_str, 0.7)

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

# ============================================================================
# HELPER FUNCTIONS FOR OPTIMIZATION (Phase 1: Eliminate Duplicate Code)
# ============================================================================

def get_document_summary_safe(document: dict) -> dict:
    """
    Safely extract and parse document_summary from document dict.
    Handles None, string JSON, and dict cases.
    
    This function eliminates duplicate code used 9+ times throughout tasks.py.
    
    Args:
        document: Document dict from Supabase
    
    Returns:
        document_summary dict (never None)
    """
    document_summary = document.get('document_summary') or {}
    if isinstance(document_summary, str):
        try:
            document_summary = json.loads(document_summary)
        except:
            document_summary = {}
    if document_summary is None:
        document_summary = {}
    return document_summary

def get_job_id_with_retry(doc_storage, document_id: str, business_id: str, max_retries: int = 5, retry_delay: float = 1.0) -> Optional[str]:
    """
    Retrieve job_id from document_summary with exponential backoff retry.
    
    Enhanced with commit verification and detailed logging to debug job_id retrieval.
    Prevents race condition where extraction task starts before classification
    commits document_summary to Supabase.
    
    Args:
        doc_storage: DocumentStorageService instance
        document_id: Document UUID
        business_id: Business UUID
        max_retries: Maximum retry attempts (default: 5, increased from 3)
        retry_delay: Initial delay in seconds for exponential backoff (default: 1.0)
    
    Returns:
        job_id string or None if not found after retries
    """
    import time
    last_document_summary = None
    
    logger.info(f"🔍 Attempting to retrieve job_id for document {document_id}...")
    
    for attempt in range(max_retries):
        success, document, error = doc_storage.get_document(str(document_id), business_id)
        
        if success and document:
            document_summary = get_document_summary_safe(document)
            
            # Check if document_summary has changed (indicates commit happened)
            if document_summary != last_document_summary:
                logger.info(f"📝 Document summary changed on attempt {attempt + 1}, commit detected")
                last_document_summary = document_summary.copy()
            
            # Log document_summary keys for debugging (only on first attempt or when changed)
            if attempt == 0 or document_summary != last_document_summary:
                if document_summary and isinstance(document_summary, dict):
                    summary_keys = list(document_summary.keys())
                    logger.debug(f"📋 Document summary keys on attempt {attempt + 1}: {summary_keys}")
            
            if document_summary and isinstance(document_summary, dict):
                job_id = document_summary.get('reducto_job_id')
            else:
                job_id = None
            
            # Validate job_id is not empty string
            if job_id and isinstance(job_id, str) and job_id.strip():
                logger.info(f"✅ Retrieved job_id on attempt {attempt + 1}: {job_id}")
                return job_id.strip()
            elif job_id:
                logger.warning(f"⚠️ job_id found but invalid (empty or wrong type): {type(job_id)} = {job_id}")
            else:
                logger.debug(f"🔑 'reducto_job_id' not found in document_summary on attempt {attempt + 1}")
        
        if attempt < max_retries - 1:
            wait_time = retry_delay * (2 ** attempt)  # Exponential backoff: 1s, 2s, 4s, 8s, 16s
            logger.warning(f"⚠️ job_id not found on attempt {attempt + 1}, retrying in {wait_time}s...")
            time.sleep(wait_time)
    
    logger.error(f"❌ Failed to retrieve job_id after {max_retries} attempts")
    if success and document:
        final_summary = get_document_summary_safe(document)
        # Only log keys to avoid massive JSON dumps in terminal
        logger.error(f"📋 Final document_summary keys: {list(final_summary.keys())}")
        # Removed full content logging to reduce terminal noise
    return None

def extract_page_number_from_chunk(chunk: dict) -> Optional[int]:
    """
    Extract page number from chunk metadata with multiple fallback strategies.
    
    Per Reducto's recommendation: Use original_page for referencing source document pages.
    
    Args:
        chunk: Chunk dict from Reducto with bbox and blocks
    
    Returns:
        Page number (int) or None if not found
    """
    # Strategy 1: Chunk-level bbox - PREFER original_page per Reducto recommendation
    chunk_bbox = chunk.get('bbox')
    if chunk_bbox:
        if isinstance(chunk_bbox, dict):
            # Reducto recommends using original_page for source document references
            page = chunk_bbox.get('original_page') or chunk_bbox.get('page')
            if page is not None:
                try:
                    return int(page)
                except (ValueError, TypeError):
                    pass
    
    # Strategy 2: First block's bbox - PREFER original_page
    blocks = chunk.get('blocks', [])
    if blocks:
        first_block = blocks[0]
        block_bbox = first_block.get('bbox') if isinstance(first_block, dict) else None
        if block_bbox and isinstance(block_bbox, dict):
            # Prefer original_page for source document references
            page = block_bbox.get('original_page') or block_bbox.get('page')
            if page is not None:
                try:
                    return int(page)
                except (ValueError, TypeError):
                    pass
    
    # Strategy 3: Most common page in blocks (for multi-page chunks) - PREFER original_page
    if blocks:
        page_counts = {}
        for block in blocks:
            if isinstance(block, dict):
                block_bbox = block.get('bbox')
                if block_bbox and isinstance(block_bbox, dict):
                    # Prefer original_page for source document references
                    page = block_bbox.get('original_page') or block_bbox.get('page')
                    if page is not None:
                        try:
                            page = int(page)
                            page_counts[page] = page_counts.get(page, 0) + 1
                        except (ValueError, TypeError):
                            pass
        
        if page_counts:
            # Return most common page
            return max(page_counts, key=page_counts.get)
    
    return None  # No page number found

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

# Removed _check_llamaextract_api() - no longer needed with Reducto-only approach

def _fallback_text_extraction(document_text: str, filename: str) -> dict:
    """Fallback text-based extraction when Reducto extraction fails"""
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

# Removed duplicate _fallback_text_extraction function - using single version above

def clean_extracted_property(property_data):
    """Clean extracted data to ensure proper data types"""
    cleaned = {}
    
    # Helper to extract value from Reducto dict structure
    def extract_value(val):
        """Extract value from Reducto response structure"""
        if isinstance(val, dict) and 'value' in val:
            return val['value']
        return val
    
    # Clean numeric fields
    numeric_fields = ['number_bedrooms', 'number_bathrooms', 'size_sqft', 'asking_price', 'sold_price', 'rent_pcm', 'price_per_sqft', 'yield_percentage', 'appraised_value']
    for field in numeric_fields:
        value = property_data.get(field)
        if value is not None:
            # Extract value from dict if needed
            value = extract_value(value)
            
            # Extract first number from strings like "5 (all en-suites)"
            import re
            if isinstance(value, str):
                match = re.search(r'(\d+(?:\.\d+)?)', value)
                if field in ['number_bedrooms', 'number_bathrooms']:
                    cleaned[field] = int(match.group(1)) if match else None
                else:
                    cleaned[field] = float(match.group(1)) if match else None
            elif isinstance(value, (int, float)):
                # Ensure bedrooms/bathrooms are integers
                if field in ['number_bedrooms', 'number_bathrooms']:
                    cleaned[field] = int(value)
                else:
                    cleaned[field] = float(value)
            else:
                cleaned[field] = value
        else:
            cleaned[field] = None
    
    # Copy other fields as-is, extracting values from dicts
    for key, value in property_data.items():
        if key not in numeric_fields:
            # Extract value from Reducto dict structure if needed
            cleaned[key] = extract_value(value)
    
    return cleaned


# Removed extract_images_from_document function - now using ReductoImageService directly


@shared_task(bind=True)
def process_document_classification(self, document_id, file_content, original_filename, business_id):
    """
    Step 1: Document Classification with Event Logging
    """
    from . import create_app
    from .models import db, Document, DocumentStatus
    from .services.processing_history_service import ProcessingHistoryService
    from .services.filename_address_service import FilenameAddressService
    from .services.document_storage_service import DocumentStorageService
    import tempfile
    import os
    
    app = create_app()
    
    with app.app_context():
        # Fetch document from Supabase (not local PostgreSQL)
        doc_storage = DocumentStorageService()
        success, document_dict, error = doc_storage.get_document(str(document_id), business_id)
        
        if not success or not document_dict:
            logger.error(f"Document with id {document_id} not found in Supabase. Error: {error}")
            return {"error": f"Document not found: {error}"}
        
        logger.info(f"✅ Retrieved document {document_id} from Supabase")
        
        # Store document_dict for later use (will replace document.attribute with document_dict['attribute'] in Phase 2)
        document = document_dict
        
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
                
                # Store filename address in document metadata (Supabase document_summary JSONB)
                # Use helper function to safely parse document_summary
                document_summary = get_document_summary_safe(document)
                
                document_summary['filename_address'] = filename_address
                document_summary['filename_address_confidence'] = filename_confidence
                document_summary['address_source'] = 'filename'
                
                # Update document in Supabase
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status=document.get('status', 'uploaded'),  # Keep current status
                    business_id=business_id,
                    additional_data={'document_summary': document_summary}
                )
                logger.info(f"✅ Saved filename address to document metadata in Supabase")
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
            
            # Update document status to processing in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='processing',
                business_id=business_id
            )
            logger.info(f"✅ Updated document status to 'processing' in Supabase")
            
            # Save file temporarily for parsing
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            # Initialize classification_result to None to handle error cases
            classification_result = None
            
            try:
                # REDUCTO PATH: Parse and classify using Reducto (section-based chunking)
                logger.info(f"Using Reducto for parsing and classification (section-based chunking): {original_filename}")
                from .services.reducto_service import ReductoService
                
                reducto = ReductoService()
                
                # Parse document - use async for large files (> 1MB)
                # Now uses section-based chunking to maintain document structure
                file_size_mb = len(file_content) / (1024 * 1024)
                use_async = file_size_mb > 1.0  # Use async for files > 1MB
                
                if use_async:
                    logger.info(f"📦 Large file detected ({file_size_mb:.2f}MB), using async processing")
                
                parse_result = reducto.parse_document(
                    file_path=temp_file_path,
                    return_images=["figure", "table"],
                    use_async=use_async
                )
                
                job_id = parse_result['job_id']
                document_text = parse_result['document_text']
                image_urls = parse_result['image_urls']
                chunks = parse_result.get('chunks', [])
                image_blocks_metadata = parse_result.get('image_blocks_metadata', [])
                
                logger.info(f"✅ Reducto Parse completed (section-based chunking). Job ID: {job_id}")
                logger.info(f"📄 Extracted {len(document_text)} characters of text")
                logger.info(f"📸 Found {len(image_urls)} images")
                logger.info(f"📦 Extracted {len(chunks)} section-based chunks")
                
                # Calculate total blocks count
                total_blocks = sum(len(chunk.get('blocks', [])) for chunk in chunks)
                chunks_with_blocks = sum(1 for chunk in chunks if chunk.get('blocks'))
                logger.info(f"📊 Chunk details: {chunks_with_blocks}/{len(chunks)} chunks have blocks, {total_blocks} total blocks")
                
                # Log to processing history
                try:
                    history_service.log_step_completion(
                        history_id=history_id,
                        step_message=f"Parsing completed: {len(chunks)} chunks, {total_blocks} blocks",
                        step_metadata={
                            'reducto_job_id': job_id,
                            'chunks_count': len(chunks),
                            'chunks_with_blocks': chunks_with_blocks,
                            'total_blocks': total_blocks,
                            'text_length': len(document_text),
                            'images_count': len(image_urls)
                        }
                    )
                except Exception as log_error:
                    logger.warning(f"⚠️ Failed to log parsing completion: {log_error}")
                
                # Store job_id and image URLs in metadata (Supabase document_summary JSONB)
                # Use helper function to safely parse document_summary
                document_summary = get_document_summary_safe(document)
                
                document_summary['reducto_job_id'] = job_id
                document_summary['reducto_parse_timestamp'] = datetime.utcnow().isoformat()
                document_summary['reducto_image_urls'] = image_urls
                document_summary['reducto_image_blocks_metadata'] = image_blocks_metadata
                if chunks:
                    # Store FULL chunks structure with bbox metadata for later retrieval
                    # This ensures bbox data is available even if Reducto job_id expires
                    chunks_data = []
                    for chunk in chunks:
                        chunks_data.append({
                            'content': chunk.get('content', ''),
                            'embed': chunk.get('embed', ''),
                            'enriched': chunk.get('enriched'),
                            'bbox': chunk.get('bbox'),
                            'blocks': chunk.get('blocks', [])
                        })
                    document_summary['reducto_chunks'] = chunks_data
                    document_summary['reducto_chunk_count'] = len(chunks)
                    logger.info(f"✅ Stored {len(chunks_data)} chunks with bbox metadata in document metadata")
                
                # Store parsed text and metadata in Supabase
                doc_storage.update_document_extraction(
                    document_id=str(document_id),
                    parsed_text=document_text,
                    extracted_json={},  # Will be populated later in extraction step
                    business_id=business_id
                )
                
                # Update document_summary using dedicated method with proper JSONB merging
                # This ensures job_id, chunks, and other metadata are preserved
                doc_storage.update_document_summary(
                    document_id=str(document_id),
                    business_id=business_id,
                    updates={
                        'reducto_job_id': job_id,
                        'reducto_parse_timestamp': datetime.utcnow().isoformat(),
                        'reducto_image_urls': image_urls,
                        'reducto_image_blocks_metadata': image_blocks_metadata,
                        'reducto_chunks': chunks_data if chunks else [],
                        'reducto_chunk_count': len(chunks) if chunks else 0
                    },
                    merge=True  # Merge with existing document_summary to preserve other fields
                )
                
                # Also update status (separate call)
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='processing',  # Keep processing status
                    business_id=business_id
                )
                logger.info(f"✅ Stored parsed text and metadata in Supabase")
                
                # Phase 5: REMOVED duplicate vector creation from classification step
                # Vector creation now happens in extraction step with proper metadata:
                # - property_id (from property linking)
                # - classification_type (from classification)
                # - address_hash (from extraction)
                # This eliminates duplicate embeddings and ensures metadata is complete.
                
                # Classify using Reducto Extract
                classification = reducto.classify_document(job_id)
                
                # Convert string confidence to numeric for compatibility
                confidence_numeric = convert_confidence_to_numeric(classification['confidence'])
                
                classification_result = {
                    'type': classification['document_type'],
                    'confidence': confidence_numeric,
                    'reasoning': f"Reducto classification: {classification['document_type']} (confidence: {classification['confidence']})",
                    'method': 'reducto_extract'
                }
                
                # parsed_text and job_id already stored above via update_document_summary
                # Just ensure classification metadata is also stored
                # Note: reducto_job_id was already stored in update_document_summary call above (line 819-831)
                doc_storage.update_document_summary(
                    document_id=str(document_id),
                    business_id=business_id,
                    updates={
                        'reducto_parsed_text': document_text,  # backup
                        'reducto_image_urls': image_urls,
                    },
                    merge=True  # Merge to preserve reducto_job_id and other fields
                )
                if image_blocks_metadata:
                    doc_storage.update_document_summary(
                    document_id=str(document_id),
                    business_id=business_id,
                        updates={'reducto_image_blocks_metadata': image_blocks_metadata},
                        merge=True
                )
                
                # Log text extraction success (non-fatal if history_id is None)
                if history_id:
                    history_service.log_step_completion(
                        history_id=history_id,
                        step_message=f"Text extraction completed: {len(document_text)} characters",
                        step_metadata={
                            'text_length': len(document_text),
                            'provider': 'reducto'
                        }
                    )
                
            except Exception as e:
                logger.error(f"❌ Reducto parsing/extraction failed: {e}")
                logger.error(f"   Document ID: {document_id}")
                logger.error(f"   Filename: {original_filename}")
                logger.error(f"   File size: {len(file_content)} bytes")
                logger.error(f"   Error type: {type(e).__name__}")
                import traceback
                logger.error(f"   Traceback: {traceback.format_exc()}")
                
                # Use fallback text extraction
                document_text = f"Document: {original_filename}\nSize: {len(file_content)} bytes"
                # Store fallback text in Supabase
                doc_storage.update_document_extraction(
                    document_id=str(document_id),
                    parsed_text=document_text,
                    extracted_json={},
                    business_id=business_id
                )
                
                # Log text extraction with fallback (non-fatal if history_id is None)
                if history_id:
                    history_service.log_step_completion(
                        history_id=history_id,
                        step_message=f"Text extraction completed with fallback: {len(document_text)} characters",
                        step_metadata={
                            'text_length': len(document_text),
                            'fallback_used': True,
                            'extraction_error': str(e),
                            'error_type': type(e).__name__,
                            'provider': 'reducto'
                        }
                    )
            
                # If Reducto failed, we still need classification_result for error handling
                if classification_result is None:
                    raise  # Re-raise the exception since we can't continue without classification
            
            # Verify classification_result is set before using it
            if classification_result is None:
                raise ValueError("Classification failed: classification_result is None")
            
            # Store classification results in Supabase
            doc_storage.update_document_classification(
                document_id=str(document_id),
                classification_type=classification_result['type'],
                classification_confidence=classification_result['confidence'],
                business_id=business_id
            )
            
            # Update status to completed
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='completed',
                business_id=business_id,
                additional_data={
                    'classification_timestamp': datetime.utcnow().isoformat()
                }
            )
            logger.info(f"✅ Updated classification and status in Supabase: {document_id}")
            
            # Log classification completion (non-fatal if history_id is None)
            if history_id:
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
            
            # Get job_id from classification parse result to pass directly to extraction
            # This avoids read-after-write consistency issues
            # Use the job_id from the parse_result that was just stored (line 770)
            job_id_for_extraction = None
            try:
                # The job_id is already in memory from the parse_result above (line 770)
                # Use it directly instead of reading from database
                if 'job_id' in locals() and job_id:
                    job_id_for_extraction = job_id
                    logger.info(f"✅ Using job_id from classification parse: {job_id_for_extraction}")
                else:
                    # Fallback: try to get from document_summary (may not be committed yet)
                    document_summary = get_document_summary_safe(document)
                    job_id_for_extraction = document_summary.get('reducto_job_id')
                    if job_id_for_extraction:
                        logger.info(f"✅ Retrieved job_id from document_summary: {job_id_for_extraction}")
            except Exception as e:
                logger.warning(f"⚠️ Could not retrieve job_id from classification: {e}")
            
            # Brief wait for Supabase replication (reduced since we're passing job_id directly)
            time.sleep(1.0)  # Reduced from 2.0s since we're passing job_id directly
            logger.info(f"⏳ Waited 1.0s for Supabase replication before triggering extraction")
            
            # Trigger appropriate extraction pipeline based on classification
            if classification_result['type'] in ['valuation_report', 'market_appraisal']:
                logger.info(f"🎯 CLASSIFICATION COMPLETE: {classification_result['type']}")
                logger.info(f"🔄 TRIGGERING FULL EXTRACTION: process_document_with_dual_stores")
                logger.info(f"   Document ID: {document_id}")
                logger.info(f"   Business ID: {business_id}")
                logger.info(f"   Filename: {original_filename}")
                if job_id_for_extraction:
                    logger.info(f"   Job ID: {job_id_for_extraction} (passed directly)")
                
                task = process_document_with_dual_stores.delay(
                    document_id=document_id,
                    file_content=file_content,
                    original_filename=original_filename,
                    business_id=business_id,
                    job_id=job_id_for_extraction  # ✅ Pass job_id directly
                )
                
                logger.info(f"✅ EXTRACTION TASK QUEUED: {task.id}")
                return task
            else:
                logger.info(f"🎯 CLASSIFICATION COMPLETE: {classification_result['type']}")
                logger.info(f"🔄 TRIGGERING MINIMAL EXTRACTION: process_document_minimal_extraction")
                if job_id_for_extraction:
                    logger.info(f"   Job ID: {job_id_for_extraction} (passed directly)")
                
                task = process_document_minimal_extraction.delay(
                    document_id=document_id,
                    file_content=file_content,
                    original_filename=original_filename,
                    business_id=business_id,
                    job_id=job_id_for_extraction  # ✅ Pass job_id directly
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
                # Update status to failed in Supabase
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='failed',
                    business_id=business_id
                )
            except Exception as status_error:
                logger.error(f"Failed to update document status to failed: {status_error}")
            return {"error": str(e)}
        
        finally:
            # Clean up temporary file
            try:
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
            except:
                pass

@shared_task(bind=True)
def process_document_minimal_extraction(self, document_id, file_content, original_filename, business_id, job_id=None):
    """
    Minimal extraction pipeline for non-valuation documents.
    Only extracts basic property information if available, and document metadata.
    """
    from . import create_app
    from .models import db, Document, DocumentStatus
    from .services.processing_history_service import ProcessingHistoryService
    from .services.extraction_schemas import MINIMAL_EXTRACTION_SCHEMA
    from .services.document_storage_service import DocumentStorageService
    import tempfile
    import os

    app = create_app()

    with app.app_context():
        # Fetch document from Supabase (not local PostgreSQL)
        doc_storage = DocumentStorageService()
        success, document_dict, error = doc_storage.get_document(str(document_id), business_id)
        
        if not success or not document_dict:
            logger.error(f"Document with id {document_id} not found in Supabase. Error: {error}")
            return {'error': f'Document not found: {error}'}
        
        logger.info(f"✅ Retrieved document {document_id} from Supabase")
        document = document_dict  # document is now a dict from Supabase

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

            # update the document status in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='processing',
                business_id=business_id
            )

            # save file temporarily for parsing
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = temp_file.name
            
            # Initialize variables that might be needed in exception handler
            classification_type = document.get('classification_type') or 'other_documents'
            document_text = ""
            extracted_data = None
            
            try:
                # Get the appropriate schema based on document classification
                from .services.extraction_schemas import get_extraction_schema
                extraction_schema = get_extraction_schema(classification_type)
                
                logger.info(f"🎯 Using extraction schema for: {classification_type}")
                
                # REDUCTO PATH: Use Reducto for minimal extraction (section-based chunking)
                logger.info(f"🔄 Using Reducto for minimal extraction (section-based chunking): {original_filename}")
                from .services.reducto_service import ReductoService
                
                reducto = ReductoService()
                
                # Use job_id passed from classification task (avoids read-after-write consistency issues)
                # Fallback to database lookup if not provided
                document_text = document.get('parsed_text') or ""
                
                # Use job_id passed from classification task (avoids read-after-write consistency issues)
                if not job_id or not isinstance(job_id, str) or not job_id.strip():
                    # Fallback: Try to retrieve from database (with retry for race conditions)
                    logger.info(f"🔍 Job_id not provided, attempting to retrieve from database...")
                    document_summary = get_document_summary_safe(document)
                    job_id = get_job_id_with_retry(doc_storage, str(document_id), business_id, max_retries=3)
                else:
                    # Job_id was passed, use it directly
                    logger.info(f"✅ Using job_id passed from classification task: {job_id}")
                    document_summary = get_document_summary_safe(document)
                
                # Validate job_id before proceeding
                if job_id and isinstance(job_id, str) and job_id.strip():
                    job_id = job_id.strip()
                    logger.info(f"✅ Using job_id: {job_id}")
                else:
                    logger.error(f"❌ Invalid job_id: {job_id}. Cannot proceed with extraction without valid job_id.")
                    # If no job_id after retries, only then parse (shouldn't happen in normal flow)
                    logger.warning("⚠️ No job_id found, parsing document now (this should be rare)...")
                    file_size_mb = len(file_content) / (1024 * 1024)
                    use_async = file_size_mb > 1.0
                    
                    parse_result = reducto.parse_document(
                        file_path=temp_file_path,
                        return_images=["figure", "table"],
                        use_async=use_async
                    )
                    job_id = parse_result['job_id']
                    document_text = parse_result['document_text']
                    
                    # Store in document_summary (Supabase JSONB)
                    # Refresh document_summary after parse to ensure we have the latest
                    document_summary = get_document_summary_safe(document)
                    document_summary['reducto_job_id'] = job_id
                    
                    # Store parsed text and metadata in Supabase
                    doc_storage.update_document_extraction(
                        document_id=str(document_id),
                        parsed_text=document_text,
                        extracted_json={},
                        business_id=business_id
                    )
                    
                    # Update document_summary
                    doc_storage.update_document_status(
                        document_id=str(document_id),
                        status='processing',
                        business_id=business_id,
                        additional_data={'document_summary': document_summary}
                    )
                
                # Validate job_id before extraction (after potential re-parsing)
                if not job_id or not isinstance(job_id, str) or not job_id.strip():
                    logger.error(f"❌ Cannot extract: job_id is invalid: {job_id}")
                    raise ValueError(f"job_id must be a non-empty string, got: {type(job_id)} = {job_id}")
                        
                # Extract with schema using Reducto (uses jobid://{job_id} format internally)
                logger.info(f"🔄 Extracting minimal data with Reducto schema for: {classification_type} (job_id: {job_id})")
                extraction = reducto.extract_with_schema(
                    job_id=job_id,
                                schema=extraction_schema,
                    system_prompt="Extract minimal property information from this document."
                )
                
                extracted_data = extraction['data']
                logger.info("✅ Reducto minimal extraction completed successfully")
                    
            except Exception as e:
                logger.error(f"⚠️ Reducto extraction failed: {e}, using fallback")
                # Ensure document_text is available for fallback
                if not document_text:
                    document_text = document.get('parsed_text') or ""
                extracted_data = _fallback_text_extraction(document_text, original_filename)

            # Store extracted data in Supabase (for both success and failure cases)
            doc_storage.update_document_extraction(
                document_id=str(document_id),
                parsed_text=document_text,
                extracted_json=extracted_data,
                business_id=business_id
            )
            
            # Update status to completed in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='completed',
                business_id=business_id
            )

            # ========================================================================
            # PROPERTY LINKING FOR MINIMAL EXTRACTION (MOVED OUTSIDE EXCEPT BLOCK)
            # ========================================================================
                
            logger.info("🔗 Starting property linking for minimal extraction...")
                
            # Handle different extraction data formats
            extracted_properties = []
            
            # Check for subject_property format (used by letter_of_offer, other_documents, etc.)
            if extracted_data and 'subject_property' in extracted_data:
                # New format: subject_property object (used by OTHER_DOCUMENTS_EXTRACTION_SCHEMA)
                subject_prop = extracted_data['subject_property']
                if subject_prop and subject_prop.get('property_address'):
                    extracted_properties = [subject_prop]
                    logger.info(f"📍 Found subject property in subject_property format (classification: {classification_type})")
            elif extracted_data and 'properties' in extracted_data:
                # Legacy format: properties array (used by MINIMAL_EXTRACTION_SCHEMA)
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
                    
                    # Handle case where Reducto returns address as dict with 'value' key
                    if isinstance(property_address, dict):
                        property_address = property_address.get('value', '')
                    
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

            # ========================================================================
            # CHUNKING AND EMBEDDING FOR MINIMAL EXTRACTION
            # Same strategy as full extraction - use stored chunks or retrieve from Reducto
            # ========================================================================
            logger.info("🔄 Starting document vector embedding for minimal extraction...")
            
            document_vectors_stored = 0
            # Handle business_id that might be a company name (legacy) or UUID
            try:
                business_uuid = str(UUID(str(business_id))) if business_id else None
            except (ValueError, TypeError):
                # business_id is not a UUID (e.g., "SoloSway"), try to get UUID from mapping
                try:
                    from .services.supabase_auth_service import SupabaseAuthService
                    auth_service = SupabaseAuthService()
                    business_uuid = auth_service.get_business_uuid(business_id)
                    if not business_uuid:
                        business_uuid = auth_service.ensure_business_uuid(business_id)
                except Exception as lookup_error:
                    logger.warning(f"Failed to lookup business UUID: {lookup_error}")
                    business_uuid = None
            
            try:
                from .services.vector_service import SupabaseVectorService
                vector_service = SupabaseVectorService()
                
                # Get property_id from property linking if available
                property_id = None
                if extracted_properties:
                    # Try to get property_id from the first linked property
                    try:
                        from .services.supabase_property_hub_service import SupabasePropertyHubService
                        hub_service = SupabasePropertyHubService()
                        # Get relationship to find property_id
                        from .services.supabase_client_factory import get_supabase_client
                        supabase = get_supabase_client()
                        rel_result = supabase.table('document_relationships').select('property_id').eq(
                            'document_id', str(document_id)
                        ).limit(1).execute()
                        if rel_result.data and len(rel_result.data) > 0:
                            property_id = rel_result.data[0].get('property_id')
                    except Exception as e:
                        logger.warning(f"⚠️ Could not retrieve property_id: {e}")
                
                if document_text:
                    try:
                        # PRIORITY 1: Get chunks from stored document_summary (has bbox metadata)
                        reducto_chunks = None
                        chunk_metadata_list = None
                        
                        document_summary = get_document_summary_safe(document)
                        if document_summary:
                            try:
                                stored_chunks = document_summary.get('reducto_chunks', [])
                                if stored_chunks:
                                    reducto_chunks = stored_chunks
                                    logger.info(f"✅ Retrieved {len(reducto_chunks)} section-based chunks from stored metadata (with bbox)")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not parse stored chunks: {e}")
                        
                        # PRIORITY 2: Fallback to Reducto API if metadata doesn't have chunks
                        if not reducto_chunks and job_id:
                            try:
                                logger.info(f"🔄 Attempting to retrieve chunks from Reducto API (job_id may have expired)...")
                                parse_result = reducto.get_parse_result_from_job_id(
                                    job_id=job_id,
                                    return_images=["figure", "table"]
                                )
                                reducto_chunks = parse_result.get('chunks', [])
                                logger.info(f"✅ Retrieved {len(reducto_chunks)} section-based chunks from Reducto API")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not retrieve Reducto chunks from API: {e}")
                                logger.info(f"   This is expected if job_id has expired (>12 hours)")
                        
                        # Use Reducto chunks if available, otherwise chunk manually
                        if reducto_chunks:
                            # Extract chunk texts for embedding (use embed if available, fallback to content)
                            chunk_texts = []
                            chunk_metadata_list = []
                            chunks_filtered_count = 0
                            total_blocks_count = 0
                            
                            logger.info(f"🔄 Processing {len(reducto_chunks)} chunks for embedding...")
                            
                            for i, chunk in enumerate(reducto_chunks):
                                # Prefer embed (optimized for embeddings), fallback to content
                                embed_text = chunk.get('embed', '')
                                content_text = chunk.get('content', '')
                                
                                # Choose text to embed
                                text_to_embed = embed_text if embed_text else content_text
                                
                                # Track blocks
                                blocks = chunk.get('blocks', [])
                                total_blocks_count += len(blocks)
                                
                                # FALLBACK: If chunk has no embed/content, extract text from blocks
                                if not text_to_embed:
                                    if blocks:
                                        # Extract text from all blocks
                                        block_texts = []
                                        for block in blocks:
                                            if isinstance(block, dict):
                                                block_text = block.get('text', '') or block.get('content', '')
                                                if block_text:
                                                    block_texts.append(block_text)
                                        if block_texts:
                                            text_to_embed = ' '.join(block_texts)
                                            logger.info(f"✅ Extracted text from {len(block_texts)} blocks for chunk {i+1} (chunk had no embed/content)")
                                
                                if text_to_embed:
                                    chunk_texts.append(text_to_embed)
                                    
                                    # Extract chunk metadata with bbox
                                    chunk_bbox = chunk.get('bbox')
                                    # Use robust page number extraction
                                    chunk_page = extract_page_number_from_chunk(chunk)
                                    
                                    # NEW: Detect section header from chunk content
                                    from backend.llm.utils.section_header_detector import detect_section_header
                                    header_info = detect_section_header(content_text if content_text else text_to_embed)
                                    
                                    chunk_meta = {
                                        'bbox': chunk_bbox,  # Chunk-level bbox
                                        'blocks': blocks,  # All blocks with bbox
                                        'page': chunk_page  # Robustly extracted page number
                                    }
                                    
                                    # Add section header metadata if detected
                                    if header_info:
                                        chunk_meta.update(header_info)
                                        logger.debug(f"Detected section header: '{header_info.get('section_header')}' in chunk")
                                    else:
                                        chunk_meta['has_section_header'] = False
                                    
                                    chunk_metadata_list.append(chunk_meta)
                                else:
                                    chunks_filtered_count += 1
                                    logger.warning(f"⚠️ Chunk {i+1} filtered out - no embed/content text and no block text")
                                    logger.info(f"   Chunk has blocks: {bool(blocks)}, block count: {len(blocks)}")
                            
                            chunks = chunk_texts
                            logger.info(f"✅ Using Reducto section-based chunks with bbox metadata: {len(chunks)} chunks")
                            if chunks_filtered_count > 0:
                                logger.warning(f"⚠️ Filtered out {chunks_filtered_count} chunks (no text content)")
                            logger.info(f"📊 Chunk processing summary: {len(reducto_chunks)} retrieved → {len(chunks)} chunks with text, {total_blocks_count} total blocks")
                        else:
                            # Fallback: Chunk the document text manually (no bbox metadata)
                            chunks = vector_service.chunk_text(document_text, chunk_size=1200, overlap=None)
                            chunk_metadata_list = None
                            logger.info(f"⚠️ Using manual chunking (no bbox metadata): {len(chunks)} chunks")
                        
                        # Prepare metadata
                        metadata = {
                            'business_id': business_uuid,
                            'document_id': str(document_id),
                            'property_id': str(property_id) if property_id else None,
                            'classification_type': classification_type or 'other_documents',
                            'address_hash': None  # Will be set if available
                        }
                        
                        # Store document vectors with immediate embedding (same as full extraction)
                        if chunks:
                            logger.info(f"🚀 Generating embeddings for {len(chunks)} chunks...")
                            success = vector_service.store_document_vectors(
                                str(document_id), 
                                chunks, 
                                metadata,
                                chunk_metadata_list=chunk_metadata_list,
                                lazy_embedding=False  # Immediate embedding - generates embeddings right away
                            )
                            
                            if success:
                                document_vectors_stored = len(chunks)
                                logger.info(f"✅ Stored {document_vectors_stored} document vectors with embeddings (immediate mode)")
                                
                                # Log to processing history with metrics
                                try:
                                    doc_storage.log_processing_step(
                                        document_id=str(document_id),
                                        step_name='vector_storage',
                                        step_status='completed',
                                        step_message=f"Stored {document_vectors_stored} vectors with embeddings",
                                        step_metadata={
                                            'chunks_processed': len(chunks),
                                            'vectors_stored': document_vectors_stored,
                                            'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                            'chunks_filtered': chunks_filtered_count if 'chunks_filtered_count' in locals() else 0,
                                            'total_blocks': total_blocks_count if 'total_blocks_count' in locals() else 0
                                        },
                                        business_id=business_id
                                    )
                                except Exception as log_error:
                                    logger.warning(f"⚠️ Failed to log vector storage step: {log_error}")
                            else:
                                logger.error(f"❌ Failed to store document vectors")
                                # Log failure to processing history
                                try:
                                    doc_storage.log_processing_step(
                                        document_id=str(document_id),
                                        step_name='vector_storage',
                                        step_status='failed',
                                        step_message="Failed to store document vectors",
                                        step_metadata={
                                            'chunks_processed': len(chunks),
                                            'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                            'error': 'Vector storage returned False'
                                        },
                                        business_id=business_id
                                    )
                                except Exception as log_error:
                                    logger.warning(f"⚠️ Failed to log vector storage failure: {log_error}")
                        else:
                            logger.warning(f"⚠️ No chunks to store for document - chunks were filtered out or empty")
                            logger.warning(f"   Retrieved chunks: {len(reducto_chunks) if reducto_chunks else 0}")
                            logger.warning(f"   Chunks with text: 0")
                            # Log this as a warning step
                            try:
                                doc_storage.log_processing_step(
                                    document_id=str(document_id),
                                    step_name='vector_storage',
                                    step_status='failed',
                                    step_message="No chunks to store - all chunks were filtered out (no text content)",
                                    step_metadata={
                                        'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                        'chunks_filtered': chunks_filtered_count if 'chunks_filtered_count' in locals() else len(reducto_chunks) if reducto_chunks else 0,
                                        'total_blocks': total_blocks_count if 'total_blocks_count' in locals() else 0,
                                        'error': 'No chunks had embed/content text or extractable block text'
                                    },
                                    business_id=business_id
                                )
                            except Exception as log_error:
                                logger.warning(f"⚠️ Failed to log vector storage warning: {log_error}")
                            
                    except Exception as e:
                        logger.error(f"❌ Error chunking/storing document vectors: {e}")
                        logger.error(f"   Document ID: {document_id}")
                        logger.error(f"   Chunks retrieved: {len(reducto_chunks) if reducto_chunks else 0}")
                        logger.error(f"   Chunks with text: {len(chunks) if 'chunks' in locals() else 0}")
                        logger.error(f"   Error type: {type(e).__name__}")
                        import traceback
                        logger.error(f"   Traceback: {traceback.format_exc()}")
                        
                        # Log to processing history
                        try:
                            doc_storage.log_processing_step(
                                document_id=str(document_id),
                                step_name='vector_storage',
                                step_status='failed',
                                step_message=f"Error chunking/storing vectors: {str(e)}",
                                step_metadata={
                                    'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                    'chunks_processed': len(chunks) if 'chunks' in locals() else 0,
                                    'error': str(e),
                                    'error_type': type(e).__name__
                                },
                                business_id=business_id
                            )
                        except Exception as log_error:
                            logger.warning(f"⚠️ Failed to log vector storage error: {log_error}")
                else:
                    logger.warning("⚠️ No document text available for chunking/embedding")
                    
            except Exception as e:
                logger.error(f"❌ Vector service failed: {e}")
                import traceback
                traceback.print_exc()
                logger.warning("⚠️ Continuing without vector storage...")
            
            logger.info(f"✅ Document vector embedding completed: {document_vectors_stored} vectors stored")

            # log history completion (non-fatal if history_id is None)
            if history_id:
                history_service.log_step_completion(
                    history_id=history_id,
                    step_message=f"Minimal extraction completed with property linking and vector embedding",
                    step_metadata={
                        'extracted_properties': len(extracted_data.get('properties', [])) if extracted_data else 0,
                        'text_length': len(document_text),
                        'property_linking_attempted': len(extracted_properties) > 0,
                        'vectors_stored': document_vectors_stored
                    }
                )

            return {
                'status': 'completed',
                'properties': extracted_data.get('properties', []) if extracted_data else [],
                'history_id': history_id,
                'vectors_stored': document_vectors_stored
            }

        except Exception as e:
            logger.error(f"Error in minimal extraction: {e}")
            
            # Update status to failed in Supabase
            try:
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='failed',
                    business_id=business_id
                )
            except Exception as status_error:
                logger.error(f"Failed to update document status to failed: {status_error}")

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

@shared_task(bind=True)
def process_document_with_dual_stores(self, document_id, file_content, original_filename, business_id, job_id=None):
    """
    Celery task to process an uploaded document:
    1. Receives file content directly.
    2. Saves content to a temporary file.
    3. Parses with Reducto.
    4. Extracts structured data using Reducto Extract.
    5. Stores data in Supabase.
    """
    from . import create_app
    app = create_app()
    
    with app.app_context():
        # PHASE 1 FIX: Signal Import & Safe Cleanup
        import signal
        
        def safe_signal_cleanup():
            """Safely cancel signal alarm if signal module is available"""
            try:
                signal.alarm(0)
            except (NameError, AttributeError):
                pass  # signal not imported or not available
        # ==========================================
        
        print("=" * 80)
        print("🚀 EXTRACTION TASK STARTED: process_document_with_dual_stores")
        print(f"   Document ID: {document_id}")
        print(f"   Business ID: {business_id}")
        print(f"   Filename: {original_filename}")
        print(f"   File size: {len(file_content)} bytes")
        print("=" * 80)
        
        # Fetch document from Supabase (not local PostgreSQL)
        from .services.document_storage_service import DocumentStorageService
        doc_storage = DocumentStorageService()
        success, document_dict, error = doc_storage.get_document(str(document_id), business_id)
        
        if not success or not document_dict:
            print(f"❌ Document with id {document_id} not found in Supabase. Error: {error}")
            return
        
        print(f"✅ Retrieved document {document_id} from Supabase")
        document = document_dict  # document is now a dict from Supabase

        temp_dir = None
        try:
            print(f"🔄 Starting direct content processing for document_id: {document_id}")
            
            # Update status to processing in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='processing',
                business_id=business_id
            )

            # --- 1. Save received file content to a temporary file ---
            temp_dir = tempfile.mkdtemp()
            temp_image_dir = os.path.join(temp_dir, 'images')
            os.makedirs(temp_image_dir, exist_ok=True)
            temp_file_path = os.path.join(temp_dir, original_filename)
            with open(temp_file_path, 'wb') as f:
                f.write(file_content)
            
            print(f"Successfully saved direct content to {temp_file_path}")
            # Handle business_id that might be a company name (legacy) or UUID
            try:
                business_uuid = str(UUID(str(business_id))) if business_id else None
            except (ValueError, TypeError):
                # business_id is not a UUID (e.g., "SoloSway"), try to get UUID from mapping
                print(f"⚠️  business_id '{business_id}' is not a UUID, looking up UUID...")
                try:
                    from .services.supabase_auth_service import SupabaseAuthService
                    auth_service = SupabaseAuthService()
                    business_uuid = auth_service.get_business_uuid(business_id)
                    if not business_uuid:
                        # Try ensure_business_uuid which creates mapping if needed
                        business_uuid = auth_service.ensure_business_uuid(business_id)
                    print(f"✅ Found business UUID: {business_uuid}")
                except Exception as lookup_error:
                    print(f"❌ Failed to lookup business UUID: {lookup_error}")
                    business_uuid = None
            
            if not business_uuid:
                raise ValueError(f"Could not determine business UUID from business_id: {business_id}")
            
            print(f"Processing document for business_id: {business_uuid}")
            print(f"Image extraction directory: {temp_image_dir}")
        
            # --- 2. Parse with Reducto ---
            # REDUCTO PATH: Parse + Extract + Images (section-based chunking)
            print("🔄 Using Reducto for document processing (section-based chunking)...")
            
            from .services.reducto_service import ReductoService
            from .services.reducto_image_service import ReductoImageService
            from .services.extraction_schemas import get_extraction_schema
            
            reducto = ReductoService()
            image_service = ReductoImageService()

            # Initialize variables
            image_urls = []
            document_text = ""
            
            # Get document_summary (JSONB) from Supabase document
            # Use helper function to safely parse document_summary
            document_summary = get_document_summary_safe(document)
            image_urls = document_summary.get('reducto_image_urls', [])
            
            # Use job_id passed from classification task (avoids read-after-write consistency issues)
            # Fallback to database lookup if not provided
            # Note: job_id is a function parameter (from line 1344), don't overwrite it
            if job_id and isinstance(job_id, str) and job_id.strip():
                job_id = job_id.strip()
                logger.info(f"✅ Using job_id passed from classification task: {job_id}")
            else:
                # Fallback: Try to retrieve from database (with retry for race conditions)
                logger.info(f"🔍 Job_id not provided, attempting to retrieve from database...")
                retrieved_job_id = get_job_id_with_retry(doc_storage, str(document_id), business_id, max_retries=3)
                
                if retrieved_job_id and isinstance(retrieved_job_id, str) and retrieved_job_id.strip():
                    job_id = retrieved_job_id.strip()
                    logger.info(f"✅ Retrieved job_id from database: {job_id}")
                else:
                    logger.warning("⚠️ No valid job_id found, will need to parse document")
                    job_id = None
            
            # If no job_id after retries, only then parse (shouldn't happen in normal flow)
            # Now uses section-based chunking to maintain document structure
            if not job_id:
                logger.warning("⚠️ No job_id found after retries, parsing document now...")
                file_size_mb = len(file_content) / (1024 * 1024)
                use_async = file_size_mb > 1.0
                
                if use_async:
                    print(f"📦 Large file detected ({file_size_mb:.2f}MB), using async processing")
                
                parse_result = reducto.parse_document(
                    file_path=temp_file_path,
                    return_images=["figure", "table"],
                    use_async=use_async
                )
                job_id = parse_result['job_id']
                document_text = parse_result['document_text']
                image_urls = parse_result['image_urls']
                image_blocks_metadata = parse_result.get('image_blocks_metadata', [])
                chunks = parse_result.get('chunks', [])
                
                # Store in document_summary (Supabase JSONB)
                # Refresh document_summary after parse to ensure we have the latest
                document_summary = get_document_summary_safe(document)
                document_summary['reducto_job_id'] = job_id
                document_summary['reducto_image_urls'] = image_urls
                # Store image blocks metadata for filtering (if available)
                if image_blocks_metadata:
                    document_summary['reducto_image_blocks_metadata'] = image_blocks_metadata
                
                # CRITICAL FIX: Store chunks with bbox metadata for later retrieval
                # This ensures bbox data is available even if Reducto job_id expires
                if chunks:
                    chunks_data = []
                    for chunk in chunks:
                        chunks_data.append({
                            'content': chunk.get('content', ''),
                            'embed': chunk.get('embed', ''),
                            'enriched': chunk.get('enriched'),
                            'bbox': chunk.get('bbox'),
                            'blocks': chunk.get('blocks', [])
                        })
                    document_summary['reducto_chunks'] = chunks_data
                    document_summary['reducto_chunk_count'] = len(chunks)
                    logger.info(f"✅ Stored {len(chunks_data)} chunks with bbox metadata in document_summary")
                
                # Store parsed text and metadata in Supabase
                doc_storage.update_document_extraction(
                    document_id=str(document_id),
                    parsed_text=document_text,
                    extracted_json={},
                    business_id=business_id
                )
                
                # Update document_summary
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='processing',
                    business_id=business_id,
                    additional_data={'document_summary': document_summary}
                )
            else:
                logger.info(f"✅ Using existing job_id from classification: {job_id}")
                # Get document text from stored parsed_text
                document_text = document.get('parsed_text') or ""
                
                # PRIORITY 1: Check if we have stored chunks in document_summary (from classification)
                # This avoids re-parsing or retrieving from Reducto if we already have the data
                stored_chunks = document_summary.get('reducto_chunks', [])
                
                if stored_chunks:
                    logger.info(f"✅ Found {len(stored_chunks)} chunks in document_summary, using stored data")
                    # Use stored chunks directly - reconstruct document_text if needed
                    if not document_text:
                        document_text = '\n\n'.join([
                            chunk.get('content', '') for chunk in stored_chunks if isinstance(chunk, dict)
                        ])
                        logger.info(f"✅ Reconstructed document text from stored chunks ({len(document_text)} chars)")
                    
                    # Get image_blocks_metadata from stored chunks if available
                    image_blocks_metadata = document_summary.get('reducto_image_blocks_metadata', [])
                    
                    # Extract chunks list for later use (vector embedding)
                    chunks = stored_chunks
                    
                    logger.info(f"✅ Using stored chunks from classification - no Reducto retrieval needed")
                
                # PRIORITY 2: FALLBACK - If no stored chunks, retrieve from Reducto using job_id
                elif (not document_text or not image_urls) and job_id:
                    logger.warning(f"⚠️ parsed_text or images missing, retrieving from Reducto for job {job_id}")
                    try:
                        # Retrieve parse result from Reducto using job_id
                        parse_result = reducto.get_parse_result_from_job_id(
                            job_id=job_id,
                            return_images=["figure", "table"]
                        )
                        
                        # Update document_text and image_urls from retrieved result
                        if parse_result['document_text']:
                            document_text = parse_result['document_text']
                            logger.info(f"✅ Retrieved parsed text from Reducto ({len(document_text)} chars)")
                        
                        if parse_result['image_urls']:
                            image_urls = parse_result['image_urls']
                            logger.info(f"✅ Retrieved {len(image_urls)} image URLs from Reducto")
                        
                        # Get image blocks metadata for filtering
                        image_blocks_metadata = parse_result.get('image_blocks_metadata', [])
                        chunks = parse_result.get('chunks', [])
                            
                        # Store in document_summary as backup (Supabase JSONB)
                        document_summary['reducto_parsed_text'] = document_text
                        document_summary['reducto_image_urls'] = image_urls
                        if image_blocks_metadata:
                            document_summary['reducto_image_blocks_metadata'] = image_blocks_metadata
                        
                        # CRITICAL FIX: Store chunks with bbox metadata for later retrieval
                        # This ensures bbox data is available even if Reducto job_id expires
                        if chunks:
                            chunks_data = []
                            for chunk in chunks:
                                chunks_data.append({
                                    'content': chunk.get('content', ''),
                                    'embed': chunk.get('embed', ''),
                                    'enriched': chunk.get('enriched'),
                                    'bbox': chunk.get('bbox'),
                                    'blocks': chunk.get('blocks', [])
                                })
                            document_summary['reducto_chunks'] = chunks_data
                            document_summary['reducto_chunk_count'] = len(chunks)
                            logger.info(f"✅ Stored {len(chunks_data)} chunks with bbox metadata from Reducto API")
                        
                        # Store parsed text and metadata in Supabase
                        doc_storage.update_document_extraction(
                            document_id=str(document_id),
                            parsed_text=document_text,
                            extracted_json={},
                            business_id=business_id
                        )
                        
                        # Update document_summary
                        doc_storage.update_document_status(
                            document_id=str(document_id),
                            status='processing',
                            business_id=business_id,
                            additional_data={'document_summary': document_summary}
                        )
                        
                    except Exception as e:
                        logger.error(f"Failed to retrieve parse result from Reducto job_id: {e}")
                        # Fallback to document_summary backup (Supabase JSONB)
                        if document_summary:
                            try:
                                stored_text = document_summary.get('reducto_parsed_text', '')
                                stored_image_urls = document_summary.get('reducto_image_urls', [])
                                
                                if stored_text and not document_text:
                                    document_text = stored_text
                                    logger.info(f"✅ Retrieved parsed text from document_summary backup ({len(document_text)} chars)")
                                
                                if stored_image_urls and not image_urls:
                                    image_urls = stored_image_urls
                                    logger.info(f"✅ Retrieved {len(image_urls)} image URLs from document_summary backup")
                            except Exception as e2:
                                logger.error(f"Failed to retrieve parse result from document_summary: {e2}")
                
                print(f"✅ Using existing job_id: {job_id}")
                
                # Initialize image_blocks_metadata if not already set
                if 'image_blocks_metadata' not in locals() or image_blocks_metadata is None:
                    image_blocks_metadata = []
                
                # Try to get image_blocks_metadata from document_summary if not already retrieved
                if not image_blocks_metadata and document_summary:
                    try:
                        image_blocks_metadata = document_summary.get('reducto_image_blocks_metadata', [])
                    except:
                        pass
            
            print(f"📄 Document text length: {len(document_text)} characters")
            print(f"📸 Found {len(image_urls)} images in document")
            
            # Ensure image_blocks_metadata is always initialized
            if 'image_blocks_metadata' not in locals() or image_blocks_metadata is None:
                image_blocks_metadata = []
                # Try to get from parse_result if available
                if 'parse_result' in locals() and isinstance(parse_result, dict):
                    image_blocks_metadata = parse_result.get('image_blocks_metadata', [])
                # Fallback to document_summary
                elif document_summary:
                    try:
                        image_blocks_metadata = document_summary.get('reducto_image_blocks_metadata', [])
                    except:
                        pass
            
            # ========================================================================
            # PHASE 3: PARALLEL OPERATIONS - Run images, classification, and extraction in parallel
            # ========================================================================
            
            # Check if classification is already done
            classification_type = document.get('classification_type')
            needs_classification = not classification_type
            
            # Phase 3: Run images and classification (if needed) in parallel
            processed_images = []
            if needs_classification:
                logger.info(f"⚡ Starting parallel operations: images + classification")
            else:
                logger.info(f"⚡ Starting parallel operations: images + extraction")
            
            with ThreadPoolExecutor(max_workers=3) as executor:
                # Task 1: Process images in parallel (with parallel downloads inside)
                future_images = None
                if image_urls:
                    future_images = executor.submit(
                        image_service.process_parsed_images,
                        image_urls=image_urls,
                        document_id=str(document_id),
                        business_id=business_id,
                        property_id=None,
                        image_blocks_metadata=image_blocks_metadata,
                        document_text=document_text
                    )
                    logger.info(f"🚀 Started parallel image processing ({len(image_urls)} images)")
                
                # Task 2: Get classification if needed
                future_classification = None
                if needs_classification:
                    future_classification = executor.submit(
                        reducto.classify_document,
                        job_id
                    )
                    logger.info(f"🚀 Started parallel classification")
                
                # Wait for classification to complete (needed for extraction)
                if future_classification:
                    classification = future_classification.result()
                    classification_type = classification['document_type']
                    logger.info(f"✅ Parallel classification completed: {classification_type}")
                
                # Task 3: Extract with appropriate schema (after classification ready)
                # Validate job_id before extraction
                if not job_id or not isinstance(job_id, str) or not job_id.strip():
                    logger.error(f"❌ Cannot extract: job_id is invalid: {job_id}")
                    raise ValueError(f"job_id must be a non-empty string for extraction, got: {type(job_id)} = {job_id}")
                
                schema = get_extraction_schema(classification_type)
                logger.info(f"🚀 Starting parallel extraction with schema: {classification_type} (job_id: {job_id})")
                future_extraction = executor.submit(
                    reducto.extract_with_schema,
                    job_id=job_id.strip(),  # Ensure job_id is clean
                    schema=schema,
                    system_prompt="Be precise and thorough. Extract all property details."
                )
                logger.info(f"🚀 Started parallel extraction with schema: {classification_type}")
                
                # Wait for both images and extraction to complete
                if future_images:
                    image_result = future_images.result()
                    processed_images = image_result['images']
                    filter_stats = image_result.get('filter_stats', {})
                    logger.info(f"✅ Parallel image processing completed: {image_result['processed']}/{filter_stats.get('total_filtered', 0)} images uploaded")
                    if image_result['errors']:
                        logger.warning(f"⚠️ Image processing errors: {len(image_result['errors'])}")
                else:
                    logger.info(f"ℹ️ No images to process")
                
                try:
                    extraction = future_extraction.result()
                    extracted_data = extraction['data']
                    logger.info(f"✅ Parallel extraction completed")
                except Exception as e:
                    logger.error(f"❌ Reducto extraction failed: {e}")
                    logger.error(f"   Job ID: {job_id}")
                    logger.error(f"   Schema: {classification_type}")
                    logger.error(f"   Document ID: {document_id}")
                    # Log extraction failure to processing history
                    try:
                        doc_storage.log_processing_step(
                            document_id=str(document_id),
                            step_name='extraction',
                            step_status='failed',
                            step_message=f"Reducto extraction failed: {str(e)}",
                            step_metadata={
                                'reducto_job_id': job_id,
                                'classification_type': classification_type,
                                'error': str(e),
                                'error_type': type(e).__name__
                            },
                            business_id=business_id
                        )
                    except Exception as log_error:
                        logger.warning(f"⚠️ Failed to log extraction error: {log_error}")
                    raise  # Re-raise to trigger fallback handling
            
            # Transform to match existing structure
            # Reducto returns: {'data': {'subject_property': {...}}}
            if 'subject_property' in extracted_data:
                subject_property = extracted_data['subject_property']
            else:
                # Handle other schemas (OTHER_DOCUMENTS_EXTRACTION_SCHEMA, MINIMAL_EXTRACTION_SCHEMA)
                subject_property = extracted_data.get('subject_property', extracted_data)
            
            logger.info(f"✅ All parallel operations completed: images, classification, extraction")
            
            # Add images to subject_property structure
            if processed_images:
                property_images = [
                    {
                        'url': img['url'],
                        'document_id': img['document_id'],
                        'source_document_id': img.get('source_document_id', img['document_id']),
                        'image_index': img['image_index'],
                        'storage_path': img.get('storage_path', ''),
                        'size_bytes': img.get('size_bytes', 0)
                    }
                    for img in processed_images
                ]
                
                primary_image_url = property_images[0]['url'] if property_images else None
                
                if subject_property:
                    subject_property['property_images'] = property_images
                    subject_property['primary_image_url'] = primary_image_url
                    subject_property['image_count'] = len(property_images)
            
            # Format to match expected structure
            if subject_property:
                subject_properties = [clean_extracted_property(subject_property)]
            else:
                subject_properties = []
            
            print(f"✅ Processed {len(subject_properties)} property records")
            
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
            import re
            
            address_service = AddressNormalizationService()
            
            # Check if document is manually linked to a property (uploaded via property card)
            is_manual_upload = False
            manual_property_id = None
            skip_property_updates = False
            
            property_id = document.get('property_id')
            if property_id:
                # Document already has a property_id - check if it's a manual upload
                try:
                    # Use helper function to safely parse document_summary
                    document_summary = get_document_summary_safe(document)
                    
                    if document_summary.get('upload_source') == 'property_card' and document_summary.get('manually_linked_to_property_id'):
                        is_manual_upload = True
                        manual_property_id = str(property_id)
                        print(f"📌 Document is manually linked to property: {manual_property_id}")
                        print(f"   Upload source: property_card")
                except Exception as e:
                    print(f"⚠️  Error checking manual upload metadata: {e}")
            
            # Step 1: Determine which address to use (Priority: Filename > Content)
            property_address = None
            address_source = None
            subject_property = subject_properties[0] if subject_properties else None
            
            # Priority 1: Try to use filename address if available
            try:
                # Use helper function to safely parse document_summary
                document_summary = get_document_summary_safe(document)
                
                filename_address = document_summary.get('filename_address')
                
                if filename_address:
                    property_address = filename_address
                    address_source = 'filename'
                    print(f"🎯 Using address from FILENAME: '{property_address}'")
                    print(f"   Confidence: {document_summary.get('filename_address_confidence', 0.0):.2f}")
            except Exception as e:
                print(f"⚠️  Error parsing document_summary: {e}")
            
            # Priority 2: Use extracted subject property address if filename didn't have one
            if not property_address and subject_property:
                property_address = subject_property.get('property_address')
                
                # Handle case where Reducto returns address as dict with 'value' key
                if isinstance(property_address, dict):
                    property_address = property_address.get('value', '')
                
                if property_address:
                    address_source = 'extraction'
                    print(f"🎯 Using address from CONTENT EXTRACTION: '{property_address}'")
            
            # Step 2: For manual uploads, compare addresses before processing
            if is_manual_upload and property_address and manual_property_id:
                print(f"🔍 Manual upload detected - comparing addresses...")
                print(f"   Document address: '{property_address}'")
                
                # Get the property's address from database
                from .models import Property
                property_obj = Property.query.filter_by(id=UUID(manual_property_id)).first()
                
                if property_obj:
                    property_obj_address = property_obj.formatted_address or property_obj.normalized_address or ""
                    print(f"   Property address: '{property_obj_address}'")
                    
                    # Helper function to extract postcode from address
                    def extract_postcode(addr):
                        if not addr:
                            return None
                        postcode_match = re.search(r'([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})', addr, re.IGNORECASE)
                        return postcode_match.group(1).upper().replace(' ', '') if postcode_match else None
                    
                    # Compare postcodes (most reliable identifier)
                    doc_postcode = extract_postcode(property_address)
                    prop_postcode = extract_postcode(property_obj_address)
                    
                    if doc_postcode and prop_postcode:
                        if doc_postcode != prop_postcode:
                            print(f"   ⚠️  Postcodes differ: '{doc_postcode}' vs '{prop_postcode}'")
                            print(f"   📌 Address mismatch detected - will skip property detail updates")
                            skip_property_updates = True
                        else:
                            print(f"   ✅ Postcodes match: '{doc_postcode}'")
                            print(f"   📌 Addresses match - will proceed with property updates")
                    else:
                        # If we can't extract postcodes, compare normalized addresses
                        doc_normalized = address_service.normalize_address(property_address)
                        prop_normalized = address_service.normalize_address(property_obj_address)
                        
                        if doc_normalized != prop_normalized:
                            print(f"   ⚠️  Normalized addresses differ")
                            print(f"   📌 Address mismatch detected - will skip property detail updates")
                            skip_property_updates = True
                        else:
                            print(f"   ✅ Normalized addresses match")
                            print(f"   📌 Addresses match - will proceed with property updates")
                else:
                    print(f"   ⚠️  Property {manual_property_id} not found in database")
                    print(f"   📌 Will proceed with normal property creation")
            
            # Step 3: Process address and link to property node
            # Phase 7: Initialize geocoding cache to store results for reuse
            cached_geocoding_map = {}
            
            if property_address:
                print(f"📍 Processing property linking for address: '{property_address}'")
                print(f"   Address source: {address_source}")
                if is_manual_upload:
                    print(f"   Manual upload: {'Yes (skipping property updates)' if skip_property_updates else 'Yes (addresses match)'}")
                
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
                        'geocoder_used': geocoding_result.get('geocoder', 'none'),
                        'address_source': address_source
                    }
                    
                    # Phase 7: Cache geocoding result for reuse later (avoid duplicate API calls)
                    cached_result = {
                        'latitude': geocoding_result.get('latitude'),
                        'longitude': geocoding_result.get('longitude'),
                        'formatted_address': geocoding_result.get('formatted_address') or geocoding_result.get('geocoded_address'),
                        'status': geocoding_result.get('status', 'success'),
                        'confidence': geocoding_result.get('confidence', 0.9),
                        'normalized_address': normalized,
                        'address_hash': address_hash
                    }
                    cached_geocoding_map[property_address] = cached_result
                    logger.info(f"✅ Cached geocoding result for reuse: {property_address}")
                    
                    # CRITICAL: Check if property already exists with user-set pin location (geocoding_status: 'manual')
                    # If property has geocoding_status: 'manual', DO NOT update coordinates from document geocoding
                    # Property pin location is immutable after creation - documents added after property creation must NEVER alter it
                    # Note: The enhanced_property_matching_service will find existing properties and link documents to them
                    # but will not update property coordinates. This ensures user-set pin locations remain fixed.
                    
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
                        print(f"   🏢 Business: {business_uuid}")
                        print(f"   📄 Document: {document_id}")
                        print(f"   🏠 Extracted data: {len(extracted_data)} fields")
                        if skip_property_updates:
                            print(f"   ⚠️  Skipping property detail updates (manual upload with address mismatch)")
                        
                        # Create complete property hub with enhanced error handling
                        # The matching service only needs: document_id, address_data, business_id, and extracted_data
                        hub_result = property_hub_service.create_property_with_relationships(
                            address_data=address_data,
                            document_id=str(document_id),
                            business_id=business_uuid,
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

            # Images are already processed via ReductoImageService above (lines 1202-1216)
            # and attached to subject_property structure (lines 1248-1267)
            
            property_uuids = [uuid.uuid4() for _ in subject_properties]

            # --- 5. Store structured data in Supabase ---
            print("Storing structured data in Supabase...")
            
            # Phase 7: Get geocoding results for all properties (reuse cached results from property linking)
            addresses = [prop.get('property_address', '') for prop in subject_properties]
            
            # Start with cached geocoding results from property linking phase
            geocoding_map = cached_geocoding_map.copy() if cached_geocoding_map else {}
            
            # Check which addresses still need geocoding
            addresses_to_geocode = []
            for addr in addresses:
                if addr and addr not in geocoding_map:
                    addresses_to_geocode.append(addr)
            
            # Only geocode addresses that weren't cached
            if addresses_to_geocode:
                logger.info(f"🔄 Geocoding {len(addresses_to_geocode)} addresses that weren't cached...")
                geocoding_results = geocode_address_parallel(addresses_to_geocode, max_workers=3)
                # Add newly geocoded results to map
                for addr, result in geocoding_results:
                    geocoding_map[addr] = result
            else:
                logger.info(f"✅ All addresses already geocoded (cached from property linking), skipping parallel geocoding")
            
            # Add debug logging before Supabase storage
            print(f"🔍 DEBUG: About to store in Supabase:")
            print(f"   subject_properties count: {len(subject_properties)}")
            if subject_properties:
                print(f"   First property address: {subject_properties[0].get('property_address', 'N/A')}")
                print(f"   First property type: {subject_properties[0].get('property_type', 'N/A')}")
            print(f"   property_uuids: {property_uuids}")
            print(f"   business_id: {business_uuid}")
            print(f"   document_id: {document_id}")
            
            # Store in Supabase - use correct key for the storage function
            supabase_success = store_extracted_properties_in_supabase(
                {"subject_property": subject_properties[0] if subject_properties else None}, 
                        business_uuid,
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
                
                # Process document text (from Reducto parse) with minimal logging
                document_vectors_stored = 0
                
                # Ensure document_text is available - if empty, try to retrieve from Reducto
                if not document_text and job_id:
                    logger.warning("⚠️ document_text is empty, attempting to retrieve from Reducto...")
                    try:
                        # reducto is already initialized earlier in the function
                        parse_result = reducto.get_parse_result_from_job_id(
                            job_id=job_id,
                            return_images=["figure", "table"]
                        )
                        if parse_result.get('document_text'):
                            document_text = parse_result['document_text']
                            # Store parsed text in Supabase
                            doc_storage.update_document_extraction(
                                document_id=str(document_id),
                                parsed_text=document_text,
                                extracted_json={},
                                business_id=business_id
                            )
                            logger.info(f"✅ Retrieved document text from Reducto ({len(document_text)} chars)")
                    except Exception as e:
                        logger.error(f"Failed to retrieve document text from Reducto: {e}")
                        # Fallback: try to get from document_summary
                        # Use helper function to safely parse document_summary
                        document_summary = get_document_summary_safe(document)
                        
                        if document_summary:
                            try:
                                stored_text = document_summary.get('reducto_parsed_text', '')
                                if stored_text:
                                    document_text = stored_text
                                    logger.info(f"✅ Retrieved document text from document_summary backup ({len(document_text)} chars)")
                            except Exception as e2:
                                logger.error(f"Failed to retrieve from document_summary: {e2}")
                
                if document_text:
                    try:
                        # Try to get chunks from stored metadata FIRST (always available)
                        # Fallback to Reducto API if metadata doesn't have chunks
                        reducto_chunks = None
                        chunk_metadata_list = None
                        
                        # PRIORITY 1: Get chunks from stored document_summary (always available, has bbox)
                        # Use helper function to safely parse document_summary
                        document_summary = get_document_summary_safe(document)
                        
                        if document_summary:
                            try:
                                stored_chunks = document_summary.get('reducto_chunks', [])
                                if stored_chunks:
                                    reducto_chunks = stored_chunks
                                    logger.info(f"✅ Retrieved {len(reducto_chunks)} section-based chunks from stored metadata (with bbox)")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not parse metadata_json: {e}")
                        
                        # PRIORITY 2: Fallback to Reducto API if metadata doesn't have chunks
                        if not reducto_chunks and job_id:
                            try:
                                logger.info(f"🔄 Attempting to retrieve chunks from Reducto API (job_id may have expired)...")
                                parse_result = reducto.get_parse_result_from_job_id(
                                    job_id=job_id,
                                    return_images=["figure", "table"]
                                )
                                reducto_chunks = parse_result.get('chunks', [])
                                logger.info(f"✅ Retrieved {len(reducto_chunks)} section-based chunks from Reducto API")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not retrieve Reducto chunks from API: {e}")
                                logger.info(f"   This is expected if job_id has expired (>12 hours)")
                        
                        # Use Reducto chunks if available, otherwise chunk manually
                        if reducto_chunks:
                            # Extract chunk texts for embedding (use embed if available, fallback to content)
                            chunk_texts = []
                            chunk_metadata_list = []
                            
                            # Import section header detector
                            from backend.llm.utils.section_header_detector import detect_section_header
                            
                            MAX_CHUNK_SIZE = 30000  # ~7500 tokens, safe margin
                            
                            chunks_filtered_count = 0
                            total_blocks_count = 0
                            logger.info(f"🔄 Processing {len(reducto_chunks)} chunks for embedding...")
                            
                            for i, chunk in enumerate(reducto_chunks):
                                # Prefer embed (optimized for embeddings), fallback to content
                                embed_text = chunk.get('embed', '')
                                content_text = chunk.get('content', '')
                                
                                # Choose text to embed
                                text_to_embed = embed_text if embed_text else content_text
                                
                                # Track blocks
                                blocks = chunk.get('blocks', [])
                                total_blocks_count += len(blocks)
                                
                                # FALLBACK: If chunk has no embed/content, extract text from blocks
                                if not text_to_embed:
                                    if blocks:
                                        # Extract text from all blocks
                                        block_texts = []
                                        for block in blocks:
                                            if isinstance(block, dict):
                                                block_text = block.get('text', '') or block.get('content', '')
                                                if block_text:
                                                    block_texts.append(block_text)
                                        if block_texts:
                                            text_to_embed = ' '.join(block_texts)
                                            logger.info(f"✅ Extracted text from {len(block_texts)} blocks for chunk {i+1} (chunk had no embed/content)")
                                
                                if text_to_embed:
                                    chunk_texts.append(text_to_embed)
                                    
                                    # Extract chunk metadata with bbox
                                    chunk_bbox = chunk.get('bbox')
                                    # Phase 4: Use robust page number extraction
                                    chunk_page = extract_page_number_from_chunk(chunk)
                                    
                                    # NEW: Detect section header from chunk content
                                    # Use content_text (original) for header detection, not embed_text (optimized)
                                    header_info = detect_section_header(content_text if content_text else text_to_embed)
                                    
                                    chunk_meta = {
                                        'bbox': chunk_bbox,  # Chunk-level bbox
                                        'blocks': blocks,  # All blocks with bbox
                                        'page': chunk_page  # Robustly extracted page number
                                    }
                                    
                                    # Add section header metadata if detected
                                    if header_info:
                                        chunk_meta.update(header_info)
                                        logger.debug(f"Detected section header: '{header_info.get('section_header')}' in chunk")
                                    else:
                                        chunk_meta['has_section_header'] = False
                                    
                                    chunk_metadata_list.append(chunk_meta)
                                else:
                                    chunks_filtered_count += 1
                                    logger.warning(f"⚠️ Chunk {i+1} filtered out - no embed/content text and no block text")
                                    logger.info(f"   Chunk has blocks: {bool(blocks)}, block count: {len(blocks)}")
                            
                            chunks = chunk_texts
                            logger.info(f"✅ Using Reducto section-based chunks with bbox metadata: {len(chunks)} chunks")
                            if chunks_filtered_count > 0:
                                logger.warning(f"⚠️ Filtered out {chunks_filtered_count} chunks (no text content)")
                            logger.info(f"📊 Chunk processing summary: {len(reducto_chunks)} retrieved → {len(chunks)} chunks with text, {total_blocks_count} total blocks")
                        else:
                            # Fallback: Chunk the document text manually (no bbox metadata)
                            # Use dynamic overlap (None = auto-calculate based on content density)
                            chunks = vector_service.chunk_text(document_text, chunk_size=1200, overlap=None)
                            chunk_metadata_list = None
                            logger.info(f"⚠️ Using manual chunking (no bbox metadata): {len(chunks)} chunks")
                        
                        # Prepare metadata
                        metadata = {
                            'business_id': business_uuid,
                            'document_id': str(document_id),
                            'property_id': str(property_uuids[0]) if property_uuids else None,
                            'classification_type': classification_type or 'valuation_report',
                            'address_hash': None  # Will be set if available
                        }
                        
                        # Store document vectors with bbox metadata and generate embeddings immediately
                        # Immediate embedding: generates embeddings synchronously for simpler RAG architecture
                        if chunks:
                            logger.info(f"🚀 Generating embeddings for {len(chunks)} chunks...")
                            success = vector_service.store_document_vectors(
                                str(document_id), 
                                chunks, 
                                metadata,
                                chunk_metadata_list=chunk_metadata_list,
                                lazy_embedding=False  # Immediate embedding - generates embeddings right away
                            )
                            
                            if success:
                                document_vectors_stored = len(chunks)
                                logger.info(f"✅ Stored {document_vectors_stored} document vectors with embeddings (immediate mode)")
                                
                                # Log to processing history with metrics
                                try:
                                    doc_storage.log_processing_step(
                                        document_id=str(document_id),
                                        step_name='vector_storage',
                                        step_status='completed',
                                        step_message=f"Stored {document_vectors_stored} vectors with embeddings",
                                        step_metadata={
                                            'chunks_processed': len(chunks),
                                            'vectors_stored': document_vectors_stored,
                                            'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                            'chunks_filtered': chunks_filtered_count if 'chunks_filtered_count' in locals() else 0,
                                            'total_blocks': total_blocks_count if 'total_blocks_count' in locals() else 0
                                        },
                                        business_id=business_id
                                    )
                                except Exception as log_error:
                                    logger.warning(f"⚠️ Failed to log vector storage step: {log_error}")
                            else:
                                logger.error(f"❌ Failed to store document vectors")
                                # Log failure to processing history
                                try:
                                    doc_storage.log_processing_step(
                                        document_id=str(document_id),
                                        step_name='vector_storage',
                                        step_status='failed',
                                        step_message="Failed to store document vectors",
                                        step_metadata={
                                            'chunks_processed': len(chunks),
                                            'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                            'error': 'Vector storage returned False'
                                        },
                                        business_id=business_id
                                    )
                                except Exception as log_error:
                                    logger.warning(f"⚠️ Failed to log vector storage failure: {log_error}")
                        else:
                            logger.warning(f"⚠️ No chunks to store for document - chunks were filtered out or empty")
                            logger.warning(f"   Retrieved chunks: {len(reducto_chunks) if reducto_chunks else 0}")
                            logger.warning(f"   Chunks with text: 0")
                            # Log this as a warning step
                            try:
                                doc_storage.log_processing_step(
                                    document_id=str(document_id),
                                    step_name='vector_storage',
                                    step_status='failed',
                                    step_message="No chunks to store - all chunks were filtered out (no text content)",
                                    step_metadata={
                                        'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                        'chunks_filtered': chunks_filtered_count if 'chunks_filtered_count' in locals() else len(reducto_chunks) if reducto_chunks else 0,
                                        'total_blocks': total_blocks_count if 'total_blocks_count' in locals() else 0,
                                        'error': 'No chunks had embed/content text or extractable block text'
                                    },
                                    business_id=business_id
                                )
                            except Exception as log_error:
                                logger.warning(f"⚠️ Failed to log vector storage warning: {log_error}")
                            
                    except Exception as e:
                        logger.error(f"❌ Error chunking/storing document vectors: {e}")
                        logger.error(f"   Document ID: {document_id}")
                        logger.error(f"   Chunks retrieved: {len(reducto_chunks) if reducto_chunks else 0}")
                        logger.error(f"   Chunks with text: {len(chunks) if 'chunks' in locals() else 0}")
                        logger.error(f"   Error type: {type(e).__name__}")
                        import traceback
                        logger.error(f"   Traceback: {traceback.format_exc()}")
                        
                        # Log to processing history
                        try:
                            doc_storage.log_processing_step(
                                document_id=str(document_id),
                                step_name='vector_storage',
                                step_status='failed',
                                step_message=f"Error chunking/storing vectors: {str(e)}",
                                step_metadata={
                                    'chunks_retrieved': len(reducto_chunks) if reducto_chunks else 0,
                                    'chunks_processed': len(chunks) if 'chunks' in locals() else 0,
                                    'error': str(e),
                                    'error_type': type(e).__name__
                                },
                                business_id=business_id
                            )
                        except Exception as log_error:
                            logger.warning(f"⚠️ Failed to log vector storage error: {log_error}")
                
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
                            'business_id': business_uuid,
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
                        
                        # Delete existing vectors for this property + document to prevent duplicates
                        vector_service.delete_property_vectors_by_source(
                            property_id=str(property_uuid),
                            source_document_id=str(document_id)
                        )
                        
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

            # Update status to completed in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='completed',
                business_id=business_id
            )
            print(f"✅ Document processing completed for document_id: {document_id}")

        except Exception as e:
            print(f"Error processing document {document_id}: {e}", file=sys.stderr)
            try:
                # Update status to failed in Supabase
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='failed',
                    business_id=business_id
                )
                print(f"✅ Updated document status to FAILED for document_id: {document_id}")
            except Exception as status_error:
                print(f"Error updating document status: {status_error}", file=sys.stderr)
        
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                print("Cleanup of temporary files completed.") 

@shared_task(bind=True)
def process_document_simple(self, document_id, file_content, original_filename, business_id):
    """
    Simplified document processing that focuses on basic functionality
    without heavy AI processing to avoid memory issues
    """
    from . import create_app
    from .services.document_storage_service import DocumentStorageService
    
    app = create_app()
    
    with app.app_context():
        # Fetch document from Supabase
        doc_storage = DocumentStorageService()
        success, document_dict, error = doc_storage.get_document(str(document_id), business_id)
        
        if not success or not document_dict:
            print(f"Document with id {document_id} not found in Supabase. Error: {error}")
            return f"Error: Document not found: {error}"

        try:
            print(f"Starting simplified processing for document_id: {document_id}")
            
            # Update status to processing in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='processing',
                business_id=business_id
            )
            
            # Basic processing - just store the file info and mark as completed
            print(f"Processing document: {original_filename}")
            print(f"File size: {len(file_content)} bytes")
            print(f"Business ID: {business_id}")
            
            # Simulate some processing time
            import time
            time.sleep(2)
            
            # Update document status to completed in Supabase
            doc_storage.update_document_status(
                document_id=str(document_id),
                status='completed',
                business_id=business_id
            )
            
            print(f"✅ Simplified document processing completed for document_id: {document_id}")
            return "Document processed successfully"
            
        except Exception as e:
            print(f"❌ Error in simplified document processing: {e}")
            try:
                doc_storage.update_document_status(
                    document_id=str(document_id),
                    status='failed',
                    business_id=business_id
                )
            except Exception as status_error:
                print(f"Failed to update document status to failed: {status_error}")
            return f"Error: {e}"

@shared_task(bind=True)
def process_document_task(self, document_id, file_content, original_filename, business_id):
    """
    Main document processing task that starts with classification
    """
    return process_document_classification.delay(document_id, file_content, original_filename, business_id)


@shared_task(bind=True, name="process_document_fast")
def process_document_fast_task(
    self,
    document_id: str,
    file_content: bytes,
    original_filename: str,
    business_id: str,
    property_id: str = None
):
    """
    Fast pipeline for property card uploads - optimized for speed (<30s target).
    
    Steps:
    1. Parse with Reducto (section-based, fast settings) - 5-15s
    2. Extract chunks with bbox - <1s
    3. Generate document-level context - 2-5s (automatic via store_document_vectors)
    4. Embed chunks (batch) - 5-10s (automatic via store_document_vectors)
    5. Store vectors in Supabase - 2-3s
    
    Total: ~14-34s (target: <30s typical)
    
    SKIPS (for speed):
    - Classification (not needed - property already linked)
    - Property extraction (not needed - property_id already known)
    - Image processing (skip for speed)
    - Full schema extraction (not needed)
    
    Args:
        document_id: UUID of the document
        file_content: Raw file bytes
        original_filename: Original filename
        business_id: Business UUID
        property_id: Property UUID (already linked, no extraction needed)
    """
    from . import create_app
    app = create_app()
    
    processing_start_time = time.time()
    
    with app.app_context():
        try:
            from .services.document_storage_service import DocumentStorageService
            from .services.reducto_service import ReductoService
            from .services.vector_service import SupabaseVectorService
            
            logger.info(f"⚡ FAST PIPELINE: Starting for document {document_id}")
            logger.info(f"   Property ID: {property_id}")
            logger.info(f"   File: {original_filename} ({len(file_content)} bytes)")
            
            # Initialize services
            doc_storage = DocumentStorageService()
            reducto = ReductoService()
            
            # Update status to processing
            try:
                doc_storage.supabase.table('documents').update({
                    'status': 'processing'
                }).eq('id', document_id).execute()
                logger.info(f"✅ Updated document status to 'processing'")
            except Exception as e:
                logger.warning(f"Could not update document status: {e}")
            
            # Save file to temp location
            temp_file_path = None
            try:
                # Create temp file with proper extension
                file_ext = os.path.splitext(original_filename)[1] or '.pdf'
                temp_file = tempfile.NamedTemporaryFile(
                    suffix=file_ext,
                    delete=False
                )
                temp_file.write(file_content)
                temp_file_path = temp_file.name
                temp_file.close()
                
                logger.info(f"✅ Saved file to temp location: {temp_file_path}")
            except Exception as e:
                logger.error(f"Failed to save temp file: {e}")
                raise
            
            # Step 1: Parse with Reducto (fast, section-based)
            parse_start_time = time.time()
            try:
                parse_result = reducto.parse_document_fast(
                    file_path=temp_file_path,
                    use_sync_for_small=True
                )
                parse_time = time.time() - parse_start_time
                logger.info(f"✅ Parse completed in {parse_time:.2f}s")
            except Exception as e:
                logger.error(f"❌ Fast parse failed: {e}")
                raise
            
            job_id = parse_result.get('job_id')
            document_text = parse_result.get('document_text', '')
            chunks = parse_result.get('chunks', [])
            
            if not chunks:
                raise Exception("No chunks extracted from document")
            
            logger.info(f"✅ Extracted {len(chunks)} section-based chunks, {len(document_text)} chars")
            
            # Step 2: Extract chunk texts and metadata with bbox validation (<1s)
            chunk_extract_start_time = time.time()
            
            chunk_texts = []
            chunk_metadata_list = []
            bbox_validation_results = []  # Track bbox validation for reasoning
            
            MAX_CHUNK_SIZE = 30000  # ~7500 tokens, safe margin for 8192 token limit
            
            def validate_bbox(bbox, chunk_index, chunk_text_preview=""):
                """
                Validate bbox structure and return validation result with reasoning.
                
                Returns:
                    dict with keys: valid, reasoning, issues, bbox_data
                """
                if not bbox:
                    return {
                        'valid': False,
                        'reasoning': 'No bbox provided - chunk may not have spatial coordinates',
                        'issues': ['missing_bbox'],
                        'bbox_data': None
                    }
                
                if not isinstance(bbox, dict):
                    return {
                        'valid': False,
                        'reasoning': f'Invalid bbox type: {type(bbox).__name__}, expected dict',
                        'issues': ['invalid_type'],
                        'bbox_data': None
                    }
                
                required_fields = ['left', 'top', 'width', 'height', 'page']
                missing_fields = [field for field in required_fields if field not in bbox]
                
                if missing_fields:
                    return {
                        'valid': False,
                        'reasoning': f'Missing required bbox fields: {", ".join(missing_fields)}',
                        'issues': ['missing_fields'],
                        'bbox_data': bbox
                    }
                
                # Validate coordinate ranges (normalized 0-1)
                issues = []
                if bbox.get('left') is not None and not (0 <= bbox['left'] <= 1):
                    issues.append('left_out_of_range')
                if bbox.get('top') is not None and not (0 <= bbox['top'] <= 1):
                    issues.append('top_out_of_range')
                if bbox.get('width') is not None and (bbox['width'] <= 0 or bbox['width'] > 1):
                    issues.append('width_invalid')
                if bbox.get('height') is not None and (bbox['height'] <= 0 or bbox['height'] > 1):
                    issues.append('height_invalid')
                if bbox.get('page') is not None and bbox['page'] < 1:
                    issues.append('page_invalid')
                
                if issues:
                    return {
                        'valid': False,
                        'reasoning': f'Bbox coordinate validation failed: {", ".join(issues)}',
                        'issues': issues,
                        'bbox_data': bbox
                    }
                
                return {
                    'valid': True,
                    'reasoning': 'Bbox structure and coordinates are valid',
                    'issues': [],
                    'bbox_data': bbox
                }
            
            for i, chunk in enumerate(chunks):
                # Prefer embed (optimized for embeddings), fallback to content
                embed_text = chunk.get('embed', '')
                content_text = chunk.get('content', '')
                text_to_embed = embed_text if embed_text else content_text
                
                if text_to_embed:
                    chunk_texts.append(text_to_embed)
                    
                    # Extract chunk metadata with bbox
                    chunk_bbox = chunk.get('bbox')
                    
                    # Validate bbox with reasoning
                    bbox_validation = validate_bbox(chunk_bbox, i, text_to_embed[:50])
                    bbox_validation_results.append({
                        'chunk_index': i,
                        'validation': bbox_validation
                    })
                    
                    # Log bbox validation reasoning (only failures to reduce noise)
                    if not bbox_validation['valid']:
                        logger.warning(f"⚠️ Chunk {i} bbox validation failed: {bbox_validation['reasoning']}")
                    # Removed debug logging for successful bbox validation to reduce terminal noise
                    
                    # Phase 4: Use robust page number extraction
                    chunk_page = extract_page_number_from_chunk(chunk)
                    chunk_meta = {
                        'bbox': chunk_bbox,
                        'blocks': chunk.get('blocks', []),
                        'page': chunk_page,  # Robustly extracted page number
                        'bbox_valid': bbox_validation['valid'],
                        'bbox_validation_reasoning': bbox_validation['reasoning']
                    }
                    chunk_metadata_list.append(chunk_meta)
                    
                    if len(text_to_embed) > MAX_CHUNK_SIZE:
                        logger.warning(f"⚠️ Large chunk detected ({len(text_to_embed)} chars), will be split during embedding")
            
            chunk_extract_time = time.time() - chunk_extract_start_time
            logger.info(f"✅ Chunk extraction completed in {chunk_extract_time:.2f}s")
            
            # Log bbox validation reasoning to document_processing_history
            valid_bbox_count = sum(1 for r in bbox_validation_results if r['validation']['valid'])
            invalid_bbox_count = len(bbox_validation_results) - valid_bbox_count
            
            if bbox_validation_results:
                try:
                    from .services.document_storage_service import DocumentStorageService
                    doc_storage_service = DocumentStorageService()
                    
                    # Summarize bbox validation results
                    bbox_issues = []
                    for result in bbox_validation_results:
                        if not result['validation']['valid']:
                            bbox_issues.append({
                                'chunk_index': result['chunk_index'],
                                'reasoning': result['validation']['reasoning'],
                                'issues': result['validation']['issues']
                            })
                    
                    doc_storage_service.log_processing_step(
                        document_id=document_id,
                        step_name='bbox_validation',
                        step_status='completed',
                        step_message=f'Validated {len(bbox_validation_results)} bbox coordinates: {valid_bbox_count} valid, {invalid_bbox_count} invalid',
                        step_metadata={
                            'total_chunks': len(bbox_validation_results),
                            'valid_bbox_count': valid_bbox_count,
                            'invalid_bbox_count': invalid_bbox_count,
                            'bbox_issues': bbox_issues,
                            'validation_details': bbox_validation_results
                        },
                        duration_seconds=0
                    )
                    logger.info(f"📊 Bbox validation: {valid_bbox_count}/{len(bbox_validation_results)} chunks have valid bbox coordinates")
                except Exception as e:
                    logger.warning(f"Could not log bbox validation reasoning: {e}")
            
            # Step 3: Prepare metadata (property_id already known!)
            vector_metadata = {
                'document_id': document_id,
                'business_id': business_id,
                'property_id': property_id,  # Already linked - no extraction needed!
                'classification_type': None,  # Skip classification
                'address_hash': None,
                'parsed_text': document_text
            }
            
            # Step 4: Store vectors (automatically handles context + embedding)
            embed_start_time = time.time()
            
            try:
                vector_service = SupabaseVectorService()
                
                success = vector_service.store_document_vectors(
                    document_id=document_id,
                    chunks=chunk_texts,
                    metadata=vector_metadata,
                    chunk_metadata_list=chunk_metadata_list,
                    lazy_embedding=False  # Immediate embedding
                )
                
                embed_time = time.time() - embed_start_time
                
                if not success:
                    raise Exception("Failed to store document vectors")
                
                logger.info(f"✅ Embedding and storage completed in {embed_time:.2f}s")
            except Exception as e:
                logger.error(f"❌ Failed to store document vectors: {e}")
                raise
            
            # Cleanup temp file
            try:
                if temp_file_path and os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
                    logger.info(f"✅ Cleaned up temp file")
            except Exception as e:
                logger.warning(f"Could not clean up temp file: {e}")
            
            # Update document status and store metrics
            total_time = time.time() - processing_start_time
            logger.info(f"⚡ FAST PIPELINE COMPLETE in {total_time:.2f}s")
            logger.info(f"   Breakdown: parse={parse_time:.2f}s, extract={chunk_extract_time:.2f}s, embed={embed_time:.2f}s")
            
            # Update document status to processed
            # Note: metadata_json column doesn't exist in Supabase documents table
            # Metrics are already logged via logger and can be tracked via document_processing_history
            try:
                doc_storage.supabase.table('documents').update({
                    'status': 'processed'
                }).eq('id', document_id).execute()
                
                logger.info(f"✅ Updated document status to 'processed'")
                
                # Log processing completion with metrics in document_processing_history
                from .services.document_storage_service import DocumentStorageService
                doc_storage_service = DocumentStorageService()
                doc_storage_service.log_processing_step(
                    document_id=document_id,
                    step_name='fast_pipeline',
                    step_status='completed',
                    step_message=f'Fast pipeline completed in {round(total_time, 2)}s',
                    step_metadata={
                        'reducto_job_id': job_id,
                        'chunk_count': len(chunk_texts),
                        'processing_method': 'fast_pipeline',
                        'processed_at': datetime.utcnow().isoformat(),
                        'processing_time_seconds': round(total_time, 2),
                        'processing_breakdown': {
                            'parse_time': round(parse_time, 2),
                            'chunk_extraction_time': round(chunk_extract_time, 2),
                            'embedding_time': round(embed_time, 2)
                        }
                    },
                    duration_seconds=int(total_time)
                )
            except Exception as e:
                logger.warning(f"Could not update document status: {e}")
            
            return {
                'success': True,
                'document_id': document_id,
                'processing_time': round(total_time, 2),
                'chunks_processed': len(chunk_texts),
                'property_id': property_id
            }
            
        except Exception as e:
            logger.error(f"❌ Fast pipeline failed: {e}", exc_info=True)
            
            # Update status to failed
            try:
                from .services.document_storage_service import DocumentStorageService
                doc_storage = DocumentStorageService()
                doc_storage.supabase.table('documents').update({
                    'status': 'failed',
                    'metadata_json': {
                        'error': str(e),
                        'failed_at': datetime.utcnow().isoformat(),
                        'processing_method': 'fast_pipeline'
                    }
                }).eq('id', document_id).execute()
                logger.info(f"✅ Updated document status to 'failed'")
            except Exception as update_error:
                logger.error(f"Could not update document status to failed: {update_error}")
            
            # Cleanup temp file
            try:
                if 'temp_file_path' in locals() and temp_file_path and os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
            except:
                pass
            
            raise


# ============================================================================
# LAZY EMBEDDING TASKS (RAG Architecture Upgrade)
# ============================================================================

@shared_task(bind=True, name="embed_chunk_on_demand")
def embed_chunk_on_demand(self, chunk_id: str, document_id: str):
    """
    Embed a single chunk on-demand (triggered by query-time retrieval).
    
    This is called when BM25/hybrid search finds an unembedded chunk.
    High priority task to ensure user queries get embeddings quickly.
    
    Args:
        chunk_id: UUID of the chunk to embed
        document_id: UUID of the document (for metadata)
    """
    try:
        from .services.supabase_client_factory import get_supabase_client
        from .services.vector_service import SupabaseVectorService
        from datetime import datetime
        import json
        
        supabase = get_supabase_client()
        # Use SupabaseVectorService which correctly uses Voyage AI when configured
        vector_service = SupabaseVectorService()
        
        # Fetch chunk data
        result = supabase.table('document_vectors').select('*').eq('id', chunk_id).execute()
        
        if not result.data:
            logger.error(f"Chunk {chunk_id} not found")
            return False
        
        chunk_data = result.data[0]
        
        # Check if already embedded
        if chunk_data.get('embedding') is not None:
            logger.info(f"Chunk {chunk_id} already embedded, skipping")
            return True
        
        # Get chunk text and context
        chunk_text = chunk_data.get('chunk_text', '')
        chunk_context = chunk_data.get('chunk_context', '')
        
        if not chunk_text:
            logger.error(f"Chunk {chunk_id} has no text")
            return False
        
        # Combine context + chunk for embedding
        if chunk_context:
            text_to_embed = f"{chunk_context}\n\n{chunk_text}"
        else:
            text_to_embed = chunk_text
        
        # Update status to 'queued'
        supabase.table('document_vectors').update({
            'embedding_status': 'queued',
            'embedding_queued_at': datetime.utcnow().isoformat()
        }).eq('id', chunk_id).execute()
        
        # Generate embedding using Voyage AI (via SupabaseVectorService)
        try:
            embeddings = vector_service.create_embeddings([text_to_embed])
            embedding = embeddings[0] if embeddings else None
            
            if not embedding:
                raise ValueError("Embedding generation returned empty result")
            
            # Update chunk with embedding
            # Use the actual model name from vector_service (Voyage AI or OpenAI)
            update_data = {
                'embedding': embedding,
                'embedding_status': 'embedded',
                'embedding_completed_at': datetime.utcnow().isoformat(),
                'embedding_model': vector_service.embedding_model,
                'embedding_error': None
            }
            
            supabase.table('document_vectors').update(update_data).eq('id', chunk_id).execute()
            
            logger.info(f"✅ Embedded chunk {chunk_id} (dim: {len(embedding)})")
            return True
            
        except Exception as embed_error:
            # Mark as failed
            error_msg = str(embed_error)[:500]  # Limit error message length
            supabase.table('document_vectors').update({
                'embedding_status': 'failed',
                'embedding_error': error_msg
            }).eq('id', chunk_id).execute()
            
            logger.error(f"Failed to embed chunk {chunk_id}: {embed_error}")
            return False
            
    except Exception as e:
        logger.error(f"Error in embed_chunk_on_demand: {e}")
        import traceback
        traceback.print_exc()
        return False


@shared_task(bind=True, name="embed_document_chunks_lazy")
def embed_document_chunks_lazy(self, document_id: str, priority: str = 'normal'):
    """
    Embed all pending chunks for a document (batch processing).
    
    This is called:
    - During low-priority background indexing
    - When a document is queried and has many unembedded chunks
    - Scheduled batch jobs for warm/cold documents
    
    Args:
        document_id: UUID of the document
        priority: 'high' (user query) or 'normal' (background)
    """
    try:
        from .services.supabase_client_factory import get_supabase_client
        from .services.vector_service import SupabaseVectorService
        from datetime import datetime
        import json
        
        supabase = get_supabase_client()
        # Use SupabaseVectorService which correctly uses Voyage AI when configured
        vector_service = SupabaseVectorService()
        
        # Fetch all pending chunks for this document
        result = supabase.table('document_vectors').select('*').eq(
            'document_id', document_id
        ).in_('embedding_status', ['pending', 'queued']).execute()
        
        if not result.data:
            logger.info(f"No pending chunks for document {document_id}")
            return True
        
        chunks = result.data
        logger.info(f"Embedding {len(chunks)} pending chunks for document {document_id} using {vector_service.embedding_model}")
        
        # Process in batches (Voyage AI can handle 100 chunks per batch)
        batch_size = 100  # Voyage AI batch size
        embedded_count = 0
        failed_count = 0
        
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            
            # Prepare texts for embedding
            texts_to_embed = []
            chunk_ids = []
            
            for chunk_data in batch:
                chunk_text = chunk_data.get('chunk_text', '')
                chunk_context = chunk_data.get('chunk_context', '')
                
                if not chunk_text:
                    continue
                
                # Combine context + chunk (enrich for better embeddings)
                if chunk_context:
                    text_to_embed = f"{chunk_context}\n\n{chunk_text}"
                else:
                    text_to_embed = chunk_text
                
                texts_to_embed.append(text_to_embed)
                chunk_ids.append(chunk_data['id'])
            
            if not texts_to_embed:
                continue
            
            # Mark as queued
            for chunk_id in chunk_ids:
                supabase.table('document_vectors').update({
                    'embedding_status': 'queued',
                    'embedding_queued_at': datetime.utcnow().isoformat()
                }).eq('id', chunk_id).execute()
            
            # Generate embeddings in batch using Voyage AI (via SupabaseVectorService)
            # Rate limiting is handled inside create_embeddings, but we add extra delay between batches here
            try:
                # Add rate limiting delay between batches (20s to stay under 3 RPM)
                if i > 0:  # Don't delay first batch
                    import time
                    wait_time = 20
                    logger.info(f"⏳ Rate limiting: waiting {wait_time}s before batch {i//batch_size + 1}")
                    time.sleep(wait_time)
                
                embeddings = vector_service.create_embeddings(texts_to_embed)
                
                if len(embeddings) != len(chunk_ids):
                    raise ValueError(f"Embedding count mismatch: {len(embeddings)} vs {len(chunk_ids)}")
                
                # Update chunks with embeddings
                # Use the actual model name from vector_service (Voyage AI or OpenAI)
                model_name = vector_service.embedding_model
                
                for chunk_id, embedding in zip(chunk_ids, embeddings):
                    supabase.table('document_vectors').update({
                        'embedding': embedding,
                        'embedding_status': 'embedded',
                        'embedding_completed_at': datetime.utcnow().isoformat(),
                        'embedding_model': model_name,
                        'embedding_error': None
                    }).eq('id', chunk_id).execute()
                
                embedded_count += len(chunk_ids)
                logger.info(f"✅ Embedded batch {i//batch_size + 1} ({len(chunk_ids)} chunks)")
                
            except Exception as batch_error:
                error_msg = str(batch_error)
                # Check if it's a rate limit error
                if "rate limit" in error_msg.lower() or "RPM" in error_msg or "TPM" in error_msg or "payment method" in error_msg.lower():
                    logger.warning(f"⚠️ Voyage API rate limit error in batch {i//batch_size + 1}: {error_msg[:200]}")
                    # Mark chunks as queued (not failed) so they can be retried later
                    import time
                    for chunk_id in chunk_ids:
                        supabase.table('document_vectors').update({
                            'embedding_status': 'queued',  # Keep as queued for retry
                            'embedding_error': f"Rate limit: {error_msg[:200]}"
                        }).eq('id', chunk_id).execute()
                    logger.info(f"⏳ Marked {len(chunk_ids)} chunks as queued for retry after rate limit")
                    failed_count += len(chunk_ids)  # Count as failed for this attempt
                else:
                    # Mark batch as failed for non-rate-limit errors
                    error_msg_short = error_msg[:500]
                for chunk_id in chunk_ids:
                    supabase.table('document_vectors').update({
                        'embedding_status': 'failed',
                            'embedding_error': error_msg_short
                    }).eq('id', chunk_id).execute()
                failed_count += len(chunk_ids)
                logger.error(f"Failed to embed batch {i//batch_size + 1}: {batch_error}")
        
        logger.info(
            f"✅ Completed lazy embedding for document {document_id}: "
            f"{embedded_count} embedded, {failed_count} failed"
        )
        return True
        
    except Exception as e:
        logger.error(f"Error in embed_document_chunks_lazy: {e}")
        import traceback
        traceback.print_exc()
        return False


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
                
                # Handle case where Reducto returns address as dict with 'value' key
                if isinstance(address, dict):
                    address = address.get('value', '')
                
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
                
                # CRITICAL: Check if property already exists with user-set pin location (geocoding_status: 'manual')
                # If property has geocoding_status: 'manual', DO NOT update coordinates from document geocoding
                # Property pin location is immutable after creation - documents added after property creation must NEVER alter it
                # Note: The enhanced_property_matching_service will find existing properties and link documents to them
                # but will not update property coordinates. This ensures user-set pin locations remain fixed.

                # before calling the create document relationship function - check if relationship already exists
                from .services.supabase_property_hub_service import SupabasePropertyHubService
                property_hub_service = SupabasePropertyHubService()

                # Fix: Use .eq() instead of second .select() call
                existing = property_hub_service.supabase.table('document_relationships')\
                    .select('id')\
                    .eq('document_id', str(document_id))\
                    .eq('property_id', str(property_uuids[i]) if i < len(property_uuids) else None)\
                    .execute()
                
                if existing.data:
                    logger.info(f"Property hub {i+1} relationships already exists, skipping creation")
                    continue
                
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

