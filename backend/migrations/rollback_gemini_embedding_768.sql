-- ROLLBACK: Revert Gemini 768-dimension migration back to Voyage 1024-dimension
-- Purpose: Undo add_gemini_embedding_768.sql when reverting to Voyage AI embeddings.
--
-- WARNING: This migration DROPS existing embeddings. After applying:
--   1. Set USE_GEMINI_EMBEDDINGS=false in .env
--   2. Re-embed all documents with Voyage (re-upload or run a Voyage re-embed script)
--
-- Apply via Supabase SQL Editor or: psql $SUPABASE_DB_URL -f backend/migrations/rollback_gemini_embedding_768.sql

-- ============================================================================
-- STEP 1: Drop indexes (required before altering columns)
-- ============================================================================

DROP INDEX IF EXISTS documents_embedding_idx;
DROP INDEX IF EXISTS document_vectors_embedding_hnsw_idx;

-- ============================================================================
-- STEP 2: Alter documents.document_embedding to vector(1024)
-- ============================================================================

ALTER TABLE documents DROP COLUMN IF EXISTS document_embedding;
ALTER TABLE documents ADD COLUMN document_embedding vector(1024);

-- ============================================================================
-- STEP 3: Alter document_vectors.embedding to vector(1024)
-- ============================================================================

ALTER TABLE document_vectors DROP COLUMN IF EXISTS embedding;
ALTER TABLE document_vectors ADD COLUMN embedding vector(1024);

-- ============================================================================
-- STEP 4: Recreate HNSW indexes
-- ============================================================================

CREATE INDEX documents_embedding_idx ON documents USING hnsw (document_embedding vector_cosine_ops);
CREATE INDEX document_vectors_embedding_hnsw_idx ON document_vectors USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- STEP 5: Update match_document_embeddings() to vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_document_embeddings(vector(768), float, int);

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
-- STEP 6: Update match_chunks() to vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_chunks(vector(768), uuid, float, int);

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
-- STEP 7: Update match_chunks_hybrid() to vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_chunks_hybrid(vector(768), uuid, float, int, text[]);

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

-- ============================================================================
-- STEP 8: Update match_documents_hybrid() to vector(1024)
-- ============================================================================

DROP FUNCTION IF EXISTS match_documents_hybrid(vector(768), text, uuid, float, int, float, float, boolean);

CREATE OR REPLACE FUNCTION match_documents_hybrid(
    query_embedding vector(1024),
    query_text text,
    business_uuid uuid DEFAULT NULL,
    match_threshold float DEFAULT 0.22,
    match_count int DEFAULT 24,
    min_combined_score float DEFAULT 0.22,
    min_vector_score float DEFAULT 0.12,
    require_has_chunks boolean DEFAULT true
)
RETURNS TABLE (
    id uuid,
    original_filename text,
    classification_type text,
    summary_text text,
    vector_score float,
    keyword_score float,
    combined_score float
)
LANGUAGE plpgsql
AS $$
DECLARE
    query_lower text;
BEGIN
    query_lower := lower(trim(coalesce(query_text, '')));

    RETURN QUERY
    WITH
    vector_results AS (
        SELECT
            d.id,
            d.original_filename,
            d.classification_type,
            d.summary_text,
            (1 - (d.document_embedding <=> query_embedding))::float AS sim
        FROM documents d
        WHERE d.document_embedding IS NOT NULL
          AND (1 - (d.document_embedding <=> query_embedding)) > match_threshold
          AND (business_uuid IS NULL OR d.business_uuid = business_uuid)
          AND (NOT require_has_chunks OR EXISTS (SELECT 1 FROM document_vectors dv WHERE dv.document_id = d.id))
        ORDER BY d.document_embedding <=> query_embedding
        LIMIT match_count
    ),
    keyword_results AS (
        SELECT
            d.id,
            d.original_filename,
            d.classification_type,
            d.summary_text,
            CASE
                WHEN query_lower <> '' AND (d.original_filename IS NOT NULL AND lower(d.original_filename) LIKE '%' || query_lower || '%') THEN 0.8
                WHEN query_lower <> '' AND (d.summary_text IS NOT NULL AND lower(d.summary_text) LIKE '%' || query_lower || '%') THEN 0.7
                WHEN query_lower <> '' AND EXISTS (
                    SELECT 1 FROM regexp_split_to_table(query_lower, '\s+') AS w(word)
                    WHERE length(w.word) >= 3
                      AND w.word NOT IN ('the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','its')
                      AND (d.original_filename IS NOT NULL AND lower(d.original_filename) LIKE '%' || w.word || '%')
                ) THEN 0.6
                WHEN query_lower <> '' AND EXISTS (
                    SELECT 1 FROM regexp_split_to_table(query_lower, '\s+') AS w(word)
                    WHERE length(w.word) >= 3
                      AND w.word NOT IN ('the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','its')
                      AND (d.summary_text IS NOT NULL AND lower(d.summary_text) LIKE '%' || w.word || '%')
                ) THEN 0.4
                ELSE 0.2
            END::float AS kw_score
        FROM documents d
        WHERE (business_uuid IS NULL OR d.business_uuid = business_uuid)
          AND (NOT require_has_chunks OR EXISTS (SELECT 1 FROM document_vectors dv WHERE dv.document_id = d.id))
          AND query_lower <> ''
          AND (
            (d.original_filename IS NOT NULL AND lower(d.original_filename) LIKE '%' || query_lower || '%')
            OR (d.summary_text IS NOT NULL AND lower(d.summary_text) LIKE '%' || query_lower || '%')
            OR EXISTS (
                SELECT 1 FROM regexp_split_to_table(query_lower, '\s+') AS w(word)
                WHERE length(w.word) >= 3
                  AND w.word NOT IN ('the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','its')
                  AND (
                    (d.original_filename IS NOT NULL AND lower(d.original_filename) LIKE '%' || w.word || '%')
                    OR (d.summary_text IS NOT NULL AND lower(d.summary_text) LIKE '%' || w.word || '%')
                  )
            )
          )
        LIMIT match_count
    ),
    combined AS (
        SELECT
            coalesce(v.id, k.id) AS doc_id,
            coalesce(v.original_filename, k.original_filename) AS fn,
            coalesce(v.classification_type, k.classification_type) AS ct,
            coalesce(v.summary_text, k.summary_text) AS st,
            coalesce(v.sim, 0)::float AS v_score,
            coalesce(k.kw_score, 0)::float AS k_score
        FROM vector_results v
        FULL OUTER JOIN keyword_results k ON v.id = k.id
        WHERE v.id IS NOT NULL OR k.id IS NOT NULL
    ),
    scored AS (
        SELECT
            doc_id,
            fn,
            ct,
            st,
            v_score,
            k_score,
            CASE
                WHEN v_score < 0.2 AND k_score > 0 THEN (v_score * 0.3 + LEAST(1.0, k_score + 0.1) * 0.7)
                WHEN v_score > 0 AND k_score > 0 THEN (v_score * 0.65 + LEAST(1.0, k_score + 0.1) * 0.35)
                WHEN v_score > 0 THEN v_score
                ELSE (k_score * 0.8)
            END AS comb_score
        FROM combined
    )
    SELECT
        s.doc_id,
        s.fn,
        s.ct,
        s.st,
        s.v_score,
        s.k_score,
        s.comb_score
    FROM scored s
    WHERE s.comb_score >= min_combined_score
      AND (s.v_score >= min_vector_score OR s.k_score >= 0.5)
    ORDER BY s.comb_score DESC
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- Rollback complete. Next steps:
--   1. Set USE_GEMINI_EMBEDDINGS=false in .env
--   2. Re-embed all documents with Voyage (via re-upload or Voyage re-embed script)
-- ============================================================================
