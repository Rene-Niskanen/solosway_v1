# RAG & Data Separation: Best-Practice Plan

A phased plan to improve retrieval quality and data separation for **any** query and context: specific entities (people, places, deals, document names, reference numbers), UI context (current view or selection), and multi-tenant or multi-project corpora. The approach is **scenario-agnostic**—no hardcoding to one type of search or one kind of entity.

---

## 1. Goals

- **Query–document alignment**: When the user’s query refers to a **specific thing** (a person, place, deal, document title, date, reference number, etc.), retrieval should prefer documents that are **about** that thing over generically related documents (e.g. templates, guides, or other entities’ docs).
- **Context-aware scope**: When the user is in a known **context** (e.g. a selected property, project, folder, or document), retrieval can use that context to scope or boost—so “this offer” or “the valuation here” means “in this context,” regardless of how that context is represented in your schema.
- **Data separation**: Support clean separation along **any** dimension your app uses: tenant (`business_id`), project, property, deal, time range, or custom taxonomies. Retrieval should respect or boost by these dimensions when appropriate.
- **No over-restriction**: Broad or exploratory queries (“summarize my documents”, “what do we have on X?”, “compare all offers”) should still work: scope and entity signals should **boost** or **filter** in a way that can be tuned (soft vs strict) per product needs.
- **Scalability**: Design so that as the corpus and the number of entities/contexts grow, ranking and separation remain correct without scenario-specific code paths.

---

## 2. Current State (Brief)

| Layer | What exists today |
|-------|-------------------|
| **Schema** | Documents have identifiers and links: e.g. `property_id`, `business_uuid`, `summary_text`, `document_summary` (JSONB), `key_topics`. Relationship tables (e.g. document–property with `relationship_type`) support multiple scope dimensions. |
| **Retrieval** | Two-level: vector search on document embeddings + keyword on filename/summary. Optional filters (e.g. `business_id`) exist; other scope dimensions (property, project, etc.) are not yet used for retrieval. Entity boost is filename-only and phrase-based. |
| **Request context** | The UI can send context (e.g. current property, project, or selection). This is used in some flows but **not** systematically for scoping or boosting document retrieval. |
| **Chunks** | Chunk retrieval is scoped to `document_ids` from document retrieval; there is no document-level “relevance to query entity/scope” signal passed into chunk selection. |

---

## 3. Core Concepts (Scenario-Agnostic)

- **Scope**: Any dimension used to partition or prioritize the corpus—e.g. `property_id`, `project_id`, `folder_id`, `deal_id`, `business_id`, or an explicit list of `document_ids`. Scope can come from the **request** (UI context) or from **query understanding** (e.g. “the Highlands valuation” → resolve to a project or document set).
- **Entity**: Any **named or identifiable thing** the user might refer to in a query: a person, address, property name, deal/offer name, document title, reference number (e.g. LR, contract ID), date or period, or organization. Entity-aware ranking means: prefer documents that **mention or are about** that entity (in filename, summary, or metadata).
- **Query intent**: Classify whether the query is **specific** (about one or a few entities/items) vs **broad** (overview, list, compare, summarize). This drives whether to apply strict scope, soft boost, or no scope.
- **Separation**: The principle that retrieval should not mix slices inappropriately—e.g. when the user asks about “this deal,” answers should not be dominated by another deal’s documents or by generic guides, unless the user clearly asks for general information.

---

## 4. Phased Plan

### Phase 1: Context and scope (data separation along any dimension)

**Idea:** Use **whatever context the app has** (current property, project, folder, selection) and **whatever scope dimensions the schema supports** so that retrieval can be scoped or boosted by context—without hardcoding to “property” or “offer.”

**1.1 Represent scope generically**

- Define a small **scope payload** in workflow state (e.g. `scope: Optional[Dict[str, Any]]` or typed fields) that can carry:
  - **Context from UI**: e.g. `property_id`, `project_id`, `folder_id`, `selected_document_ids`, or a combination.
  - **Resolved scope from query** (Phase 1.3): e.g. “document_ids that match the entity mentioned in the query.”
- Ensure this scope is passed from the request into the graph and into the document retriever. The retriever API should accept **optional scope parameters** (e.g. `scope_filters: Optional[Dict[str, Any]]`) rather than a single `property_id` so you can add new dimensions without changing the function signature each time.

**1.2 Scope in document retrieval**

- Add optional parameters to `retrieve_documents`, e.g.:
  - `scope_filters: Optional[Dict[str, List[str]]]` — e.g. `{"property_id": ["uuid1"], "project_id": ["uuid2"]}`.
  - Or individual optional params if you prefer: `property_id`, `project_id`, `document_ids`, etc.
- When scope is provided:
  - **Strict mode** (optional): Restrict candidates to documents that satisfy the scope (e.g. `documents.property_id IN scope_filters["property_id"]`, or documents in `document_ids`). Use only when the product requires “search only within this X.”
  - **Soft mode** (recommended default): **Boost** documents that match the scope (e.g. add a fixed or proportional boost to score when `document.property_id` is in the context property_id). This avoids empty results and supports “prefer this context but allow others if needed.”
- Implement scope in DB either by extending the vector RPC with optional `WHERE` clauses (e.g. `filter_property_id`, `filter_project_id`) or by **post-filtering / re-scoring** in Python over the initial candidate set. Prefer post-filter/boost if you want to avoid a new migration per dimension.

**1.3 When to apply scope**

- **From request**: When the UI sends explicit context (e.g. user opened chat from a property page), use that context for scope. Do **not** apply strict scope when the user’s query clearly asks for something global (e.g. “search across all projects”); in that case ignore or clear scope for that turn.
- **From query (optional)**: Add a lightweight **scope resolution** step: given the query and optionally conversation history, resolve to a set of entity IDs or document IDs (e.g. “Highlands valuation” → property_id or list of doc IDs). Use this to boost or filter in the same way as UI context. This can be a simple keyword/embedding lookup over property names, document titles, or a small entity index—no need for full NER in v1.

**Deliverables**

- Scope payload in state and request; passed through to `retrieve_documents`.
- `retrieve_documents` accepts generic scope (e.g. `scope_filters` or named optional args) and applies soft (boost) or optional strict (filter) behavior.
- Config/flag to enable scope and to choose strict vs soft (e.g. `SCOPE_ENABLED`, `SCOPE_STRICT`).
- Tests: (1) Query that refers to a specific entity/context returns (or ranks first) documents in that scope. (2) Broad query with same context does not over-restrict (soft boost only). (3) Global query ignores scope.

---

### Phase 2: Entity-aware ranking (any entity type, all document fields)

**Idea:** Improve ranking for **any** query that mentions a specific entity (person, place, deal, document name, reference number, etc.) by using **all** document fields that can contain that entity—filename, summary, metadata, key topics—so that document-specific content outranks generic content regardless of entity type.

**2.1 Entity cues from the query (generic)**

- Derive **entity cues** from the query in a way that is **not** tied to one scenario:
  - **Phrases**: Multi-word n-grams (e.g. 2–3 words) after minimal stopword filtering, normalized (lowercase, optional stemming). These can match names, addresses, titles, etc.
  - **Optional**: Add patterns for reference numbers (e.g. LR numbers, contract IDs), dates, or known vocabularies (e.g. from a small entity index). The goal is to get a set of **strings or normalized tokens** that, if they appear in a document’s metadata, indicate “this doc is about what the user asked for.”
- Do **not** hardcode entity types: the same mechanism should help for “the Chandni offer,” “Banda Lane,” “Highlands valuation,” “Q3 2024 report,” or “contract 12345.”

**2.2 Match entity cues against all document fields**

- For each candidate document, build a **single searchable text** from every field you have: `original_filename`, `summary_text`, flattened `document_summary` (all string values), and if present `key_topics` (or similar). Normalize (lowercase, replace separators with space) for matching.
- For each **entity cue** (phrase or token), check if it appears in this text. If it does, treat the document as **entity-matching** and apply a **boost** to its score (e.g. fixed boost or one that scales with number of cue matches). Optionally weight by field (e.g. stronger boost for match in filename or in a “title” field than in long summary).
- This way, a document about “Banda Lane” is boosted whether the name appears in the filename or only in the summary; similarly for a person name, deal name, or reference number.

**2.3 Optional: structured entities at ingest**

- If you have or add structured extraction at ingest (NER, or rule-based extraction into `document_summary` or a dedicated table), you can:
  - Store normalized entity values (e.g. `property_name`, `party_names`, `reference_numbers`).
  - In retrieval, resolve query entity cues to these structured values and boost (or filter) by them. This is an evolution of the same idea: “document is about this entity” using any available signal.

**Deliverables**

- Entity cue extraction from the query (phrases + optional patterns), scenario-agnostic.
- Entity boost that uses **filename + summary + document_summary + key_topics** (or whatever fields exist).
- No new API contract for callers; only internal scoring changes.
- Tests: (1) Query mentioning a specific person/place/deal/document name ranks the relevant document(s) above generic ones. (2) Queries with no clear entity do not get incorrect boosts (e.g. common words handled via stoplist or minimum cue strength).

---

### Phase 3: Reranker (general query–document relevance)

**Idea:** Add a second-stage **reranker** that scores (query, document) pairs for **relevance** in general. This reduces reliance on hand-crafted rules and works for any query type: the model learns that “deposit for [X] offer” should prefer the actual offer document for X over a generic guide, and similarly for other entity types and intents.

**3.1 Reranker choice**

- **Option A – Cross-encoder**: Off-the-shelf model (e.g. `ms-marco-MiniLM-L-6-v2` or similar) over (query, doc title + snippet of summary). Good for “does this document answer this query?” without scenario-specific logic. Low latency for 10–20 docs.
- **Option B – Lightweight learned model**: Train or fine-tune a small model on (query, doc) relevance labels (from clicks, “view in document,” or scope match). Use generic features (query embedding, doc embedding, entity overlap, scope match) so it generalizes across entity types and query forms.
- **Option C – LLM-as-reranker**: Use an LLM to choose or rank documents. Highest flexibility, higher cost/latency; consider only if A/B are insufficient.

Recommendation: start with **Option A**; move to B if you have enough labels and want to tailor to your corpus and UI.

**3.2 Integration**

- After the current pipeline (vector + keyword + scope boost + entity boost + threshold), take the top N candidates (e.g. 15–20) and rerank them with the chosen model.
- Combine reranker score with the existing score (e.g. convex combination) and re-sort; return top-k to the agent. Optionally cache by (query_hash, doc_id) with short TTL for repeated queries.

**3.3 Training data (for Option B)**

- **Implicit feedback**: User clicks “View in document” or a citation → positive (query, doc). User ignores or downvotes → negative or low relevance.
- **Scope/entity as signal**: When request scope is set and a document matches that scope, treat as positive (query, doc) for that query in context. Use for training or as a feature in the reranker.

**Deliverables**

- Reranker module (e.g. `backend/llm/reranker.py`) and wiring after document retrieval.
- Config: enable/disable and model selection (e.g. `RERANKER_ENABLED`, `RERANKER_MODEL`). Fallback to “no rerank” on failure or timeout.
- Latency and quality tests: compare relevance and citation quality with/without reranker across **several** query types (specific entity, broad, comparison, etc.).

---

### Phase 4: Chunk-level relevance (optional)

**Idea:** When selecting which chunks to send to the LLM, incorporate **document-level relevance** (scope match, entity match, or reranker score) so that chunks from the most relevant documents are preferred. This helps even when one or two generic documents slip into the document list.

**4.1 Document-level relevance signal**

- For each document returned by document retrieval, attach a **relevance signal**: e.g. a boolean `in_scope` (matches request or resolved scope), or a normalized **entity_score** / **reranker_score** (0–1). Pass this through to the chunk retriever or the component that merges/caps chunks.

**4.2 Chunk selection**

- When merging and capping chunks (e.g. top 15 globally):
  - **Boost**: Add a score bonus to chunks whose document has high relevance (e.g. in_scope or entity_score above a threshold), then re-sort and take top-k; or
  - **Soft quota**: Prefer filling a portion of the chunk budget from high-relevance documents first, then fill the rest by chunk score. Prefer boost over hard quota to avoid empty context when high-relevance docs have few chunks.

**Deliverables**

- Chunk selection receives and uses document-level relevance (scope/entity/reranker).
- Tests: For queries that refer to a specific entity or context, **most** of the chunks (or the majority of citations) come from documents that match that entity/scope.

---

## 5. Implementation order and dependencies

```
Phase 1 (Scope)      →  Enables “in this context” and “for this entity set” (any dimension)
Phase 2 (Entity)     →  Better ranking for any named entity; can run in parallel with 1
Phase 3 (Reranker)   →  General relevance; benefits from 1+2 for better candidates
Phase 4 (Chunks)     →  Fine-tuning; do after 1–3 are stable
```

Suggested order: **1 → 2 → 3 → 4**, with 1 and 2 implementable in parallel if desired.

---

## 6. Success metrics (scenario-agnostic)

- **Primary**: For queries that **refer to a specific entity or context** (by name, by scope, or by selection), the **first cited document** and the **majority of citations** should be from documents that are **about** that entity or **in** that scope. This should hold for **any** such entity/context (person, place, deal, document title, project, etc.), not only one hardcoded case.
- **Secondary**: **Broad or exploratory** queries (summarize, list, compare, “what do we have on X?”) retain good recall and answer quality; scope and entity logic do not over-restrict.
- **Operational**: Latency (e.g. P95) for document retrieval remains within budget; reranker adds a bounded delay (e.g. +100–200 ms) with fallback on failure.

---

## 7. Example query types (no single scenario)

The same pipeline should improve results for examples like these, without special-casing each:

- “What deposit is required in the [X] offer?” → Prefer the offer document for X.
- “Summarize the valuation for [property name].” → Prefer that property’s valuation doc(s).
- “What did [person name] agree to?” → Prefer documents mentioning or attributed to that person.
- “Details for contract [number].” → Prefer documents that reference that contract.
- “Compare all offers.” → Broad; scope may still boost “current” context but must not restrict to one.
- “What is the process for making an offer?” → May correctly surface a generic guide; no false entity boost.
- “Show me everything we have on [address/place].” → Prefer docs tied to that place (by metadata or content).

---

## 8. Rollback and flags

- Each phase behind a feature flag or env var (e.g. `SCOPE_ENABLED`, `SCOPE_STRICT`, `ENTITY_BOOST_USE_SUMMARY`, `RERANKER_ENABLED`) so you can disable in production.
- Keep current heuristic (e.g. filename-only entity boost) as fallback when Phase 2 is off.
- Reranker: on failure or timeout, fall back to “no rerank” and use existing scores only.

---

## 9. Summary table

| Phase | What | Main change |
|-------|------|-------------|
| **1. Scope** | Data separation along any dimension | Generic scope from request/query; optional filter or boost in retrieval by property, project, document set, etc. |
| **2. Entity** | Entity-aware ranking for any entity type | Entity cues from query; boost using filename + summary + metadata + key_topics; no hardcoding to one scenario. |
| **3. Reranker** | General query–document relevance | Cross-encoder (or learned model) reranks top candidates; works for any query and document type. |
| **4. Chunk-level** | Prefer chunks from relevant docs | Document-level scope/entity/reranker signal used when selecting and capping chunks. |

This plan stays **scenario-agnostic**: it improves retrieval and data separation for **any** search query and context your app supports, using a generic notion of scope, entity, and relevance.
