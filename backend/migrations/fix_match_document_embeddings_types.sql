-- Migration: Fix match_document_embeddings() return type mismatch
-- Purpose: Cast varchar(255) columns to text to match function signature
-- Error: 'Returned type character varying(255) does not match expected type text in column 2'
--
-- The documents table has original_filename and classification_type as varchar(255),
-- but the function signature returns text. PostgreSQL is strict about this match.

-- ============================================================================
-- STEP 1: Drop existing function
-- ============================================================================

DROP FUNCTION IF EXISTS match_document_embeddings(vector(1024), float, int);

-- ============================================================================
-- STEP 2: Recreate function with explicit type casts
-- ============================================================================

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
        d.original_filename::text,           -- Cast varchar(255) to text
        d.classification_type::text,         -- Cast varchar(255) to text  
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
-- VERIFICATION
-- ============================================================================
-- Run this to verify:
-- SELECT routine_name FROM information_schema.routines WHERE routine_name = 'match_document_embeddings';
