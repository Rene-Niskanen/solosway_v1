-- Migration: Add document-level embedding columns and indexes for Two-Level RAG Architecture
-- Phase 1: Database Schema Foundation
-- 
-- This migration adds:
-- 1. document_embedding column (vector(1024)) for document-level semantic search (Voyage AI)
-- 2. summary_text column (TEXT) for LLM-generated canonical summaries
-- 3. key_topics column (TEXT[]) for extracted topics/entities
-- 4. HNSW index on document_embedding for fast vector search
-- 5. GIN indexes for metadata and full-text search
-- 6. Foreign key constraint on document_vectors.document_id
-- 7. SQL functions for two-level retrieval: match_documents() and match_chunks()

-- ============================================================================
-- STEP 1: Add columns to documents table
-- ============================================================================

-- Add document_embedding column (vector embedding for document-level search)
-- NOTE: Using vector(1024) to match Voyage AI embeddings (voyage-law-2 produces 1024-dim vectors)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS document_embedding vector(1024);

-- Add summary_text column (LLM-generated canonical summary for embedding)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS summary_text TEXT;

-- Add key_topics column (extracted topics/entities as array)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS key_topics TEXT[];

-- ============================================================================
-- STEP 2: Create indexes for efficient retrieval
-- ============================================================================

-- HNSW index for vector similarity search on document embeddings
-- This enables fast document-level retrieval (Level 1)
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON documents 
USING hnsw (document_embedding vector_cosine_ops);

-- GIN index for JSONB metadata search on document_summary
CREATE INDEX IF NOT EXISTS documents_metadata_idx 
ON documents 
USING gin (document_summary)
WHERE document_summary IS NOT NULL;

-- Full-text search index for hybrid search (BM25) on summary_text
-- This enables keyword search for exact matches (parcel numbers, plot IDs, etc.)
CREATE INDEX IF NOT EXISTS documents_summary_text_idx 
ON documents 
USING gin (to_tsvector('english', summary_text))
WHERE summary_text IS NOT NULL;

-- ============================================================================
-- STEP 3: Verify and add foreign key constraint
-- ============================================================================

-- Verify document_vectors has index on document_id (should already exist)
-- If it doesn't exist, create it
CREATE INDEX IF NOT EXISTS document_vectors_document_id_idx 
ON document_vectors (document_id);

-- Add foreign key constraint if it doesn't exist
-- This ensures referential integrity and enables CASCADE deletes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'document_vectors_document_id_fkey'
        AND table_name = 'document_vectors'
    ) THEN
        ALTER TABLE document_vectors
        ADD CONSTRAINT document_vectors_document_id_fkey 
        FOREIGN KEY (document_id) 
        REFERENCES documents(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create SQL functions for two-level retrieval
-- ============================================================================

-- Function for Level 1: Document-level vector search
-- This searches documents (not chunks) using document embeddings
-- Returns documents sorted by similarity to query
-- NOTE: Renamed from match_documents to match_document_embeddings to avoid conflict
-- with existing match_documents function that searches chunks with filters
CREATE OR REPLACE FUNCTION match_document_embeddings(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    original_filename text,
    classification_type text,
    summary_text text,
    document_summary jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.original_filename,
        d.classification_type,
        d.summary_text,
        d.document_summary,
        1 - (d.document_embedding <=> query_embedding) as similarity
    FROM documents d
    WHERE d.document_embedding IS NOT NULL
        AND 1 - (d.document_embedding <=> query_embedding) > match_threshold
    ORDER BY d.document_embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Function for Level 2: Chunk-level vector search within specific documents
-- This searches chunks ONLY within the specified document(s)
-- Returns chunks sorted by similarity, scoped to document_id
-- Note: Uses target_document_id as parameter name to avoid conflict with column name
CREATE OR REPLACE FUNCTION match_chunks(
    query_embedding vector(1024),
    target_document_id uuid,
    match_threshold float DEFAULT 0.6,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    chunk_index int,
    chunk_text text,
    chunk_text_clean text,
    page_number int,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dv.id,
        dv.document_id,
        dv.chunk_index,
        dv.chunk_text,
        dv.chunk_text_clean,
        dv.page_number,
        dv.metadata,
        1 - (dv.embedding <=> query_embedding) as similarity
    FROM document_vectors dv
    WHERE dv.document_id = target_document_id
        AND dv.embedding IS NOT NULL
        AND 1 - (dv.embedding <=> query_embedding) > match_threshold
    ORDER BY dv.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- Migration complete
-- ============================================================================
-- 
-- Next steps:
-- 1. Verify columns exist: SELECT column_name FROM information_schema.columns WHERE table_name = 'documents'
-- 2. Verify indexes exist: SELECT indexname FROM pg_indexes WHERE tablename = 'documents'
-- 3. Test match_document_embeddings() function with sample embedding
-- 4. Test match_chunks() function with sample document_id and embedding
-- 
-- Note: Function renamed to match_document_embeddings() to avoid conflict with existing
-- match_documents() function that searches chunks with filters (filter_property_id, etc.)

