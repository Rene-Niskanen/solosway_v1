import os
import boto3
from celery import shared_task
import time
from .models import db, Document, DocumentStatus
from typing import List, Optional
from pydantic import BaseModel, Field
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
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

# Fix for astrapy import issue - patch the missing classes
import astrapy.exceptions as astrapy_exceptions
import astrapy.results as astrapy_results

# Patch missing exception
if not hasattr(astrapy_exceptions, 'InsertManyException'):
    astrapy_exceptions.InsertManyException = astrapy_exceptions.CollectionInsertManyException

# Patch missing result class
if not hasattr(astrapy_results, 'UpdateResult'):
    astrapy_results.UpdateResult = astrapy_results.CollectionUpdateResult

from llama_index.vector_stores.astra_db import AstraDBVectorStore
from llama_index.core.storage.storage_context import StorageContext

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Enhanced Configuration for dual vector store
def get_property_vector_store(business_id: str):
    """Create a separate vector store for individual properties using dedicated AstraDB instance"""
    return AstraDBVectorStore(
        token=os.environ["ASTRA_DB_COMP_APPLICATION_TOKEN"],
        api_endpoint=os.environ["ASTRA_DB_COMP_API_ENDPOINT"],
        collection_name=f"properties_vectorized_{business_id.lower()}",  # Separate collection
        embedding_dimension=1536
    )

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
    
    # Features
    if property_data.get("other_amenities"):
        description_parts.append(f"Amenities: {property_data['other_amenities']}")
    
    if property_data.get("notes"):
        description_parts.append(f"Notes: {property_data['notes']}")
    
    # Location context
    if geocoding_result.get("geocoded_address"):
        description_parts.append(f"Location: {geocoding_result['geocoded_address']}")
    
    return "\n".join(description_parts)

# --- Enhanced JSON Schema Definition ---
ENHANCED_APPRAISAL_JSON_SCHEMA = {
    "additionalProperties": False,
    "description": "A model to hold all comparable properties & subject property and their associated images extracted from an appraisal document. EXCLUDE individual apartment units, flats, or units within the same building.",
    "properties": {
        "all_properties": {
            "items": {
                "additionalProperties": False,
                "description": "CRITICAL: A single STANDALONE property used for comparison or the main subject property. EXCLUDE individual apartments, flats, or units within buildings. Pay special attention to bedroom/bathroom counts which are HIGH PRIORITY fields.",
                "properties": {
                    "property_address": {
                        "description": "Full address of the STANDALONE property, including postcode. Extract complete address like 'Great Barwick Manor, Barwick High Cross, Ware, SG11 1DB'. EXCLUDE addresses with apartment numbers, flat numbers, or unit numbers (e.g., 'Apartment 710', 'Flat 12', 'Unit A').",
                        "type": "string"
                    },
                    "property_type": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Type of property (e.g., 'Detached House', 'Flat', 'Office')."
                    },
                    "size_sqft": {
                        "description": "Total size of the property in square feet. Look for measurements like '4,550 sq ft' or '3,315 ft²'.",
                        "type": "number"
                    },
                    "size_unit": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Original unit of measurement for 'size_sqft' if conversion occurred."
                    },
                    "number_bedrooms": {
                        "anyOf": [
                            {"type": "integer"},
                            {"type": "null"}
                        ],
                        "description": "CRITICAL FIELD Number of bedrooms - HIGH PRIORITY! Search ENTIRE document for: '5 Bed', '3 bedroom', '4-bed', 'X beds'. Look in headers, tables, descriptions everywhere. If you see '5 Bed' extract 5. ALWAYS extract this if visible."
                    },
                    "number_bathrooms": {
                        "anyOf": [
                            {"type": "integer"},
                            {"type": "null"}
                        ],
                        "description": "CRITICAL FIELD Number of bathrooms - HIGH PRIORITY! Search ENTIRE document for: '4 Bath', '2 bathroom', '3-bath', 'X baths'. Look in headers, tables, descriptions everywhere. If you see '4 Bath' extract 4. ALWAYS extract this if visible."
                    },
                    "tenure": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Tenure of the property (e.g., 'Freehold', 'Leasehold')."
                    },
                    "listed_building_grade": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "If the property is a listed building, its grade."
                    },
                    "transaction_date": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Date of the property's last recorded transaction. Format: YYYY-MM-DD."
                    },
                    "sold_date": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Date when the property was sold. Format: YYYY-MM-DD."
                    },
                    "rented_date": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Date when the property was rented. Format: YYYY-MM-DD."
                    },
                    "leased_date": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Date when the property was leased. Format: YYYY-MM-DD."
                    },
                    "sold_price": {
                        "description": "Sold price of the property.",
                        "type": "number"
                    },
                    "asking_price": {
                        "anyOf": [
                            {"type": "number"},
                            {"type": "null"}
                        ],
                        "description": "Asking price of the property."
                    },
                    "rent_pcm": {
                        "anyOf": [
                            {"type": "number"},
                            {"type": "null"}
                        ],
                        "description": "Monthly rent. Convert annual rent to monthly if necessary."
                    },
                    "yield_percentage": {
                        "anyOf": [
                            {"type": "number"},
                            {"type": "null"}
                        ],
                        "description": "Investment yield as a percentage."
                    },
                    "price_per_sqft": {
                        "anyOf": [
                            {"type": "number"},
                            {"type": "null"}
                        ],
                        "description": "Price per square foot."
                    },
                    "epc_rating": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Energy Performance Certificate (EPC) rating."
                    },
                    "condition": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Condition of the property."
                    },
                    "other_amenities": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "A comma-separated list of other amenities and features."
                    },
                    "lease_details": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Detailed lease information."
                    },
                    "days_on_market": {
                        "anyOf": [
                            {"type": "integer"},
                            {"type": "null"}
                        ],
                        "description": "Number of days the property was on the market."
                    },
                    "notes": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ],
                        "description": "Any additional notes or relevant information."
                    },
                },
                "required": [
                    "property_address", "property_type", "size_sqft", "size_unit", 
                    "number_bedrooms", "number_bathrooms", "tenure", "listed_building_grade", 
                    "transaction_date", "sold_date", "rented_date", "leased_date", "sold_price", "asking_price", "rent_pcm", 
                    "yield_percentage", "price_per_sqft", "epc_rating", "condition", 
                    "other_amenities", "lease_details", "days_on_market", "notes"
                ],
                "type": "object"
            },
            "type": "array"
        },
    },
    "required": ["all_properties"],
    "type": "object"
}

def get_astra_db_session():
    """Establishes a connection to the AstraDB tabular database and returns a session object."""
    # Validate secure connect bundle path for tabular database
    bundle_path = os.environ.get('ASTRA_DB_TABULAR_SECURE_CONNECT_BUNDLE_PATH', '').strip()
    if not bundle_path or not os.path.exists(bundle_path):
        raise ValueError(f"AstraDB tabular secure connect bundle not found at: '{bundle_path}'. Please check ASTRA_DB_TABULAR_SECURE_CONNECT_BUNDLE_PATH environment variable.")
    
    cloud_config = {
        'secure_connect_bundle': bundle_path
    }
    auth_provider = PlainTextAuthProvider(
        'token',
        os.environ['ASTRA_DB_TABULAR_APPLICATION_TOKEN']
    )
    cluster = Cluster(cloud=cloud_config, auth_provider=auth_provider)
    return cluster.connect()

@shared_task(bind=True)
def process_document_with_dual_stores(self, document_id, file_content, original_filename, business_id):
    """
    Celery task to process an uploaded document:
    1. Receives file content directly.
    2. Saves content to a temporary file.
    3. Parses with LlamaParse.
    4. Extracts structured data using LlamaExtract.
    5. Stores data in AstraDB.
    """
    from . import create_app
    app = create_app()
    
    with app.app_context():
        document = Document.query.get(document_id)
        if not document:
            print(f"Document with id {document_id} not found.")
            return

        temp_dir = None
        try:
            print(f"Starting direct content processing for document_id: {document_id}")
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
        
            # --- 2. Parse with LlamaParse (with image extraction enabled) ---
            parser = LlamaParse(
                api_key=os.environ['LLAMA_CLOUD_API_KEY'],
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
            reader = SimpleDirectoryReader(input_dir=temp_dir, file_extractor=file_extractor)
            parsed_docs = reader.load_data()
            print("LlamaParse API call completed.")

            # --- Content Validation ---
            has_content = any(doc.text and doc.text.strip() not in ['', 'NO_CONTENT_HERE'] for doc in parsed_docs)
            if not has_content:
                raise ValueError("LlamaParse did not return any meaningful content.")

            # Add business_id to metadata for multi-tenancy
            for doc in parsed_docs:
                doc.metadata["business_id"] = str(business_id)
                doc.metadata["document_id"] = str(document_id)

            # Content validation completed

            # --- 3. Extract structured data using LlamaExtract ---
            print("Initializing LlamaExtract with BALANCED mode...")
            extractor = LlamaExtract(api_key=os.environ['LLAMA_CLOUD_API_KEY'])
            
            config = ExtractConfig(
                extraction_mode=ExtractMode.BALANCED,
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
            
            print("Starting property extraction...")
            
            try:
                result = extractor.extract(ENHANCED_APPRAISAL_JSON_SCHEMA, config, temp_file_path)
                extracted_data = result.data
            except AttributeError as e:
                print(f"Direct extract method not available: {e}")
                print("Falling back to agent-based approach...")
                
                agent_name = "official-solosway-extraction"
                try:
                    agent = extractor.get_agent(name=agent_name)
                    print(f"Using existing agent: {agent_name}")
                except Exception:
                    agent = extractor.create_agent(
                        name=agent_name,
                        data_schema=ENHANCED_APPRAISAL_JSON_SCHEMA,
                        config=config
                    )
                    print(f"Created new enhanced agent: {agent_name}")
                
                result = agent.extract(temp_file_path)
                extracted_data = result.data

            # Data extraction completed successfully

            # Parse extracted data with enhanced structure
            if isinstance(extracted_data, dict):
                all_properties = extracted_data.get('all_properties', [])
            else:
                all_properties = getattr(extracted_data, 'all_properties', [])
            
            print(f"Successfully extracted data for {len(all_properties)} properties.")
            print(f"Successfully extracted {len(all_properties)} properties from document.")

            # --- 4. Image processing (disabled) ---
            print("Image processing disabled (properties only)")
            property_uuids = [uuid.uuid4() for _ in all_properties]
            property_image_mapping = {}
            unassigned_image_paths = []

            # --- 5. Store structured data in AstraDB tabular database ---
            print("Connecting to AstraDB tabular database...")
            session = get_astra_db_session()
            keyspace = os.environ['ASTRA_DB_TABULAR_KEYSPACE']
            table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
            
            session.set_keyspace(keyspace)
            
            # Enhanced insert query with geocoding fields
            insert_query = f"""
            INSERT INTO {table_name} (
                id, source_document_id, business_id, property_address, property_type, 
                size_sqft, size_unit, number_bedrooms, number_bathrooms, tenure, 
                listed_building_grade, transaction_date, sold_date, rented_date, leased_date, sold_price, asking_price, 
                rent_pcm, yield_percentage, price_per_sqft, epc_rating, condition, 
                other_amenities, lease_details, days_on_market, notes,
                latitude, longitude, geocoded_address, geocoding_confidence, geocoding_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            prepared_insert = session.prepare(insert_query)
            
            # Get geocoding results for all properties (reuse from parallel processing)
            addresses = [prop.get('property_address', '') for prop in all_properties]
            geocoding_results = geocode_address_parallel(addresses, max_workers=3)
            geocoding_map = {addr: result for addr, result in geocoding_results}
            
            for i, (prop, property_uuid) in enumerate(zip(all_properties, property_uuids), 1):
                try:
                    # Get S3 image paths for this property
                    property_s3_paths = property_image_mapping.get(str(property_uuid), [])
                    
                    # Get geocoding data for this property
                    address = prop.get('property_address', '')
                    geocoding_result = geocoding_map.get(address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "not_found"})
                    
                    session.execute(prepared_insert, (
                        property_uuid,  # Use the generated UUID
                        document_id,
                        business_id,
                        prop.get('property_address'),
                        prop.get('property_type'),
                        prop.get('size_sqft'),
                        prop.get('size_unit'),
                        prop.get('number_bedrooms'),
                        prop.get('number_bathrooms'),
                        prop.get('tenure'),
                        prop.get('listed_building_grade'),
                        prop.get('transaction_date'),
                        prop.get('sold_date'),        # NEW
                        prop.get('rented_date'),      # NEW
                        prop.get('leased_date'),      # NEW
                        prop.get('sold_price'),
                        prop.get('asking_price'),
                        prop.get('rent_pcm'),
                        prop.get('yield_percentage'),
                        prop.get('price_per_sqft'),
                        prop.get('epc_rating'),
                        prop.get('condition'),
                        prop.get('other_amenities'),
                        prop.get('lease_details'),
                        prop.get('days_on_market'),
                        prop.get('notes'),
                        # Geocoding fields
                        geocoding_result.get('latitude'),
                        geocoding_result.get('longitude'),
                        geocoding_result.get('geocoded_address'),
                        geocoding_result.get('confidence'),
                        geocoding_result.get('status')
                    ))
                    print(f"Property {i} (UUID: {property_uuid}) stored successfully in AstraDB with {len(property_s3_paths)} images.")
                except Exception as e:
                    print(f"Error storing property {i} in AstraDB: {e}")
                    
            print(f"Stored {len(all_properties)} properties in AstraDB tabular collection with image references.")
            print(f"Property UUIDs captured: {[str(uuid) for uuid in property_uuids]}")

            # --- 6. PostgreSQL Storage with Geocoding ---
            print("Storing properties in PostgreSQL with geocoding...")
            from .models import ExtractedProperty
            
            # Geocode all addresses in parallel for much faster processing
            print("🚀 Geocoding addresses in parallel...")
            addresses = [prop.get('property_address', '') for prop in all_properties]
            geocoding_results = geocode_address_parallel(addresses, max_workers=3)
            
            # Create a mapping of address to geocoding result
            geocoding_map = {addr: result for addr, result in geocoding_results}
            
            for i, (prop, property_uuid) in enumerate(zip(all_properties, property_uuids), 1):
                try:
                    # Get the geocoding result from our parallel processing
                    address = prop.get('property_address', '')
                    geocoding_result = geocoding_map.get(address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "not_found"})
                    
                    # Create property document for embedding
                    property_document = create_property_document(prop, geocoding_result)
                    
                    # Create ExtractedProperty record
                    extracted_property = ExtractedProperty(
                        id=property_uuid,
                        property_address=prop.get('property_address'),
                        property_type=prop.get('property_type'),
                        number_bedrooms=prop.get('number_bedrooms'),
                        number_bathrooms=prop.get('number_bathrooms'),
                        size_sqft=prop.get('size_sqft'),
                        size_unit=prop.get('size_unit'),
                        asking_price=prop.get('asking_price'),
                        sold_price=prop.get('sold_price'),
                        price_per_sqft=prop.get('price_per_sqft'),
                        rent_pcm=prop.get('rent_pcm'),
                        yield_percentage=prop.get('yield_percentage'),
                        condition=prop.get('condition'),
                        tenure=prop.get('tenure'),
                        lease_details=prop.get('lease_details'),
                        days_on_market=prop.get('days_on_market'),
                        transaction_date=prop.get('transaction_date'),
                        sold_date=prop.get('sold_date'),        # NEW
                        rented_date=prop.get('rented_date'),    # NEW
                        leased_date=prop.get('leased_date'),    # NEW
                        epc_rating=prop.get('epc_rating'),
                        listed_building_grade=prop.get('listed_building_grade'),
                        other_amenities=prop.get('other_amenities'),
                        notes=prop.get('notes'),
                        source_document_id=document_id,
                        business_id=business_id,
                        # Geocoding fields
                        latitude=geocoding_result.get('latitude'),
                        longitude=geocoding_result.get('longitude'),
                        geocoded_address=geocoding_result.get('geocoded_address'),
                        geocoding_confidence=geocoding_result.get('confidence'),
                        geocoding_status=geocoding_result.get('status')
                    )
                    
                    db.session.add(extracted_property)
                    print(f"Property {i} (UUID: {property_uuid}) added to PostgreSQL with geocoding: {geocoding_result.get('status')}")
                    
                except Exception as e:
                    print(f"Error storing property {i} in PostgreSQL: {e}")
                    continue
            
            # Commit all PostgreSQL changes
            try:
                db.session.commit()
                print(f"Successfully committed {len(all_properties)} properties to PostgreSQL")
            except Exception as e:
                print(f"Error committing to PostgreSQL: {e}")
                db.session.rollback()

            # --- 7. Vector Processing with Property UUID Linking ---
            print("Initializing vector processing...")
            print(f"Vector API Endpoint: {os.environ['ASTRA_DB_VECTOR_API_ENDPOINT']}")

            # Set up the embedding model to match 1536 dimensions
            embed_model = OpenAIEmbedding(
                model="text-embedding-ada-002",
                api_key=os.environ["OPENAI_API_KEY"],
            )
            print("Using embedding model: text-embedding-ada-002")
            
            # Enhance document metadata with property UUIDs
            print("Enhancing document metadata with property relationships...")
            for doc in parsed_docs:
                # Add comprehensive metadata linking to extracted properties
                doc.metadata.update({
                    "business_id": str(business_id),
                    "document_id": str(document_id),
                    "related_property_uuids": ",".join([str(uuid) for uuid in property_uuids]),
                    "property_count": len(all_properties),
                    "document_type": "appraisal_report",
                    "property_addresses": ",".join([prop.get('property_address', '') for prop in all_properties])
                })
            
            print(f"Enhanced metadata for {len(parsed_docs)} document chunks with {len(property_uuids)} property UUIDs")
            
            astra_db_store = AstraDBVectorStore(
                token=os.environ["ASTRA_DB_VECTOR_APPLICATION_TOKEN"],  
                api_endpoint=os.environ["ASTRA_DB_VECTOR_API_ENDPOINT"], 
                collection_name=os.environ["ASTRA_DB_VECTOR_COLLECTION_NAME"], 
                embedding_dimension=1536  
            )
            print("VectorDB initialised successfully")
            
            storage_context = StorageContext.from_defaults(vector_store=astra_db_store)
            
            print(f"About to process {len(parsed_docs)} enhanced documents for embedding...")
            index = VectorStoreIndex.from_documents(
                parsed_docs,
                storage_context=storage_context,
                embed_model=embed_model
            )
            print("Document chunked, embedded, and stored in vector database with enhanced property metadata.")
            print(f"Vector store index created successfully with property UUID linking")

            # --- 8. Property Vector Store Processing (Separate AstraDB Instance) ---
            print("Processing individual properties for property vector store...")
            try:
                property_vector_store = get_property_vector_store(business_id)
                property_storage_context = StorageContext.from_defaults(vector_store=property_vector_store)
                
                property_documents = []
                for i, (prop, property_uuid) in enumerate(zip(all_properties, property_uuids), 1):
                    try:
                        # Use the already computed geocoding result from parallel processing
                        address = prop.get('property_address', '')
                        geocoding_result = geocoding_map.get(address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "not_found"})
                        
                        # Create property document
                        property_document = create_property_document(prop, geocoding_result)
                        
                        # Create LlamaIndex document
                        from llama_index.core import Document as LlamaDocument
                        property_doc = LlamaDocument(
                            text=property_document,
                            metadata={
                                "property_uuid": str(property_uuid),
                                "property_address": prop.get('property_address', ''),
                                "property_type": prop.get('property_type', ''),
                                "business_id": business_id,
                                "source_document_id": document_id,
                                "latitude": geocoding_result.get('latitude'),
                                "longitude": geocoding_result.get('longitude'),
                                "geocoded_address": geocoding_result.get('geocoded_address'),
                                "geocoding_confidence": geocoding_result.get('confidence'),
                                "geocoding_status": geocoding_result.get('status'),
                                "asking_price": prop.get('asking_price'),
                                "sold_price": prop.get('sold_price'),
                                "size_sqft": prop.get('size_sqft'),
                                "number_bedrooms": prop.get('number_bedrooms'),
                                "number_bathrooms": prop.get('number_bathrooms'),
                                "transaction_date": prop.get('transaction_date'),
                                "sold_date": prop.get('sold_date'),        # NEW
                                "rented_date": prop.get('rented_date'),    # NEW
                                "leased_date": prop.get('leased_date')     # NEW
                            }
                        )
                        property_documents.append(property_doc)
                        print(f"Property {i} prepared for vector embedding")
                        
                    except Exception as e:
                        print(f"Error preparing property {i} for vector store: {e}")
                        continue
                
                if property_documents:
                    print(f"Creating property vector store with {len(property_documents)} properties...")
                    print("⚠️  This may take a few minutes for large property sets...")
                    
                    # Process properties in smaller batches to avoid timeouts
                    batch_size = 5
                    total_batches = (len(property_documents) + batch_size - 1) // batch_size
                    
                    for batch_num in range(total_batches):
                        start_idx = batch_num * batch_size
                        end_idx = min(start_idx + batch_size, len(property_documents))
                        batch_docs = property_documents[start_idx:end_idx]
                        
                        print(f"Processing batch {batch_num + 1}/{total_batches} ({len(batch_docs)} properties)...")
                        
                        try:
                            # Create property vector index for this batch
                            property_index = VectorStoreIndex.from_documents(
                                batch_docs,
                                storage_context=property_storage_context,
                                embed_model=embed_model
                            )
                            print(f"✅ Batch {batch_num + 1} processed successfully")
                            
                            # Small delay between batches to avoid overwhelming the API
                            if batch_num < total_batches - 1:
                                time.sleep(2)
                                
                        except Exception as batch_error:
                            print(f"❌ Error processing batch {batch_num + 1}: {batch_error}")
                            continue
                    
                    print(f"🎉 Property vector store processing completed!")
                else:
                    print("No properties were prepared for vector storage")
                    
            except Exception as e:
                print(f"Error creating property vector store: {e}")
                print(f"Error details: {type(e).__name__}: {str(e)}")

            # Check if document still exists before updating status
            document = Document.query.get(document_id)
            if document:
                document.status = DocumentStatus.COMPLETED
                db.session.commit()
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

@shared_task(bind=True)
def process_document_task(self, document_id, file_content, original_filename, business_id):
    """
    Legacy wrapper function that calls the new dual-store pipeline
    """
    return process_document_with_dual_stores.run(document_id, file_content, original_filename, business_id)

def get_s3_client():
    """Get S3 client with AWS credentials"""
    return boto3.client(
        's3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
    )

def store_extracted_properties_in_astradb_tabular(extracted_data, business_id, document_id, property_uuids):
    """Store extracted properties in AstraDB tabular database"""
    try:
        session = get_astra_db_session()
        keyspace = os.environ['ASTRA_DB_TABULAR_KEYSPACE']
        table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
        
        session.set_keyspace(keyspace)
        
        # Insert query with geocoding fields
        insert_query = f"""
        INSERT INTO {table_name} (
            id, source_document_id, business_id, property_address, property_type, 
            size_sqft, size_unit, number_bedrooms, number_bathrooms, tenure, 
            listed_building_grade, transaction_date, sold_date, rented_date, leased_date, sold_price, asking_price, 
            rent_pcm, yield_percentage, price_per_sqft, epc_rating, condition, 
            other_amenities, lease_details, days_on_market, notes,
            latitude, longitude, geocoded_address, geocoding_confidence, geocoding_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        prepared_insert = session.prepare(insert_query)
        
        if extracted_data and extracted_data.get("all_properties"):
            properties = extracted_data["all_properties"]
            
            # Get geocoding results for all properties
            addresses = [prop.get('property_address', '') for prop in properties]
            geocoding_results = geocode_address_parallel(addresses, max_workers=3)
            geocoding_map = {addr: result for addr, result in geocoding_results}
            
            for prop, property_uuid in zip(properties, property_uuids):
                try:
                    # Get geocoding data for this property
                    address = prop.get('property_address', '')
                    geocoding_result = geocoding_map.get(address, {"latitude": None, "longitude": None, "confidence": 0.0, "status": "not_found"})
                    
                    session.execute(prepared_insert, (
                        property_uuid,
                        document_id,
                        business_id,
                        prop.get('property_address'),
                        prop.get('property_type'),
                        prop.get('size_sqft'),
                        prop.get('size_unit'),
                        prop.get('number_bedrooms'),
                        prop.get('number_bathrooms'),
                        prop.get('tenure'),
                        prop.get('listed_building_grade'),
                        prop.get('transaction_date'),
                        prop.get('sold_date'),        # NEW
                        prop.get('rented_date'),      # NEW
                        prop.get('leased_date'),      # NEW
                        prop.get('sold_price'),
                        prop.get('asking_price'),
                        prop.get('rent_pcm'),
                        prop.get('yield_percentage'),
                        prop.get('price_per_sqft'),
                        prop.get('epc_rating'),
                        prop.get('condition'),
                        prop.get('other_amenities'),
                        prop.get('lease_details'),
                        prop.get('days_on_market'),
                        prop.get('notes'),
                        # Geocoding fields
                        geocoding_result.get('latitude'),
                        geocoding_result.get('longitude'),
                        geocoding_result.get('geocoded_address'),
                        geocoding_result.get('confidence'),
                        geocoding_result.get('status')
                    ))
                except Exception as e:
                    logger.error(f"Error storing property in AstraDB tabular: {e}")
                    
        logger.info(f"Stored {len(property_uuids)} properties in AstraDB tabular")
        
    except Exception as e:
        logger.error(f"Error in store_extracted_properties_in_astradb_tabular: {e}")
