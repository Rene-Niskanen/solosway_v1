-- Migration: Rename match_documents to match_document_embeddings
-- Purpose: Avoid function overloading conflict with existing match_documents function
-- that searches chunks with filters (filter_property_id, filter_business_id, etc.)
--
-- This migration renames the new document-level search function to avoid ambiguity
-- when Supabase PostgREST tries to resolve which function to call.

-- ============================================================================
-- STEP 1: Drop the old function if it exists (from Phase 1 migration)
-- ============================================================================

DROP FUNCTION IF EXISTS match_documents(vector(1536), float, int);

-- ============================================================================
-- STEP 2: Create the renamed function
-- ============================================================================

CREATE OR REPLACE FUNCTION match_document_embeddings(
    query_embedding vector(1536),
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
-- Migration complete
-- ============================================================================
-- 
-- Next steps:
-- 1. Verify function exists: SELECT routine_name FROM information_schema.routines WHERE routine_name = 'match_document_embeddings'
-- 2. Test function with sample embedding
-- 3. Update any code that calls match_documents() for document-level search

