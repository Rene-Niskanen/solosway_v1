---
name: Hybrid Document Retrieval One Call
overview: Consolidate vector search, keyword search, and business filtering into a single PostgreSQL RPC to reduce document retrieval from 3–6+ DB calls to 1.
todos:
  - id: sql-migration
    content: Create add_match_documents_hybrid.sql with full function
  - id: python-rpc
    content: Refactor retrieve_documents() to call match_documents_hybrid
  - id: legacy-path
    content: Extract current logic into _retrieve_documents_legacy()
  - id: feature-flag
    content: Add USE_HYBRID_DOCUMENT_RPC and branch
  - id: fallback
    content: Implement fallback on RPC failure and optional 0-results
  - id: tests
    content: Add SQL and Python tests, regression comparison
  - id: env-example
    content: Document USE_HYBRID_DOCUMENT_RPC in .env.example
isProject: false
---

# Hybrid Document Retrieval: One DB Call

## Goal

Reduce document retrieval from 2–4+ Supabase round-trips to **1 RPC call** by consolidating vector search, keyword search, and business filtering into a single PostgreSQL function. Embedding remains a separate API call (required).

**Target flow:**
1. Embedding API (Voyage/OpenAI)
2. `supabase.rpc('match_documents_hybrid', {...})` → 1 DB call

---

## Current Flow (to be replaced)

| Step | Current | Round-trips |
|------|---------|-------------|
| 1 | Embedding API | 1 external |
| 2 | `match_document_embeddings` RPC | 1 |
| 3 | Keyword search (table + OR) | 1 |
| 4 | Fallback filename search (edge case) | 0–1 |
| 5 | Business filter for vector results | 0–1 |
| 6 | Chunk check (per doc) | N |
| 7 | Missing summaries fetch (entity gating) | 0–1 |

**Total:** 1 API + 3–6+ DB calls.

---

## Phase 1: SQL Migration — `match_documents_hybrid`

### 1.1 Function Signature

```sql
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
```

- `business_uuid`: Optional. When provided, filter both vector and keyword results.
- `match_count`: Fetch extra for fusion/reranking (e.g. top_k * 3).
- `require_has_chunks`: When true, exclude docs with 0 rows in `document_vectors`.

### 1.2 Internal Logic

**Vector search (reuse `match_document_embeddings` logic):**
```sql
SELECT d.id, d.original_filename, d.classification_type, d.summary_text,
       1 - (d.document_embedding <=> query_embedding) AS vector_score
FROM documents d
WHERE d.document_embedding IS NOT NULL
  AND 1 - (d.document_embedding <=> query_embedding) > match_threshold
  AND (business_uuid IS NULL OR d.business_uuid = business_uuid)
ORDER BY d.document_embedding <=> query_embedding
LIMIT match_count;
```

**Keyword search:**
- Normalize `query_text`: `lower(trim(query_text))`
- Extract words: `regexp_split_to_table` on whitespace, filter `length(word) >= 3`, exclude stopwords
- Build OR: full query, each word, two-word phrases as `word1_word2` in summary_text and original_filename
- Apply `business_uuid` filter when provided
- Limit `match_count`

**Fusion:**
- Union vector and keyword results by `id`
- Keyword scoring tiers: exact filename 0.8, partial filename 0.6, exact summary 0.7, partial summary 0.4, fallback 0.2
- Combined score: 0.65 vector + 0.35 keyword (both), or 0.8 * keyword (keyword-only), or vector (vector-only)

**Chunk filter:**
- When `require_has_chunks = true`: `AND EXISTS (SELECT 1 FROM document_vectors dv WHERE dv.document_id = d.id LIMIT 1)`

### 1.3 Fallback Keyword Logic

**Recommendation:** Omit from SQL for Phase 1. Keep as rare second Python call when RPC returns 0 results.

### 1.4 Migration File

**Path:** `backend/migrations/add_match_documents_hybrid.sql`

---

## Phase 2: Python Changes — `retrieve_documents()`

### 2.1 Call the New RPC

Replace vector RPC + keyword query + business filter + chunk loop with single `match_documents_hybrid` RPC. Compute `search_threshold` from `search_goal`, `query_type`, `min_score` (unchanged).

### 2.2 Post-Processing (stay in Python)

- Convert RPC columns to result format
- Entity gating (unchanged): `get_entity_gate_phrases`, filename/summary boost, entity-in-summary filter, wrong-property exclusion
- Scope filter (unchanged): `document_ids`, `property_id`
- Fallback when 0 results: optional legacy call

### 2.3 Legacy Path

Extract current logic into `_retrieve_documents_legacy()`. Use when RPC fails, feature flag off, or fallback on 0 results.

---

## Phase 3: Testing and Validation

- SQL unit tests: sample embedding + query, business filter, fusion, chunk filter
- Python integration: compare new vs legacy for 5–10 queries, top-5 overlap >= 80%
- Regression: both paths, assert doc IDs match or overlap >= 95%

---

## Phase 4: Rollout and Rollback

- Feature flag: `USE_HYBRID_DOCUMENT_RPC` (default true)
- Rollback: set `USE_HYBRID_DOCUMENT_RPC=false`; no code revert
- Runbook: apply migration → deploy Python → monitor

---

## Edge Cases

| Case | Handling |
|------|----------|
| `business_id` not UUID | Pass NULL |
| Empty `query_text` | Vector-only results |
| RPC not found | Fallback to legacy |
| Scope filter | Apply in Python |
| Entity gating | Python (unchanged) |

---

## Success Criteria

- 2–4+ DB calls → 1 DB call
- Top-k overlap with legacy >= 95%
- Clean rollback via feature flag
