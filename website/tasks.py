import os
import boto3
from celery import shared_task
import time
from .models import db, Document, DocumentStatus
from typing import List, Optional
from pydantic import BaseModel, Field
import cassandra
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
import uuid
from pprint import pprint
import requests
from requests_aws4auth import AWS4Auth
import sys
import tempfile
import shutil

# imports for LlamaIndex, LlamaParse, and LlamaExtract
from llama_parse import LlamaParse
from llama_cloud_services import LlamaExtract
from llama_cloud import ExtractConfig, ExtractMode, ExtractTarget
from llama_cloud_services.extract import SourceText
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI
from llama_index.vector_stores.astra_db import AstraDBVectorStore
from llama_index.core.storage.storage_context import StorageContext

# --- JSON Schema Definition (instead of Pydantic for better LlamaExtract compatibility) ---
APPRAISAL_JSON_SCHEMA = {
    "additionalProperties": False,
    "description": "A model to hold all the comparable properties extracted from a single appraisal document.",
    "properties": {
        "comparable_properties": {
            "items": {
                "additionalProperties": False,
                "description": "CRITICAL: A single comparable property, with all available details extracted. Pay special attention to bedroom/bathroom counts which are HIGH PRIORITY fields.",
                "properties": {
                    "property_address": {
                        "description": "Full address of the comparable property, including postcode. Extract complete address like 'Great Barwick Manor, Barwick High Cross, Ware, SG11 1DB'.",
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
                    "sold_price": {
                        "description": "Sold price of the comparable property.",
                        "type": "number"
                    },
                    "asking_price": {
                        "anyOf": [
                            {"type": "number"},
                            {"type": "null"}
                        ],
                        "description": "Asking price of the comparable property."
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
                    }
                },
                "required": [
                    "property_address", "property_type", "size_sqft", "size_unit", 
                    "number_bedrooms", "number_bathrooms", "tenure", "listed_building_grade", 
                    "transaction_date", "sold_price", "asking_price", "rent_pcm", 
                    "yield_percentage", "price_per_sqft", "epc_rating", "condition", 
                    "other_amenities", "lease_details", "days_on_market", 
                    "notes"
                ],
                "type": "object"
            },
            "type": "array"
        }
    },
    "required": ["comparable_properties"],
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
def process_document_task(self, document_id, file_content, original_filename, business_id):
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
            temp_file_path = os.path.join(temp_dir, original_filename)
            with open(temp_file_path, 'wb') as f:
                f.write(file_content)
            
            print(f"Successfully saved direct content to {temp_file_path}")
            print(f"Processing document for business_id: {business_id}")
        
            # --- 2. Parse with LlamaParse ---
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

            # --- DEBUG: Print the full parsed markdown ---
            print("--- Full Parsed Markdown Content ---")
            print(parsed_docs[0].text)
            print("--- End of Markdown Content ---")

            # --- 3. Extract structured data using LlamaExtract (Stateless API) ---
            print("--- Initializing LlamaExtract client with BALANCED MODE ---")
            extractor = LlamaExtract(api_key=os.environ['LLAMA_CLOUD_API_KEY'])
            
            # Configure Balanced mode for good accuracy with API efficiency
            config = ExtractConfig(
                extraction_mode=ExtractMode.BALANCED,  # Good accuracy with lower API usage
                extraction_target=ExtractTarget.PER_DOC,  # Extract from entire document
                high_resolution_mode=True,  # Better OCR for small text (bedroom/bathroom counts)
                cite_sources=True,  # Track where data came from
                use_reasoning=False,  # Get explanations for extraction decisions
                confidence_scores=False,  # Not available in BALANCED mode
                system_prompt="Focus on extracting property comparable sales data with high precision. Pay special attention to bedroom and bathroom counts, property addresses, and transaction details. Look for patterns like '5 Bed', '4 Bath', etc."
            )
            
            print("--- Starting BALANCED data extraction (stateless API) ---")
            print(f"Balanced Mode: Lower API usage with good accuracy")
            print(f"High Resolution OCR: Better detection of small text")
            print(f"Source Citations: Track where data came from")
            
            # Use stateless extraction with raw document for best results
            # Based on GitHub docs: https://github.com/llamaindex/llamacloud-python/tree/main/docs/examples
            try:
                # Try the stateless API approach from GitHub docs with JSON schema
                result = extractor.extract(APPRAISAL_JSON_SCHEMA, config, temp_file_path)
                extracted_data = result.data
            except AttributeError as e:
                print(f"Direct extract method not available: {e}")
                print("Falling back to agent-based approach...")
                
                # Fallback: Use agent-based approach with JSON schema for better integer support
                agent_name = f"appraisal-extractor-{business_id}-json"
                try:
                    # Try to get existing agent first
                    agent = extractor.get_agent(name=agent_name)
                    print(f"Using existing Premium JSON agent: {agent_name}")
                except Exception:
                    # Create new agent if it doesn't exist with JSON schema
                    agent = extractor.create_agent(
                        name=agent_name,
                        data_schema=APPRAISAL_JSON_SCHEMA,
                        config=config
                    )
                    print(f"Created new Premium JSON agent: {agent_name}")
                
                result = agent.extract(temp_file_path)
                extracted_data = result.data
            
            # COMMENTED OUT: Original parsed text approach
            # # Use SourceText to pass text content directly instead of file path
            # try:
            #     from llama_cloud_services import SourceText
            #     source = SourceText(text_content=full_text)
            #     result = agent.extract(source)
            #     extracted_data = result.data
            # except ImportError:
            #     # Fallback: try alternative import or method
            #     print("SourceText not available, trying direct text extraction...")
            #     # Create a temporary file with the text content
            #     with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as temp_file:
            #         temp_file.write(full_text)
            #         temp_file_path = temp_file.name
            #     
            #     result = agent.extract(temp_file_path)
            #     # Clean up the temporary file
            #     os.unlink(temp_file_path)
            #     extracted_data = result.data

            # --- DEBUG: Print the extracted data object ---
            print("--- Extracted Data Object ---")
            pprint(extracted_data)
            print("--- End of Extracted Data ---")

            # Handle both dictionary and Pydantic model responses
            if isinstance(extracted_data, dict):
                comparable_properties = extracted_data.get('comparable_properties', [])
            else:
                comparable_properties = extracted_data.comparable_properties
            
            print(f"Successfully extracted data for {len(comparable_properties)} properties.")
            
            # --- 4. Store structured data in AstraDB (Tabular) ---
            print("--- Connecting to AstraDB tabular database ---")
            session = get_astra_db_session()
            keyspace = os.environ['ASTRA_DB_TABULAR_KEYSPACE']
            table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
            
            session.set_keyspace(keyspace)
            
            prepared_insert = session.prepare(
                f"""
                INSERT INTO {table_name} (id, source_document_id, business_id, property_address, property_type, size_sqft, size_unit, number_bedrooms, number_bathrooms, tenure, listed_building_grade, transaction_date, sold_price, asking_price, rent_pcm, yield_percentage, price_per_sqft, epc_rating, condition, other_amenities, lease_details, days_on_market, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """
            )
            
            # Handle dictionary format (current extraction returns dict)
            for i, prop in enumerate(comparable_properties):
                try:
                    prop_address = prop.get('property_address')
                    prop_type = prop.get('property_type')
                    size_sqft = prop.get('size_sqft')
                    size_unit = prop.get('size_unit')
                    bedrooms = prop.get('number_bedrooms')
                    bathrooms = prop.get('number_bathrooms')
                    tenure = prop.get('tenure')
                    listed_grade = prop.get('listed_building_grade')
                    transaction_date = prop.get('transaction_date')
                    sold_price = prop.get('sold_price')
                    asking_price = prop.get('asking_price')
                    rent_pcm = prop.get('rent_pcm')
                    yield_pct = prop.get('yield_percentage')
                    price_per_sqft = prop.get('price_per_sqft')
                    epc_rating = prop.get('epc_rating')
                    condition = prop.get('condition')
                    amenities = prop.get('other_amenities')
                    lease_details = prop.get('lease_details')
                    days_on_market = prop.get('days_on_market')
                    notes = prop.get('notes')
                    
                    session.execute(prepared_insert, (uuid.uuid4(), document.id, business_id, prop_address, prop_type, size_sqft, size_unit, bedrooms, bathrooms, tenure, listed_grade, transaction_date, sold_price, asking_price, rent_pcm, yield_pct, price_per_sqft, epc_rating, condition, amenities, lease_details, days_on_market, notes))
                    print(f"Property {i+1} stored successfully in AstraDB.")
                except Exception as e:
                    print(f"Error storing property {i+1} in AstraDB: {e}")
                    
            print(f"Stored {len(comparable_properties)} properties in AstraDB tabular collection.")

            # --- 5. Chunk, embed, and store in Vector DB ---
            print("Initializing AstraDB vector store...")
            astra_db_store = AstraDBVectorStore(
                token=os.environ["ASTRA_DB_VECTOR_APPLICATION_TOKEN"],
                api_endpoint=os.environ["ASTRA_DB_VECTOR_API_ENDPOINT"],
                collection_name=os.environ["ASTRA_DB_VECTOR_COLLECTION_NAME"],
                embedding_dimension=1536,
            )
            index = VectorStoreIndex.from_documents(
                parsed_docs,
                storage_context=StorageContext.from_defaults(vector_store=astra_db_store)
            )
            print("Document chunked, embedded, and stored in vector database.")
            
            # --- Finalization ---
            document.status = DocumentStatus.COMPLETED
            db.session.commit()
            print(f"Document processing completed for document_id: {document_id}")

        except Exception as e:
            print(f"Error processing document {document_id}: {e}", file=sys.stderr)
            if document:
                document.status = DocumentStatus.FAILED
                db.session.commit()
        
        finally:
            # --- Cleanup ---
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                print("Cleanup of temporary files completed.") 