# LLM Usage Cost Forecast — Velora

This document gives an **accurate forecast of usage costs for LLM and embedding API calls** based on your codebase configuration and typical usage. Prices are as of early 2025; check provider pages for current rates.

---

## 1. Providers and models in use

| Provider   | Model / API              | Config / default              | Used for |
|-----------|---------------------------|-------------------------------|----------|
| **OpenAI** | `gpt-4o-mini`            | `OPENAI_MODEL`                | Main chat, planner, responder, conversation, context summarization, key facts |
| **OpenAI** | `gpt-4o-mini` (planner)  | `OPENAI_PLANNER_MODEL`        | Planning steps (retrieve_docs → retrieve_chunks) |
| **OpenAI** | `gpt-4o` / `gpt-4o-mini` | User selectable (model factory)| User can switch to gpt-4o or Claude via UI |
| **OpenAI** | `text-embedding-3-small` | When Voyage disabled          | Query + chunk embeddings (fallback) |
| **Anthropic** | `claude-sonnet-4-20250514` | `ANTHROPIC_MODEL`          | Extended thinking (optional) |
| **Anthropic** | `claude-3-haiku-20240307` | Hardcoded in vector_service   | Contextual retrieval (per-chunk context) |
| **Anthropic** | `claude-3-haiku-20240307` | document_context_service      | Document-level context (fallback) |
| **Voyage AI** | `voyage-law-2`          | `VOYAGE_EMBEDDING_MODEL`      | Embeddings (default: `USE_VOYAGE_EMBEDDINGS=true`) |
| **Cohere** | `rerank-english-v3.0`   | `COHERE_RERANK_ENABLED` (false)| Reranking (optional) |

Document summary at ingest uses **local Ollama** by default (`LocalDocumentSummaryService`); optional `USE_OPENAI_FALLBACK` uses OpenAI when set.

---

## 2. Pricing (per 1M tokens unless noted)

### OpenAI (Chat)

| Model         | Input      | Output     | Source / notes        |
|--------------|------------|------------|------------------------|
| gpt-4o-mini  | $0.15      | $0.60      | Standard tier          |
| gpt-4o       | ~$2.50     | ~$10.00    | Check platform.openai.com |

### OpenAI (Embeddings)

| Model                   | Price per 1M tokens |
|-------------------------|---------------------|
| text-embedding-3-small  | ~$0.02              |

### Anthropic

| Model / use              | Input      | Output     | Notes                    |
|--------------------------|------------|------------|--------------------------|
| Claude Sonnet 4          | $3.00      | $15.00     | Extended thinking        |
| Claude 3 Haiku (legacy)  | ~$0.25     | ~$1.25     | Contextual retrieval, doc context |

(Extended thinking: thinking tokens typically billed as output; confirm on docs.anthropic.com.)

### Voyage AI

| Model        | Price per 1M tokens | Free tier        |
|--------------|----------------------|------------------|
| voyage-law-2 | $0.12                | 50M tokens/month |

### Cohere (optional)

| Use     | Price              |
|---------|--------------------|
| Rerank  | $2.00 per 1,000 searches (1 query + up to 100 docs per search) |

---

## 3. When each call happens

### Per user chat message (document query path)

- **Context manager**  
  - 0 or 1 × gpt-4o-mini (only when conversation history &gt; ~8k tokens).
- **Planner**  
  - 1 × gpt-4o-mini (or skipped on “simple” path → `simple_plan`).
- **Evaluator**  
  - No LLM (routing only).
- **Responder**  
  - 1 × `OPENAI_MODEL` (default gpt-4o-mini).
- **Query embeddings**  
  - 2 × Voyage (or OpenAI if Voyage off): one for `retrieve_documents`, one for `retrieve_chunks`.  
  - ~1 query ≈ 10–50 tokens each → **~20–100 embedding tokens per message**.

**Typical document query (no context summarization):**  
2 chat LLM calls (planner + responder) + 2 embedding calls ≈ **2 × (input + output) chat tokens + ~50 embedding tokens**.

### Per user chat message (conversation path)

- **Conversation node**  
  - 1 × `OPENAI_MODEL` (gpt-4o-mini).  
  - No retrieval, no embeddings.

### Per user chat message (attachment fast path)

- **process_documents**  
  - 1 × LLM per document (document_qa_subgraph).
- **summarize_results**  
  - 1 × LLM (openai_model).  
  - So **N docs + 1** chat LLM calls, plus any query embeddings if used on that path.

### Per document ingestion (upload / pipeline)

- **Key facts**  
  - 1 × OpenAI (config.openai_model) per document when key facts are built.
- **Chunk embeddings**  
  - Voyage (or OpenAI): one batch per doc (e.g. 100 chunks per batch); tokens ≈ sum of chunk lengths (often ~200–500 tokens per chunk) → **tens of thousands of tokens per doc** for a typical filing.
- **Document summary + embedding**  
  - Default: local Ollama → **$0**. With `USE_OPENAI_FALLBACK=true`: 1 × OpenAI summary + 1 × document-level embedding (Voyage or OpenAI).
- **Contextual retrieval (optional)**  
  - If enabled: Claude Haiku per chunk for “chunk context” (can be 10–100+ calls per doc). Often disabled to control cost.

### Optional features

- **Extended thinking**  
  - 1 × Claude Sonnet 4 (with thinking budget, e.g. 5000 tokens) per analysis when user triggers it.
- **Cohere rerank**  
  - $2 per 1,000 searches when `COHERE_RERANK_ENABLED=true` (default false).

---

## 4. Example token assumptions (for numbers below)

- **Planner:** ~800 input, ~200 output per message.
- **Responder:** ~2,500 input (query + chunks + history), ~400 output.
- **Conversation:** ~500 input, ~150 output.
- **Context summarization (when triggered):** ~2,000 input, ~400 output.
- **Key facts (per doc):** ~3,000 input, ~500 output.
- **Embedding:** ~30 tokens per query; per-doc ingestion ~30,000 embedding tokens per doc (example).

---

## 5. Cost scenarios (ballpark)

### Scenario A: 500 document queries/month (default model gpt-4o-mini, Voyage embeddings)

- Planner: 500 × (0.8k × 0.15 + 0.2k × 0.60) / 1e6 ≈ **$0.12**  
- Responder: 500 × (2.5k × 0.15 + 0.4k × 0.60) / 1e6 ≈ **$0.30**  
- Query embeddings (Voyage): 1,000 × 30 × 0.12 / 1e6 ≈ **$0.004** (well under 50M free tier)  
- **Subtotal (chat + embeddings):** ~**$0.42/month** (Voyage free tier covers embeddings).

### Scenario B: Same 500 queries + 20% conversation (100 conversation turns)

- Conversation: 100 × (0.5k × 0.15 + 0.15k × 0.60) / 1e6 ≈ **$0.02**  
- **Total (A + B):** ~**$0.44/month**.

### Scenario C: 50 documents ingested/month (key facts + Voyage embeddings only)

- Key facts: 50 × (3k × 0.15 + 0.5k × 0.60) / 1e6 ≈ **$0.05**  
- Chunk embeddings: 50 × 30,000 × 0.12 / 1e6 = **$0.18** (or $0 if within 50M Voyage free tier)  
- **Ingestion subtotal:** ~**$0.05–0.23** depending on free tier.

### Scenario D: 500 queries + 50 docs + 10 extended-thinking analyses

- A + B + C (approx): ~$0.50 + ~$0.15 = ~$0.65  
- Extended thinking: 10 × (e.g. 3k input + 1k output + 5k thinking) × Sonnet ≈ 10 × (3×3 + 6×15) / 1e6 ≈ **$0.99**  
- **Total:** ~**$1.65/month**.

### Scenario E: OpenAI embeddings instead of Voyage (same 500 queries)

- 1,000 embedding calls × 30 tokens × $0.02/1M ≈ **$0.0006** (negligible).  
- So switching to OpenAI embeddings for queries only adds cents at this scale.

### Scenario F: User selects gpt-4o for all chat (500 queries)

- Planner (if still gpt-4o-mini): unchanged.  
- Responder: 500 × (2.5k × 2.50 + 0.4k × 10) / 1e6 ≈ **$3.53**  
- **Total (chat only, no ingestion):** ~**$3.65/month** (vs ~$0.42 with gpt-4o-mini).

---

## 6. Summary table (approximate)

| Scenario                      | Monthly volume     | Est. LLM/API cost (USD) |
|------------------------------|--------------------|---------------------------|
| Light (200 doc queries)      | 200 queries        | ~$0.20                   |
| Medium (500 doc + 100 conv) | 500 + 100          | ~$0.45                   |
| + Ingestion (50 docs)       | + 50 docs          | +$0.05–0.25              |
| + Extended thinking (10)    | + 10 analyses      | +~$1.00                  |
| Heavy (gpt-4o, 500 queries) | 500 doc queries    | ~$3.50–4.00              |

---

## 7. Levers to control cost

1. **Keep default model gpt-4o-mini** for planner and main chat.
2. **Use Voyage for embeddings** and stay within 50M free tokens/month where possible.
3. **Use simple_plan path** where possible (skips planner LLM for medium-length, self-contained queries).
4. **Limit extended thinking** to when needed (or disable via `USE_EXTENDED_THINKING=false`).
5. **Keep Cohere rerank disabled** unless you need it (`COHERE_RERANK_ENABLED=false`).
6. **Keep contextual retrieval disabled** (or use sparingly) to avoid many Claude Haiku calls per doc.
7. **Use local Ollama for document summary** at ingest; avoid `USE_OPENAI_FALLBACK` unless necessary.
8. **Context manager** only adds cost when history &gt; ~8k tokens; shortening history or summarising less often reduces cost.

---

## 8. Where to check current prices

- **OpenAI:** https://platform.openai.com/docs/pricing  
- **Anthropic:** https://docs.anthropic.com/en/docs/about-claude/pricing  
- **Voyage:** https://docs.voyageai.com/docs/pricing  
- **Cohere:** https://docs.cohere.com (rerank pricing)

---

*Forecast based on codebase as of Feb 2025; config and defaults from `backend/llm/config.py`, graph flow from `backend/llm/graphs/main_graph.py`, and service usage across backend.*
