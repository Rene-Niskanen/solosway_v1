-- Migration: Add match_chunks_hybrid - single RPC for vector + keyword + bbox + blocks + doc metadata
-- Purpose: Consolidate 4 per-document DB round-trips (vector RPC, keyword search, bbox fetch, doc metadata)
--          into 1 RPC call per document for faster chunk retrieval.
--
-- Replaces per-document flow:
--   1. match_chunks (vector RPC)
--   2. document_vectors keyword ILIKE search
--   3. document_vectors bbox/blocks fetch for chunks missing bbox
--   4. documents metadata fetch (filename, classification_type)
--
-- With: single match_chunks_hybrid RPC that returns all of the above.

CREATE OR REPLACE FUNCTION match_chunks_hybrid(
    query_embedding vector(1024),
    target_document_id uuid,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10,
    keyword_patterns text[] DEFAULT '{}'
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    chunk_index int,
    chunk_text text,
    chunk_text_clean text,
    page_number int,
    metadata jsonb,
    bbox jsonb,
    blocks jsonb,
    similarity float,
    from_keyword boolean,
    original_filename text,
    classification_type text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH docs AS (
        SELECT d.original_filename, d.classification_type
        FROM documents d
        WHERE d.id = target_document_id
        LIMIT 1
    ),
    vector_results AS (
        SELECT
            dv.id,
            dv.document_id,
            dv.chunk_index,
            dv.chunk_text,
            dv.chunk_text_clean,
            dv.page_number,
            dv.metadata,
            dv.bbox,
            dv.blocks,
            (1 - (dv.embedding <=> query_embedding))::float AS sim,
            false::boolean AS from_kw,
            d.original_filename,
            d.classification_type
        FROM document_vectors dv
        CROSS JOIN docs d
        WHERE dv.document_id = target_document_id
            AND dv.embedding IS NOT NULL
            AND (1 - (dv.embedding <=> query_embedding)) > match_threshold
        ORDER BY dv.embedding <=> query_embedding
        LIMIT match_count
    ),
    keyword_results AS (
        SELECT
            dv.id,
            dv.document_id,
            dv.chunk_index,
            dv.chunk_text,
            dv.chunk_text_clean,
            dv.page_number,
            dv.metadata,
            dv.bbox,
            dv.blocks,
            0.4::float AS sim,
            true::boolean AS from_kw,
            d.original_filename,
            d.classification_type
        FROM document_vectors dv
        CROSS JOIN docs d
        WHERE dv.document_id = target_document_id
            AND array_length(keyword_patterns, 1) IS NOT NULL
            AND array_length(keyword_patterns, 1) > 0
            AND EXISTS (
                SELECT 1 FROM unnest(keyword_patterns) AS pat
                WHERE dv.chunk_text ILIKE pat
                   OR (dv.chunk_text_clean IS NOT NULL AND dv.chunk_text_clean ILIKE pat)
            )
        ORDER BY dv.chunk_index
        LIMIT match_count
    ),
    combined AS (
        SELECT * FROM vector_results
        UNION
        SELECT * FROM keyword_results
    ),
    deduped AS (
        SELECT DISTINCT ON (c.id)
            c.id,
            c.document_id,
            c.chunk_index,
            c.chunk_text,
            c.chunk_text_clean,
            c.page_number,
            c.metadata,
            c.bbox,
            c.blocks,
            c.sim AS similarity,
            c.from_kw AS from_keyword,
            c.original_filename,
            c.classification_type
        FROM combined c
        ORDER BY c.id, c.from_kw ASC, c.sim DESC
    )
    SELECT
        deduped.id,
        deduped.document_id,
        deduped.chunk_index,
        deduped.chunk_text,
        deduped.chunk_text_clean,
        deduped.page_number,
        deduped.metadata,
        deduped.bbox,
        deduped.blocks,
        deduped.similarity,
        deduped.from_keyword,
        deduped.original_filename,
        deduped.classification_type
    FROM deduped
    ORDER BY deduped.similarity DESC, deduped.chunk_index;
END;
$$;
