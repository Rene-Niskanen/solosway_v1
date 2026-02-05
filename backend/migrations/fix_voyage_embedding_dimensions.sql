-- Migration: Fix Voyage Embedding Dimensions
-- Purpose: Change document_embedding and function signatures from 1536 to 1024 dimensions
-- to match Voyage AI embeddings (voyage-law-2 produces 1024-dim vectors)
--
-- This migration:
-- 1. Drops and recreates document_embedding column as vector(1024)
-- 2. Updates match_document_embeddings() function to use vector(1024)
-- 3. Updates match_chunks() function to use vector(1024)
-- 4. Recreates HNSW index for new dimension

-- ============================================================================
-- STEP 1: Drop existing index (required before dropping column)
-- ============================================================================

DROP INDEX IF EXISTS documents_embedding_idx;

-- ============================================================================
-- STEP 2: Drop and recreate document_embedding column with correct dimension
-- ============================================================================

-- Drop the column (this will lose any existing data, but that's okay since
-- we haven't populated it yet - Phase 5 will generate embeddings)
ALTER TABLE documents 
DROP COLUMN IF EXISTS document_embedding;

-- Recreate with correct dimension (1024 for Voyage)
ALTER TABLE documents 
ADD COLUMN document_embedding vector(1024);

-- ============================================================================
-- STEP 3: Recreate HNSW index for new dimension
-- ============================================================================

CREATE INDEX documents_embedding_idx 
ON documents 
USING hnsw (document_embedding vector_cosine_ops);

-- ============================================================================
-- STEP 4: Update match_document_embeddings() function to use vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_document_embeddings(vector(1536), float, int);

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

-- ============================================================================
-- STEP 5: Update match_chunks() function to use vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_chunks(vector(1536), uuid, float, int);

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
-- 1. Verify column dimension: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'document_embedding'
-- 2. Verify function signatures: SELECT routine_name, parameters FROM information_schema.routines WHERE routine_name IN ('match_document_embeddings', 'match_chunks')
-- 3. Test with Voyage embeddings (1024 dimensions)

