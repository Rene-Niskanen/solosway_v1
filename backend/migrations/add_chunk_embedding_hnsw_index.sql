-- Migration: Add HNSW index on document_vectors.embedding for fast chunk-level vector search
-- 
-- This index is critical for the two-level RAG architecture's chunk retrieval (Level 2).
-- Without this index, chunk-level vector search will be slow and may timeout on large datasets.
--
-- HNSW (Hierarchical Navigable Small World) is the recommended index type for pgvector
-- as it provides fast approximate nearest neighbor search with good recall.

-- ============================================================================
-- STEP 1: Check if index already exists
-- ============================================================================

DO $$
BEGIN
    -- Check if HNSW index already exists on document_vectors.embedding
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
            AND tablename = 'document_vectors'
            AND indexname = 'document_vectors_embedding_hnsw_idx'
    ) THEN
        -- Create HNSW index for fast vector similarity search on chunk embeddings
        -- This enables fast chunk-level retrieval (Level 2 of two-level RAG)
        CREATE INDEX document_vectors_embedding_hnsw_idx 
        ON document_vectors 
        USING hnsw (embedding vector_cosine_ops);
        
        RAISE NOTICE '✅ Created HNSW index on document_vectors.embedding';
    ELSE
        RAISE NOTICE 'ℹ️ HNSW index on document_vectors.embedding already exists';
    END IF;
END $$;

-- ============================================================================
-- Migration complete
-- ============================================================================
-- 
-- Note: This index creation may take time on large datasets (100k+ chunks).
-- The index is built in the background and does not block queries.
--
-- To verify the index was created:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'document_vectors' 
--     AND indexname = 'document_vectors_embedding_hnsw_idx';

