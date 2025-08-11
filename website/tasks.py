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

# imports for LlamaIndex, LlamaParse, and LlamaExtract
from llama_parse import LlamaParse
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI
from llama_index.program.openai import OpenAIPydanticProgram
from llama_index.vector_stores.astra_db import AstraDBVectorStore
from llama_index.core.storage.storage_context import StorageContext

# --- Pydantic Schema Definition ---
class ComparableProperty(BaseModel):
    """A single comparable property, with all available details extracted."""
    property_address: str = Field(description="Full address of the comparable property, including postcode.")
    property_type: Optional[str] = Field(description="Type of property (e.g., 'Detached House', 'Flat', 'Office').")
    size_sqft: float = Field(description="Total size of the property in square feet.")
    size_unit: Optional[str] = Field(description="Original unit of measurement for 'size_sqft' if conversion occurred.")
    number_bedrooms: Optional[int] = Field(description="Number of bedrooms.")
    number_bathrooms: Optional[int] = Field(description="Number of bathrooms.")
    tenure: Optional[str] = Field(description="Tenure of the property (e.g., 'Freehold', 'Leasehold').")
    listed_building_grade: Optional[str] = Field(description="If the property is a listed building, its grade.")
    transaction_date: Optional[str] = Field(description="Date of the property's last recorded transaction. Format: YYYY-MM-DD.")
    sold_price: float = Field(description="Sold price of the comparable property.")
    asking_price: Optional[float] = Field(description="Asking price of the comparable property.")
    rent_pcm: Optional[float] = Field(description="Monthly rent. Convert annual rent to monthly if necessary.")
    yield_percentage: Optional[float] = Field(description="Investment yield as a percentage.")
    price_per_sqft: Optional[float] = Field(description="Price per square foot.")
    epc_rating: Optional[str] = Field(description="Energy Performance Certificate (EPC) rating.")
    condition: Optional[str] = Field(description="Condition of the property.")
    other_amenities: Optional[str] = Field(description="A comma-separated list of other amenities and features.")
    lease_details: Optional[str] = Field(description="Detailed lease information.")
    days_on_market: Optional[int] = Field(description="Number of days the property was on the market.")
    distance_from_subject: Optional[float] = Field(description="Distance from the subject property in miles.")
    notes: Optional[str] = Field(description="Any additional notes or relevant information.")

class AppraisalData(BaseModel):
    """A model to hold all the comparable properties extracted from a single appraisal document."""
    comparable_properties: List[ComparableProperty]


def get_astra_db_session():
    """Establishes a connection to the AstraDB database and returns a session object."""
    cloud_config = {
        'secure_connect_bundle': os.environ['ASTRA_DB_SECURE_CONNECT_BUNDLE_PATH']
    }
    auth_provider = PlainTextAuthProvider(
        'token',
        os.environ['ASTRA_DB_APPLICATION_TOKEN']
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
    4. Extracts structured data.
    5. Stores data in AstraDB.
    """
    document = Document.query.get(document_id)
    if not document:
        print(f"Document with id {document_id} not found.")
        return

    temp_dir = f"/tmp/{document.id}"
    local_file_path = os.path.join(temp_dir, original_filename)

    try:
        print(f"Starting direct content processing for document_id: {document_id}")
        document.status = DocumentStatus.PROCESSING
        db.session.commit()

        # --- 1. Save received file content to a temporary file ---
        os.makedirs(temp_dir, exist_ok=True)
        with open(local_file_path, 'wb') as f:
            f.write(file_content)
        
        print(f"Successfully saved direct content to {local_file_path}")
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
            doc.metadata["business_id"] = business_id

        # --- 3. Extract structured data ---
        print("--- Starting Pydantic Program for data extraction ---")
        prompt_template_str = (
            "Please extract the comparable properties from the following document. "
            "Look for sections like 'Comparable Evidence', 'Sales Comparables', etc. "
            "and extract all available details for each property listed.\n\n"
            "---------------------\n"
            "{input}\n"
            "---------------------\n"
        )
        program = OpenAIPydanticProgram.from_defaults(
            output_cls=AppraisalData,
            prompt_template_str=prompt_template_str,
            llm=OpenAI(model="gpt-4-turbo", api_key=os.environ['OPENAI_API_KEY']),
            verbose=True,
        )
        extracted_data = program(input=parsed_docs[0].text)
        print(f"Successfully extracted data for {len(extracted_data.comparable_properties)} properties.")
        
        # --- 4. Store structured data in AstraDB (Tabular) ---
        print("--- Connecting to AstraDB to store tabular data ---")
        session = get_astra_db_session()
        keyspace = os.environ['ASTRA_DB_KEYSPACE']
        table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
        
        session.set_keyspace(keyspace)
        
        prepared_insert = session.prepare(
            f"""
            INSERT INTO {table_name} (id, source_document_id, business_id, property_address, property_type, size_sqft, size_unit, number_bedrooms, number_bathrooms, tenure, listed_building_grade, transaction_date, sold_price, asking_price, rent_pcm, yield_percentage, price_per_sqft, epc_rating, condition, other_amenities, lease_details, days_on_market, distance_from_subject, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """
        )

        for prop in extracted_data.comparable_properties:
            session.execute(prepared_insert, (uuid.uuid4(), document.id, business_id, prop.property_address, prop.property_type, prop.size_sqft, prop.size_unit, prop.number_bedrooms, prop.number_bathrooms, prop.tenure, prop.listed_building_grade, prop.transaction_date, prop.sold_price, prop.asking_price, prop.rent_pcm, prop.yield_percentage, prop.price_per_sqft, prop.epc_rating, prop.condition, prop.other_amenities, prop.lease_details, prop.days_on_market, prop.distance_from_subject, prop.notes))
        print(f"Stored {len(extracted_data.comparable_properties)} properties in AstraDB tabular collection.")

        # --- 5. Chunk, embed, and store in Vector DB ---
        print("Initializing AstraDB vector store...")
        astra_db_store = AstraDBVectorStore(
            token=os.environ["ASTRA_DB_APPLICATION_TOKEN"],
            api_endpoint=os.environ["ASTRA_DB_API_ENDPOINT"],
            collection_name=os.environ["ASTRA_DB_VECTOR_COLLECTION_NAME"],
            embedding_dimension=1536,
        )
        index = VectorStoreIndex.from_documents(
            parsed_docs,
            storage_context=StorageContext.from_defaults(vector_store=astra_db_store)
        )
        print("Document chunked, embedded, and stored in vector database.")

        doc_summary = index.docstore.get_document_summary(parsed_docs[0].doc_id)
        document.vector_store_doc_id = doc_summary.doc_id
        
        # --- Finalization ---
        document.status = DocumentStatus.COMPLETED
        db.session.commit()
        print(f"Document processing completed for document_id: {document_id}")

    except Exception as e:
        print(f"Error processing document {document_id}: {e}", file=sys.stderr)
        document.status = DocumentStatus.FAILED
        db.session.commit()
    
    finally:
        # --- Cleanup ---
        # This will run whether the task succeeded or failed.
        if os.path.exists(local_file_path):
            os.remove(local_file_path)
        if os.path.exists(temp_dir):
            os.rmdir(temp_dir)
        print("Cleanup of temporary files completed.") 