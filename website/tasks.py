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

# imports for LlamaIndex, LlamaParse, and LlamaExtract
from llama_parse import LlamaParse
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI
from llama_index.program.openai import OpenAIPydanticProgram
from llama_index.vector_stores.astra_db import AstraDBVectorStore
from llama_index.core.storage.storage_context import StorageContext

# --- Pydantic Schema Definition ---
# This is the Python representation of the JSON schema you created.
# It defines the structure for the data we want to extract from the documents.

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
    4. (Future steps: Extract, Store, etc.)
    """
    document = Document.query.get(document_id)
    if not document:
        print(f"Document with id {document_id} not found.")
        return

    try:
        print(f"Starting direct content processing for document_id: {document_id}")
        document.status = DocumentStatus.PROCESSING
        db.session.commit()

        # --- 1. Save received file content to a temporary file ---
        # This completely bypasses the need to download from S3 for parsing.
        temp_dir = f"/tmp/{document.id}"
        os.makedirs(temp_dir, exist_ok=True)
        local_file_path = os.path.join(temp_dir, original_filename)

        with open(local_file_path, 'wb') as f:
            f.write(file_content)
        
        print(f"Successfully saved direct content to {local_file_path}")
        print(f"Processing document for business_id: {business_id}")

        # --- 2. Parse with LlamaParse using the robust SimpleDirectoryReader method ---
        parser = LlamaParse(
            api_key=os.environ['LLAMA_CLOUD_API_KEY'],
            result_type="markdown", # Let's try markdown again, as this is the preferred format
            verbose=True
        )

        # Use SimpleDirectoryReader, pointing it to the directory containing the file.
        file_extractor = {".pdf": parser}
        reader = SimpleDirectoryReader(input_dir=temp_dir, file_extractor=file_extractor)
        
        # This is the correct, robust way to load the data
        parsed_docs = reader.load_data()
        print("LlamaParse API call completed via SimpleDirectoryReader.")

        # --- Enhanced Logging & Inspection ---
        print(f"LlamaParse returned {len(parsed_docs)} document chunks.")

        has_content = False
        for i, doc in enumerate(parsed_docs):
            print(f"--- Chunk {i+1}/{len(parsed_docs)} ---")
            pprint(f"Metadata: {doc.metadata}")
            
            # ALWAYS print the raw content for debugging, no matter what it is.
            print("Raw content: (first 200 chars)")
            pprint(doc.text[:200])

            # Still check for content to decide if the task succeeded.
            if doc.text and doc.text.strip() not in ['', 'NO_CONTENT_HERE']:
                has_content = True
            print("--------------------")

        # --- For testing, we stop here to verify parsing ---
        if not has_content:
            print("Stopping processing: LlamaParse did not return any meaningful content.")
            document.status = DocumentStatus.FAILED
        else:
            document.status = DocumentStatus.COMPLETED
            print(f"Document processing (parsing only) completed for document_id: {document_id}")

        db.session.commit()
        
        # Clean up the temporary file and directory
        os.remove(local_file_path)
        os.rmdir(temp_dir)
        return # Stop execution here for now to isolate parsing.


        # Add the business_id to the metadata of each parsed document chunk.
        # This is crucial for multi-tenancy filtering during queries.
        for doc in parsed_docs:
            doc.metadata["business_id"] = business_id

        # --- 3. Extract structured data (Corrected Implementation) ---
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
        
        # Now call the program with the input
        extracted_data = program(input=parsed_docs[0].text)
        print(f"Successfully extracted data for {len(extracted_data.comparable_properties)} properties.")
        
        # --- Print the extracted data for testing ---
        print("--- EXTRACTED DATA (for testing) ---")
        pprint(extracted_data.dict())
        print("------------------------------------")

        # --- 4. Store structured data in AstraDB (Tabular) ---
        # This section is temporarily commented out for testing purposes.
        # session = get_astra_db_session()
        # keyspace = os.environ['ASTRA_DB_KEYSPACE']
        # table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
        #
        # # Ensure keyspace and table exist (this is idempotent)
        # session.execute(f"""
        #     CREATE KEYSPACE IF NOT EXISTS {keyspace} 
        #     WITH replication = {{'class': 'SimpleStrategy', 'replication_factor': '1'}}
        # """)
        # session.set_keyspace(keyspace)
        # 
        # # Create table with a schema that matches the Pydantic model
        # session.execute(f"""
        #     CREATE TABLE IF NOT EXISTS {table_name} (
        #         id UUID PRIMARY KEY,
        #         source_document_id INT,
        #         business_id TEXT, # Added for multi-tenancy
        #         property_address TEXT,
        #         property_type TEXT,
        #         size_sqft FLOAT,
        #         size_unit TEXT,
        #         number_bedrooms INT,
        #         number_bathrooms INT,
        #         tenure TEXT,
        #         listed_building_grade TEXT,
        #         transaction_date TEXT,
        #         sold_price FLOAT,
        #         asking_price FLOAT,
        #         rent_pcm FLOAT,
        #         yield_percentage FLOAT,
        #         price_per_sqft FLOAT,
        #         epc_rating TEXT,
        #         condition TEXT,
        #         other_amenities TEXT,
        #         lease_details TEXT,
        #         days_on_market INT,
        #         distance_from_subject FLOAT,
        #         notes TEXT
        #     );
        # """)
        #
        # # Insert each extracted property into the table
        # for prop in extracted_data.comparable_properties:
        #     session.execute(
        #         f"""
        #         INSERT INTO {table_name} (id, source_document_id, business_id, property_address, property_type, size_sqft, size_unit, number_bedrooms, number_bathrooms, tenure, listed_building_grade, transaction_date, sold_price, asking_price, rent_pcm, yield_percentage, price_per_sqft, epc_rating, condition, other_amenities, lease_details, days_on_market, distance_from_subject, notes)
        #         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        #         """,
        #         (uuid.uuid4(), document.id, business_id, prop.property_address, prop.property_type, prop.size_sqft, prop.size_unit, prop.number_bedrooms, prop.number_bathrooms, prop.tenure, prop.listed_building_grade, prop.transaction_date, prop.sold_price, prop.asking_price, prop.rent_pcm, prop.yield_percentage, prop.price_per_sqft, prop.epc_rating, prop.condition, prop.other_amenities, prop.lease_details, prop.days_on_market, prop.distance_from_subject, prop.notes)
        #     )
        # print(f"Stored {len(extracted_data.comparable_properties)} properties in AstraDB tabular collection.")

        # --- 5. Chunk, embed, and store in Vector DB ---
        print("Initializing AstraDB vector store...")
        astra_db_store = AstraDBVectorStore(
            token=os.environ["ASTRA_DB_APPLICATION_TOKEN"],
            api_endpoint=os.environ["ASTRA_DB_API_ENDPOINT"],
            collection_name=os.environ["ASTRA_DB_VECTOR_COLLECTION_NAME"],
            embedding_dimension=1536, # OpenAI's text-embedding-ada-002 uses 1536 dimensions
        )

        print("Creating LlamaIndex VectorStoreIndex...")
        index = VectorStoreIndex.from_documents(
            parsed_docs,
            storage_context=StorageContext.from_defaults(vector_store=astra_db_store)
        )
        print("Document chunked, embedded, and stored in vector database.")

        # After indexing, get the document summary and store the vector store's doc_id
        doc_summary = index.docstore.get_document_summary(parsed_docs[0].doc_id)
        document.vector_store_doc_id = doc_summary.doc_id
        db.session.commit()
        print(f"Stored vector store doc_id: {doc_summary.doc_id}")
        
        # --- Finalization ---
        os.remove(local_file_path)
        os.rmdir(temp_dir)
        
        document.status = DocumentStatus.COMPLETED
        db.session.commit()
        print(f"Document processing completed for document_id: {document_id}")

    except Exception as e:
        print(f"Error processing document {document_id}: {e}")
        document.status = DocumentStatus.FAILED
        db.session.commit()
        # We don't retry during this debug test
        # raise self.retry(exc=e, countdown=60, max_retries=0) 
    