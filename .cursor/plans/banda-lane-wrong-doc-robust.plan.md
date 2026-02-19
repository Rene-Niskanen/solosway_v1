---
name: ""
overview: ""
todos: []
isProject: false
---

# Robust plan: Never show info from the wrong property

## Goal

**Never** return or cite a document that is clearly about another property. When the user asks about "Banda Lane", the system must not surface the lease about Dik Dik Lane / Martin Wainaina / Mellifera.

## Robust rule (summary-based)

When the user asks about a specific entity (e.g. "Banda Lane"), we have **gate phrases** (e.g. `["banda lane"]` or `["banda"]`). For each candidate document we must read its **summary** and:

1. **Entity must appear in the summary**
  If the summary **does not mention** the asked-for entity at all (none of the gate phrases appear in the summary text), the document is not about that property. Do not use it for the answer—even if the filename contains "Banda Lane" (filename can be wrong or generic).
2. **Another address in the summary = wrong property**
  If the summary **does mention** another address/location (e.g. "Dik Dik Lane", "Nzohe", "L.R. NO: 2327/30", "3 Dik Dik", "Langata" as primary location), that document is about a different property.

**Exclusion rule (strict):**

- **Exclude** any document where:
  - (A) The summary **does not** contain any of the gate phrases (e.g. no "banda" in summary), **and**
  - (B) The summary **does** contain another address/location pattern.

So: *no entity in summary + another address in summary* → **remove the document from results**. It is never shown or cited.

**Strong exclusion (optional but recommended):**

- **Also exclude** any document where the summary contains another address/location **as the main subject** (e.g. summary describes "two-bedroom house on 3 Dik Dik Lane" and only briefly mentions "Banda Lane"). That can be implemented as: if summary contains both an "other address" pattern and the entity, but the other address appears earlier or more prominently, exclude or heavily penalize. For the first version, the strict rule above is enough.

## Implementation

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py)

**When:** After the entity gate (we already keep only docs that mention the entity in filename or summary). We then **tighten** using the summary only.

**Steps:**

1. **Ensure every result has `summary_text`**
  Same as today: fetch `summary_text` for any doc that only came from vector search (no summary yet). All results must have `summary_text` for the next step.
2. **Add helper: `_summary_clearly_about_another_property(summary: str, gate_phrases: List[str]) -> bool`**
  - Normalize: `summary_lower = (summary or "").strip().lower()`; normalize gate phrases to lowercase.
  - **Entity missing in summary:**  
  Check that at least one gate phrase (or a token from it, e.g. "banda" from "banda lane") appears in `summary_lower`. If **none** of the gate phrases (or their significant tokens) appear in the summary → entity is not in summary.
  - **Another address in summary:**  
  Return True if the summary contains any of a small set of "other address" patterns. Examples: `"dik dik"`, `"dik dik lane"`, `"nzohe"`, `"2327/30"`, `"l.r. no: 2327"`, `"3 dik dik"`, `"langata"` (when used as location). Keep this list in a constant or in `entity_gate_config.json` so it can be extended (e.g. add "oak street", "highlands" for other properties) without code change.
  - **Return:** `True` (clearly about another property) when:  
    - The summary does **not** mention the entity (no gate phrase in summary), **and**  
    - The summary **does** mention another address (one of the patterns above).
  - So we **exclude** when the doc is clearly about another property and never about the one the user asked for.
3. **Apply exclusion after entity gate**
  - After the current entity gate (which keeps docs where filename **or** summary mentions the entity), loop over `results`.
  - For each doc, if `_summary_clearly_about_another_property(r.get('summary_text', ''), gate_phrases)` is `True`, **remove** that doc from `results` (do not just penalize—hard exclude).
  - Log: e.g. "Excluded doc X (summary does not mention entity and mentions another address)".
  - If this would remove all results, keep the pre-exclusion list (same relaxation as current entity gate) and log a warning.
4. **Keep existing behaviour**
  - Entity boost for filename match stays.
  - Sort by score, then pop `summary_text` before returning. No other changes to downstream steps.

## Config (optional)

In `backend/llm/config/entity_gate_config.json` (or same config file used for entity gate), add an optional list, e.g.:

- `conflicting_location_patterns`: list of lowercase substrings that indicate "another address" in a summary (e.g. `["dik dik", "nzohe", "2327/30", "3 dik dik", "langata"]`). If missing, use the in-code default list.

This keeps the rule robust and extensible for new properties without code changes.

## Success criteria

- For "Summarise the Banda Lane document" or "What are the main terms of the Banda Lane offer?", the system **never** returns or cites the lease about Dik Dik Lane / Martin Wainaina / Mellifera when that lease’s summary does not mention "banda" and does mention another address (e.g. Dik Dik Lane, 2327/30).
- The Knight Frank Banda Lane application (Chandni Solanki, KSH 117M, Hardy Banda Lane) is the one used for the answer when the user asks about Banda Lane.

---

## What can make it even better (clever additions)

### 1. Require entity in summary when gate is active (stricter gate)

**Idea:** When we have gate phrases, don't rely on filename alone. **Require** that at least one gate phrase (or a significant token like "banda" from "banda lane") appears **in the summary** for the doc to be kept.

- **How:** After the current entity gate, add a second filter: drop any doc whose `summary_text` does not contain any of the gate phrases (or their tokens). So: "entity in filename OR summary" becomes "entity in summary" (and optionally still allow "entity in filename" only if summary is empty).
- **Why:** Filenames can be wrong or generic (e.g. "Offer_Letter.pdf"). Requiring the entity in the summary ensures the document content is actually about that property.

### 2. Smarter "other address" detection (not just a fixed list)

**Idea:** Detect "another address" in the summary in a more general way, so it works for new properties without editing a list.

- **Pattern-based:** Use simple regex or patterns for address-like text that is **not** the query entity:
  - `L.R. NO: ...` or `LR NO: ...` (parcel numbers): if the number doesn't match one we associate with the query entity, treat as another property.
  - "at X Lane" / "on X Road" / "X Street": extract X; if X is not in the gate phrase tokens (e.g. "dik dik" vs "banda"), treat as another address.
- **Combine:** Keep the configurable list (dik dik, nzohe, 2327/30) for known wrong locations, **plus** these patterns for unknown ones. So we're robust to new properties and new filenames.

### 3. Prominence check when both entity and other address appear

**Idea:** If the summary mentions **both** the entity (e.g. "Banda Lane") and another address (e.g. "Dik Dik Lane"), decide which is the main subject and exclude when the wrong one dominates.

- **How:** Compare "prominence" of entity vs other address in the summary (e.g. first occurrence position, or count of mentions). If the other-address pattern appears earlier or more often than the entity, treat the doc as about the other property and exclude (or heavily penalize).
- **Why:** Avoids "compares two properties" docs being treated as clearly about the asked-for one when they're really about the other.

### 4. Relaxation ordering when we don't exclude everyone

**Idea:** When exclusion would remove all results, we keep the pre-exclusion list (as in the plan). When we do that, still **rank** so the least-wrong docs come first.

- **How:** After deciding not to exclude all, sort results so: (1) docs with entity in summary first, (2) then docs with entity only in filename, (3) then docs that had "other address" (we didn't exclude them only because we relaxed). So we still prefer the right doc even when we can't exclude everything.
- **Why:** Better behaviour when the corpus is noisy or the entity list is strict.

### 5. Chunk-level backstop (second line of defense)

**Idea:** Even if a doc passes retrieval, avoid citing a **chunk** that is clearly about another property.

- **Where:** In the responder or citation path, when we're about to cite a chunk: if the chunk text does not contain the entity and does contain an "other address" pattern, don't use that chunk for the answer (or don't cite it).
- **Why:** Handles edge cases where the doc summary was generic but one chunk is clearly about another property. Reduces wrong-property answers from a single bad chunk.

### 6. Logging and tuning

- Log every excluded doc: `document_id`, filename, and reason ("no entity in summary", "other address in summary", or both). Makes it easy to tune the list and debug.
- Optionally log **kept** docs and whether entity was in summary vs filename only, so you can monitor how often we rely on filename alone.

### 7. Document type hint (optional)

- If the user says "Banda Lane **offer**" and we have `classification_type` (e.g. application, lease, valuation), prefer docs whose type matches "offer/application" over "lease" when ranking. Optional and only if classification is reliable enough.

