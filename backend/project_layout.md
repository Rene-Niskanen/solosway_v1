# Backend Project Layout Documentation

This document provides a comprehensive overview of every file in the backend directory, explaining its purpose and when to modify it.

## Table of Contents

- [Root Level Files](#root-level-files)
- [Services Directory](#services-directory)
- [LLM Directory](#llm-directory)
- [Models Directory](#models-directory)
- [Static Directory](#static-directory)

---

## Root Level Files

### `__init__.py`
**Purpose**: Flask application factory and initialization
- Creates and configures the Flask app
- Sets up database connections (Supabase PostgreSQL)
- Configures CORS for React frontend
- Initializes Celery for async task processing
- Registers blueprints (views, auth, admin)
- Sets up Flask-Login for authentication
- **When to modify**: When changing app configuration, adding new blueprints, or modifying CORS settings

### `config.py`
**Purpose**: Application configuration and environment variables
- Database connection settings (Supabase)
- SQLAlchemy connection pool configuration
- CORS allowed origins
- Session configuration
- File upload limits
- **When to modify**: When changing database settings, CORS origins, or adding new environment variables

### `models.py`
**Purpose**: SQLAlchemy database models (legacy - some models moved to Supabase)
- User model with roles and status
- Document model with processing status
- DocumentRelationship model
- PropertyCardCache model
- Enums: UserStatus, UserRole, DocumentStatus
- **When to modify**: When changing database schema (though most schema is now managed by Supabase migrations)

### `views.py`
**Purpose**: Main API endpoints and Flask routes (4,729 lines - largest file)
- Health check endpoints (`/api/health`)
- Document upload endpoints (`/api/documents/upload`, `/api/documents/proxy-upload`)
- Document query endpoints (`/api/llm/query`, `/api/llm/query/stream`)
- Property management endpoints (`/api/properties/*`)
- File management endpoints (`/api/files/*`)
- Dashboard endpoints (`/api/dashboard`)
- Agent status endpoints (`/api/agents/status/*`)
- **When to modify**: When adding new API endpoints, modifying request/response formats, or changing route logic

### `tasks.py`
**Purpose**: Celery async task definitions for document processing (3,047 lines)
- `process_document_classification`: Step 1 - Classify document type
- `process_document_minimal_extraction`: Step 2 - Extract minimal data
- `process_document_with_dual_stores`: Main extraction pipeline
- `process_document_fast_task`: Fast pipeline for property card uploads
- Helper functions for bbox extraction, page number extraction, property cleaning
- **When to modify**: When changing document processing pipeline, adding new processing steps, or modifying extraction logic

### `auth.py`
**Purpose**: Authentication and user management routes
- Login/logout endpoints
- User registration
- Password reset
- Business UUID management
- Supabase authentication integration
- **When to modify**: When changing authentication logic, adding new auth endpoints, or modifying user management

### `admin.py`
**Purpose**: Admin panel routes and user invitation system
- User invitation endpoints (`/api/admin/invite-user`)
- Admin panel routes
- User management
- **When to modify**: When adding admin features or changing invitation system

### `celery_utils.py`
**Purpose**: Celery initialization and Flask integration
- Creates Celery app with Flask context
- Configures Celery task execution
- **When to modify**: When changing Celery configuration or task execution settings

### `decorators.py`
**Purpose**: Custom Flask decorators
- `admin_required`: Decorator to restrict routes to admin users
- **When to modify**: When adding new decorators or changing permission logic

---

## Services Directory

The services directory contains all business logic and external service integrations.

### Core Services

#### `supabase_client_factory.py`
**Purpose**: Factory for creating Supabase client instances
- Manages Supabase connection pooling
- Provides database URL for SQLAlchemy
- **When to modify**: When changing Supabase connection settings

#### `supabase_auth_service.py`
**Purpose**: Supabase authentication service
- User authentication
- User CRUD operations
- Business UUID management
- **When to modify**: When changing authentication logic or user management

#### `supabase_document_service.py`
**Purpose**: Document operations in Supabase
- Document CRUD operations
- Document status management
- **When to modify**: When changing document storage or retrieval logic

#### `document_storage_service.py`
**Purpose**: High-level document storage abstraction
- Stores documents in Supabase
- Manages document_summary JSONB field
- Handles document metadata merging
- **When to modify**: When changing how documents are stored or when modifying document_summary structure

#### `vector_service.py`
**Purpose**: Vector embedding and storage service (1,328 lines)
- Generates embeddings using OpenAI
- Stores vectors in Supabase `document_vectors` table
- Handles chunk splitting with bbox preservation
- Maps sub-chunks to blocks for accurate bbox assignment
- Document-level contextualization
- **When to modify**: When changing embedding models, chunking strategy, or bbox mapping logic

### Document Processing Services

#### `reducto_service.py`
**Purpose**: Reducto API integration for document parsing
- Parses documents with Reducto
- Extracts chunks with bbox metadata
- Handles Reducto job_id management
- **When to modify**: When changing Reducto API usage or parsing settings

#### `reducto_image_service.py`
**Purpose**: Image extraction and processing from Reducto
- Downloads images from Reducto URLs
- Filters images based on metadata
- Uploads images to S3
- **When to modify**: When changing image processing logic or S3 upload settings

#### `classification_service.py`
**Purpose**: Document classification service
- Classifies document types (valuation_report, lease, etc.)
- Uses LLM for classification
- **When to modify**: When adding new document types or changing classification logic

#### `extraction_service.py`
**Purpose**: Structured data extraction from documents
- Extracts property data using LLM
- Uses extraction schemas
- **When to modify**: When changing extraction logic or adding new extraction fields

#### `extraction_schemas.py`
**Purpose**: Pydantic schemas for data extraction
- Defines extraction schemas for different document types
- SUBJECT_PROPERTY_EXTRACTION_SCHEMA
- **When to modify**: When adding new extraction fields or changing schema structure

#### `document_context_service.py`
**Purpose**: Document-level context generation
- Generates document summaries for contextual retrieval
- Reduces API costs by using document-level instead of per-chunk contexts
- **When to modify**: When changing context generation strategy

#### `processing_history_service.py`
**Purpose**: Processing history and event logging
- Tracks document processing steps
- Logs processing events
- **When to modify**: When adding new processing events or changing logging format

### Property Services

#### `property_service.py`
**Purpose**: Core property management service
- Property CRUD operations
- Property validation
- **When to modify**: When changing property management logic

#### `property_enrichment_service.py`
**Purpose**: Property data enrichment
- Enriches property data with additional information
- Calculates completeness scores
- **When to modify**: When adding new enrichment features

#### `property_linking_service.py`
**Purpose**: Links documents to properties
- Matches documents to properties by address
- Creates document-property relationships
- **When to modify**: When changing property matching logic

#### `property_search_service.py`
**Purpose**: Property search functionality
- Searches properties by various criteria
- **When to modify**: When adding new search features

#### `property_matching_service.py` / `enhanced_property_matching_service.py`
**Purpose**: Property matching algorithms
- Matches properties using fuzzy matching
- Address normalization
- **When to modify**: When improving matching accuracy

#### `optimized_property_hub_service.py`
**Purpose**: Optimized property hub operations
- Efficient property hub queries
- Caching strategies
- **When to modify**: When optimizing property hub performance

#### `supabase_property_hub_service.py`
**Purpose**: Property hub operations in Supabase
- Property hub CRUD operations
- **When to modify**: When changing property hub storage logic

#### `manual_property_review_service.py`
**Purpose**: Manual property review functionality
- Handles manual property review workflows
- **When to modify**: When changing review workflow

### Address & Geocoding Services

#### `address_service.py`
**Purpose**: Address parsing and normalization
- Parses addresses from text
- Normalizes address formats
- **When to modify**: When improving address parsing accuracy

#### `filename_address_service.py`
**Purpose**: Extracts addresses from filenames
- Parses property addresses from document filenames
- **When to modify**: When changing filename parsing logic

#### `geocoding_service.py`
**Purpose**: Geocoding service for addresses
- Converts addresses to lat/long coordinates
- Uses Google Geocoding API or Nominatim
- **When to modify**: When changing geocoding provider or logic

### LLM & AI Services

#### `llm_service.py`
**Purpose**: LLM service wrapper
- Provides unified interface for LLM calls
- Handles different LLM providers
- **When to modify**: When changing LLM provider or adding new LLM features

#### `agent_service.py`
**Purpose**: Agent orchestration service
- Manages agent execution
- Handles agent state
- **When to modify**: When changing agent orchestration logic

#### `local_embedding_service.py`
**Purpose**: Local embedding generation (alternative to OpenAI)
- Generates embeddings locally
- **When to modify**: When changing local embedding model or strategy

#### `embedding_server.py`
**Purpose**: Embedding server integration
- Connects to external embedding server
- **When to modify**: When changing embedding server configuration

### Utility Services

#### `storage_service.py`
**Purpose**: File storage service (S3)
- Uploads files to S3
- Manages file storage
- **When to modify**: When changing storage provider or S3 configuration

#### `ocr_service.py`
**Purpose**: OCR service integration
- Performs OCR on images
- **When to modify**: When changing OCR provider or settings

#### `image_filter_service.py`
**Purpose**: Image filtering and processing
- Filters images based on criteria
- **When to modify**: When changing image filtering logic

#### `analytics_service.py`
**Purpose**: Analytics and metrics collection
- Collects system metrics
- Tracks usage statistics
- **When to modify**: When adding new metrics or changing analytics logic

#### `performance_service.py`
**Purpose**: Performance monitoring
- Tracks performance metrics
- Monitors system performance
- **When to modify**: When adding new performance metrics

#### `health_check_service.py`
**Purpose**: System health checks
- Checks system health
- Validates service availability
- **When to modify**: When adding new health checks

#### `error_handling_service.py`
**Purpose**: Error handling and logging
- Centralized error handling
- Error logging
- **When to modify**: When changing error handling strategy

#### `response_formatter.py`
**Purpose**: API response formatting
- Formats API responses consistently
- Standardizes response structure
- **When to modify**: When changing API response format

### Deletion Services

#### `deletion_service.py`
**Purpose**: Document and property deletion (DEPRECATED)
- **Status**: Deprecated - use `unified_deletion_service.py` instead
- **When to modify**: Should not be modified - will be removed

#### `unified_deletion_service.py`
**Purpose**: Unified deletion service for documents and properties
- Deletes documents and related data
- Cleans up orphaned properties
- Handles cascading deletions
- **When to modify**: When changing deletion logic or cleanup procedures

---

## LLM Directory

The LLM directory contains the LangGraph-based RAG (Retrieval Augmented Generation) system.

### Configuration

#### `config.py`
**Purpose**: LLM pipeline configuration
- OpenAI API settings
- Supabase configuration
- LangGraph settings
- Cohere reranker settings
- **When to modify**: When changing LLM provider settings or pipeline configuration

#### `types.py`
**Purpose**: TypeScript-like type definitions for LangGraph state
- `RetrievedDocument`: Result from vector/SQL retrieval
- `DocumentProcessingResult`: Result from document processing
- `MainWorkflowState`: Main graph state
- `DocumentQAState`: Document QA subgraph state
- **When to modify**: When changing state structure or adding new state fields

#### `prompts.py`
**Purpose**: Centralized prompt templates
- Query rewriting prompts
- Document QA prompts
- Summary generation prompts
- **When to modify**: When changing prompt engineering or adding new prompts

### Agents

#### `agents/document_qa_agent.py`
**Purpose**: Document QA subgraph agent
- Answers questions about individual documents
- Uses LangGraph StateGraph
- **When to modify**: When changing document QA logic

### Graphs

#### `graphs/main_graph.py`
**Purpose**: Main LangGraph orchestration
- Coordinates retrieval, processing, and summarization
- Manages state persistence with PostgreSQL checkpointer
- **When to modify**: When changing main workflow or adding new nodes

### Nodes

#### `nodes/retrieval_nodes.py`
**Purpose**: Retrieval node implementations
- `rewrite_query_with_context`: Rewrites queries with conversation history
- `expand_query_for_retrieval`: Expands queries for better retrieval
- `query_vector_documents`: Queries vector database
- `clarify_relevant_docs`: Clarifies and merges relevant documents
- **When to modify**: When changing retrieval logic or adding new retrieval strategies

#### `nodes/processing_nodes.py`
**Purpose**: Document processing node implementations
- `process_documents`: Processes documents with LLM
- **When to modify**: When changing document processing logic

#### `nodes/summary_nodes.py`
**Purpose**: Summary generation node implementations
- `summarize_results`: Generates final summary from processed documents
- **When to modify**: When changing summary generation logic

### Retrievers

#### `retrievers/vector_retriever.py`
**Purpose**: Vector-based document retrieval
- Queries Supabase vector database
- Returns documents with similarity scores
- **When to modify**: When changing vector search logic or similarity thresholds

#### `retrievers/sql_retriever.py`
**Purpose**: SQL-based structured data retrieval
- Queries Supabase for structured property data
- **When to modify**: When changing SQL query logic

#### `retrievers/bm25_retriever.py`
**Purpose**: BM25 keyword-based retrieval
- Implements BM25 search algorithm
- **When to modify**: When changing keyword search logic

#### `retrievers/hybrid_retriever.py`
**Purpose**: Hybrid retrieval combining multiple strategies
- Combines vector, SQL, and BM25 retrieval
- **When to modify**: When changing hybrid retrieval strategy

#### `retrievers/cohere_reranker.py`
**Purpose**: Cohere reranking service
- Reranks retrieved documents using Cohere
- **When to modify**: When changing reranking logic or Cohere settings

### Tools

#### `tools/sql_query_tool.py`
**Purpose**: SQL query tool for LLM agents
- Allows LLM to generate and execute SQL queries
- **When to modify**: When changing SQL query generation or execution logic

### Utils

#### `utils/system_prompts.py`
**Purpose**: System-level prompts for LLM agents
- Defines system prompts for different agent types
- **When to modify**: When changing system-level instructions for agents

---

## Models Directory

### `property_models.py`
**Purpose**: Property-centric SQLAlchemy models
- `Property`: Central property node
- `PropertyDetails`: Property details
- `PropertyHistory`: Property change history
- `DocumentRelationship`: Links documents to properties
- **When to modify**: When changing property data model or adding new property-related tables

---

## Static Directory

### `index.js`
**Purpose**: Static JavaScript file (legacy)
- **When to modify**: Not typically used - frontend is in separate TypeScript project

### `style.css`
**Purpose**: Static CSS file (legacy)
- **When to modify**: Not typically used - frontend is in separate TypeScript project

---

## Key Workflows

### Document Processing Pipeline

1. **Upload** (`views.py` → `/api/documents/upload`)
   - Receives file upload
   - Creates document record
   - Triggers `process_document_task`

2. **Classification** (`tasks.py` → `process_document_classification`)
   - Uses `classification_service.py`
   - Stores classification in `document_summary`

3. **Extraction** (`tasks.py` → `process_document_with_dual_stores`)
   - Uses `reducto_service.py` for parsing
   - Uses `extraction_service.py` for structured extraction
   - Uses `reducto_image_service.py` for images
   - Stores data via `document_storage_service.py`

4. **Vectorization** (`tasks.py` → `vector_service.py`)
   - Uses `vector_service.py` to generate embeddings
   - Stores vectors with bbox metadata
   - Uses `document_context_service.py` for summaries

5. **Property Linking** (`tasks.py` → `property_linking_service.py`)
   - Matches documents to properties
   - Creates relationships

### Query Pipeline

1. **Query** (`views.py` → `/api/llm/query`)
   - Receives user query
   - Calls `llm/graphs/main_graph.py`

2. **Retrieval** (`llm/nodes/retrieval_nodes.py`)
   - Uses `retrievers/hybrid_retriever.py`
   - Combines vector, SQL, and BM25 results

3. **Processing** (`llm/nodes/processing_nodes.py`)
   - Processes documents with LLM
   - Uses `agents/document_qa_agent.py`

4. **Summarization** (`llm/nodes/summary_nodes.py`)
   - Generates final answer
   - Returns to frontend

---

## Common Modification Scenarios

### Adding a New Document Type
1. Update `services/extraction_schemas.py` - Add new schema
2. Update `services/classification_service.py` - Add classification logic
3. Update `tasks.py` - Add extraction logic if needed

### Changing Bbox Storage
1. `tasks.py` - Lines 2113-2133 (chunk metadata extraction)
2. `services/vector_service.py` - Lines 488-673 (`_map_subchunk_to_blocks`)
3. `services/vector_service.py` - Lines 972-1012 (bbox storage)

### Adding a New API Endpoint
1. `views.py` - Add new route
2. Create or update service in `services/` if needed
3. Update frontend API client

### Changing Embedding Model
1. `services/vector_service.py` - Update embedding model name
2. `llm/config.py` - Update `openai_embedding_model`

### Modifying Property Matching
1. `services/property_linking_service.py` - Main matching logic
2. `services/enhanced_property_matching_service.py` - Enhanced algorithms
3. `services/address_service.py` - Address normalization

---

## File Size Reference

- `views.py`: 4,729 lines (largest file - API endpoints)
- `tasks.py`: 3,047 lines (document processing pipeline)
- `vector_service.py`: 1,328 lines (embeddings and vector storage)
- `reducto_service.py`: 784 lines (Reducto integration)
- `document_storage_service.py`: 650 lines (document storage)

---

## Notes

- Most database schema is managed by Supabase migrations, not SQLAlchemy models
- The system uses both Supabase (primary) and local PostgreSQL (legacy) for some operations
- Celery tasks run asynchronously for long-running operations
- LangGraph is used for the RAG pipeline with state persistence
- Bbox data is stored in JSONB format in `document_vectors` table

