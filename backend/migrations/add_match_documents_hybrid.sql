-- Migration: Add match_documents_hybrid function
-- Purpose: Single RPC that combines vector search, keyword search, business filter,
--          fusion scoring, and chunk check. Reduces 3-6+ round-trips to 1.
--
-- Apply via Supabase SQL Editor or migration tool.
-- Verification: SELECT * FROM match_documents_hybrid(
--   (SELECT document_embedding FROM documents WHERE document_embedding IS NOT NULL LIMIT 1),
--   'valuation',
--   NULL,
--   0.22,
--   24,
--   0.22,
--   0.12,
--   true
-- ) LIMIT 5;

DROP FUNCTION IF EXISTS match_documents_hybrid(vector(1024), text, uuid, float, int, float, float, boolean);

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
    -- Vector search: same logic as match_document_embeddings, with business filter
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
    -- Keyword search: ILIKE on summary_text and original_filename
    -- Words: length>=3, exclude stopwords
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
    -- Combine: full outer join on id, merge vector and keyword scores
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
    -- Compute combined score (Python-equivalent weights)
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
