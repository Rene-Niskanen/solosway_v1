-- Helper SQL queries for checking lazy embedding and document-level contextualization status
-- Replace {DOCUMENT_ID} with an actual UUID from your documents table

-- ============================================================================
-- 1. Get a list of recent documents (use one of these IDs in queries below)
-- ============================================================================
SELECT 
    id,
    original_filename,
    status,
    created_at,
    document_summary IS NOT NULL as has_summary
FROM documents
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- 2. Check document vectors status for a specific document
-- Replace {DOCUMENT_ID} with actual UUID from query above
-- ============================================================================
SELECT 
    document_id,
    COUNT(*) as chunk_count,
    COUNT(CASE WHEN embedding IS NULL THEN 1 END) as unembedded_count,
    COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending_count,
    COUNT(CASE WHEN embedding_status = 'queued' THEN 1 END) as queued_count,
    COUNT(CASE WHEN embedding_status = 'embedded' THEN 1 END) as embedded_count,
    COUNT(CASE WHEN embedding_status = 'failed' THEN 1 END) as failed_count
FROM document_vectors
WHERE document_id = '{DOCUMENT_ID}'  -- Replace with actual UUID
GROUP BY document_id;

-- ============================================================================
-- 3. Check document-level summary for a specific document
-- ============================================================================
SELECT 
    id,
    original_filename,
    document_summary IS NOT NULL as has_summary,
    document_entities,
    document_tags,
    CASE 
        WHEN document_summary IS NOT NULL THEN 
            jsonb_pretty(document_summary)
        ELSE NULL
    END as summary_preview
FROM documents
WHERE id = '{DOCUMENT_ID}';  -- Replace with actual UUID

-- ============================================================================
-- 4. Check embedding status breakdown across all documents
-- ============================================================================
SELECT 
    embedding_status,
    COUNT(*) as chunk_count,
    COUNT(DISTINCT document_id) as document_count
FROM document_vectors
GROUP BY embedding_status
ORDER BY chunk_count DESC;

-- ============================================================================
-- 5. Check documents with summaries vs without
-- ============================================================================
SELECT 
    COUNT(*) as total_documents,
    COUNT(CASE WHEN document_summary IS NOT NULL THEN 1 END) as with_summary,
    COUNT(CASE WHEN document_summary IS NULL THEN 1 END) as without_summary
FROM documents;

-- ============================================================================
-- 6. Check pending embeddings queue (chunks waiting to be embedded)
-- ============================================================================
SELECT 
    document_id,
    COUNT(*) as pending_chunks,
    MIN(created_at) as oldest_pending,
    MAX(created_at) as newest_pending
FROM document_vectors
WHERE embedding_status IN ('pending', 'queued')
GROUP BY document_id
ORDER BY pending_chunks DESC
LIMIT 20;

-- ============================================================================
-- 7. Check failed embeddings (for debugging)
-- ============================================================================
SELECT 
    document_id,
    chunk_index,
    embedding_error,
    embedding_queued_at,
    created_at
FROM document_vectors
WHERE embedding_status = 'failed'
ORDER BY created_at DESC
LIMIT 20;

