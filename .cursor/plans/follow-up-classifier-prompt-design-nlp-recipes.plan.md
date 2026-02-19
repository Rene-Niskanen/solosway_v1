---
name: Follow-up classifier prompt design (nlp-recipes)
overview: "Expert-level design of the follow-up classifier prompt: formal intent/routing semantics, transformer- and prompt-architecture principles, coreference-aware subject comparison, asymmetric loss and evaluation. Implements using nlp-recipes methodology and the existing prompt-engineering framework."
todos:
  - id: formal-task-spec
    content: Write formal task spec (inputs, outputs, routing semantics, loss asymmetry)
    status: pending
  - id: subject-entity-spec
    content: Define subject/entity types and comparison rules (document type, property, named entity)
    status: pending
  - id: prompt-architecture
    content: Implement prompt architecture (delimiters, section order, few-shot placement, output constraint)
    status: pending
  - id: build-example-taxonomy
    content: Build example set with edge-case taxonomy (coreference, doc-type switch, same-entity different-doc)
    status: pending
  - id: write-system-prompt
    content: Write SYSTEM_PROMPT per architecture; include decision procedure and calibrated criteria
    status: pending
  - id: user-prompt-and-parsing
    content: User prompt data-only; robust parse with safe default NEW_QUESTION
    status: pending
  - id: implement-eval
    content: Implement in follow_up_classifier.py; add minimal eval harness and manual regression test
    status: pending
isProject: false
---

# Follow-Up Classifier: Expert Prompt Architecture for Intent Routing

This plan designs the follow-up classifier as a **routing decision** with formal semantics, then implements it using **transformer-aware prompt architecture** and **nlp-recipes** methodology. The goal is robust, interpretable intent classification with minimal wrong-context reuse (asymmetric loss) and clear evaluation.

---

## 1. Task specification (NLP / routing semantics)

### 1.1 Intent as a routing decision

The classifier performs a **single routing decision** with two outcomes that map to downstream behavior:


| Outcome          | Semantic meaning                                                                                                                                   | Downstream action                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **SAME_DOC**     | The current user turn is about the **same discourse subject** as the previous turn (same document(s), property, or report).                        | Reuse cached retrieval (no new search).           |
| **NEW_QUESTION** | The current turn introduces or refers to a **different discourse subject** (different document, report type, or property), or intent is ambiguous. | Run full retrieval pipeline (planner → executor). |


The decision is **not** “is this a follow-up?” (many new questions are follow-ups in dialogue structure). It is: “is the **subject** of this message the same as the **subject** of the previous answer?”

### 1.2 Inputs and outputs (formal)

- **Inputs** (from state/checkpoint):
  - Previous user query (string).
  - Previous assistant summary (string, truncated).
  - Document names from that turn (list of strings).
  - Current user message (string).
- **Output**: One of `{SAME_DOC, NEW_QUESTION}`.
- **Invariant**: The model is only invoked when we already have conversation history and cached execution results; the classifier decides whether to **reuse** that cache or **invalidate** it.

### 1.3 Asymmetric loss and safe default

- **False SAME_DOC** (predict SAME_DOC when it is NEW_QUESTION): User gets an answer from the **wrong** document (e.g. “Koch Sales valuation” answered from the Nzohe lease). High user-facing cost; must be rare.
- **False NEW_QUESTION** (predict NEW_QUESTION when it is SAME_DOC): Unnecessary fresh search; latency and cost increase but answer is still correct. Lower cost.
- **Design rule**: Bias toward NEW_QUESTION when uncertain. Parser and prompt must treat timeout/parse failure as NEW_QUESTION (already the case in code).

---

## 2. Subject and entity resolution (coreference-aware)

The model must compare **subjects** across turns. Define what counts as a subject and when two subjects are “the same” vs “different.”

### 2.1 Subject types (for the prompt)

- **Document / report type**: Lease, valuation, survey, contract, memo, etc. Different type ⇒ different subject.
- **Document or property name**: “Nzohe lease,” “Koch Sales valuation,” “Highlands,” “456 Oak Street.” Different name ⇒ different subject unless the current message clearly continues the same (e.g. “key dates?” with no new name).
- **Named entity as main focus**: If the previous question was “Who is X?” and the current is “Who prepared the valuation?” the **main subject** of the current message is the valuation (a document), not X. Different subject ⇒ NEW_QUESTION.

### 2.2 Coreference and implicit reference

- “The valuation,” “that report,” “the other property”: these are **referential**. Resolve against the **previous turn’s subject**.
  - If previous subject was “the lease” and current says “the valuation,” the valuation is a **new** discourse entity (different document type) ⇒ NEW_QUESTION.
  - If previous subject was “the lease” and current says “that clause” or “the parties,” same subject ⇒ SAME_DOC.
- **“What about X?”**: X is the new focus. If X is a different document/property/type from the previous subject ⇒ NEW_QUESTION.

### 2.3 Decision procedure (for the model)

Give the model an **ordered procedure** so it does not skip comparison:

1. From the **previous user question** and (if helpful) the **previous answer summary**, identify the **subject** of that turn: property name, document name, or document/report type.
2. From the **current user message**, identify the **subject** of this turn.
3. **Compare**: Same property/document/type and no new document or property introduced ⇒ SAME_DOC. Different type, different name, or new document/property introduced ⇒ NEW_QUESTION.
4. **Default**: If comparison is ambiguous or either subject is unclear ⇒ NEW_QUESTION.

This procedure is implemented in the system prompt as explicit steps (transformer-friendly: clear, sequential).

---

## 3. Prompt architecture (transformer- and routing-aware)

Principles: **clarity for the model** (unambiguous role, task, and output), **minimal instruction bleed** (instructions in system only; user = data), **canonical section order**, and **output constraint** to reduce free-form drift.

### 3.1 Section order (system prompt)

Order sections so the model sees **task → stakes → procedure → criteria → examples → output rule**. This order supports:

- **Task first**: So the model commits to “what I am doing” before “how” and “examples.”
- **Stakes (why it matters)**: One sentence so the model internalizes the cost of wrong SAME_DOC.
- **Procedure**: Ordered steps (subject extraction → comparison → decision).
- **Criteria**: When to choose each label; include “when in doubt → NEW_QUESTION.”
- **Few-shot examples**: 3–4 examples covering SAME_DOC, NEW_QUESTION, and at least one edge case (e.g. doc-type switch, “what about the valuation?”).
- **Output rule last**: “Reply with exactly one line: SAME_DOC or NEW_QUESTION. No explanation.” Placing it last reinforces the constraint immediately before the model generates.

### 3.2 Delimiters and consistency

- Use consistent **labels** in the prompt: always `SAME_DOC` and `NEW_QUESTION` (same casing and spelling).
- In the user prompt, use **fixed field names**: “Previous user question:”, “Previous answer (summary):”, “Documents from that turn:”, “Current user message:”. This gives the model a stable schema to attend to.
- Do **not** mix instructions into the user prompt; keep it **data only** plus a single closing line: “Reply SAME_DOC or NEW_QUESTION.” So the model receives: [system = full spec] [user = structured data + one-line reminder].

### 3.3 Token budget and max_tokens

- System prompt: target ~400–600 tokens (role, stakes, procedure, criteria, 4 examples, output rule). Avoid redundant phrasing so the model gets signal, not filler.
- User prompt: variable length; existing truncation (previous answer 400 chars, previous query 200 chars, up to 5 doc names) is sufficient.
- **max_tokens**: 10 is enough for “SAME_DOC” or “NEW_QUESTION”; use 15 to allow for a trailing newline or single extra token without truncation.

---

## 4. Example set and edge-case taxonomy (nlp-recipes-aligned)

Build a small set that (a) appears as few-shot examples in the system prompt and (b) serves as the seed for evaluation.

### 4.1 SAME_DOC (same subject, follow-up)

- Previous: “What’s in the Highlands lease?” → Current: “Key dates?” (same doc, no new subject).
- Previous: “Summarise the lease terms.” → Current: “Who are the parties?” (same doc).
- Previous: “What does the lease say about break clauses?” → Current: “Explain that in simple terms.” (same doc, reformulate).

### 4.2 NEW_QUESTION (different subject)

- Previous: “When was the Nzohe lease executed?” → Current: “Who prepared the Koch Sales valuation?” (different document type and name) — **regression test case**.
- Previous: “Summarise the lease.” → Current: “What about the valuation?” (valuation ≠ lease; new document type).
- Previous: “Who are the parties in the lease?” → Current: “Who prepared the valuation?” (valuation is a different document).

### 4.3 Edge cases (explicit in criteria and one in few-shot)

- **Same person, different document**: “Who is the landlord?” then “Who prepared the valuation?” → NEW_QUESTION (current subject is the valuation document).
- **Implicit reference**: “What about the valuation?” after any lease question → NEW_QUESTION.
- **Ambiguity**: Unclear subject in current message → NEW_QUESTION.

Use 3–4 of these **inside the system prompt**; keep the full set (and any additions) for the eval harness.

---

## 5. Final system prompt (to implement)

Implement the following in [backend/llm/utils/follow_up_classifier.py](backend/llm/utils/follow_up_classifier.py) as a single `SYSTEM_PROMPT` string, with sections in this order.

**1. Role and task (one sentence)**  
You are a document-conversation classifier. Your job is to decide whether the user’s latest message is about the same file(s), document(s), or property as the previous turn, or a new, different subject.

**2. Why it matters (one sentence)**  
If you say SAME_DOC we reuse the previous search; if you say NEW_QUESTION we run a fresh search. Wrong SAME_DOC causes answers from the wrong document (e.g. answering about a valuation using a lease).

**3. Decision procedure (ordered steps)**  

- Step 1: Identify the **subject** of the **previous** user question (property name, document name, or document/report type).  
- Step 2: Identify the **subject** of the **current** message.  
- Step 3: If the two subjects differ (different name, document/report type, or property), or the current message introduces a new document/property → NEW_QUESTION.  
- Step 4: If the current message has no new subject and only asks for more detail, reformat, or clarification on the same topic → SAME_DOC.  
- Step 5: If you are unsure → NEW_QUESTION.

**4. Explicit criteria**  

- **NEW_QUESTION**: Different property name; different document or report type (e.g. lease vs valuation vs survey); “what about [X]” where X is not the previous subject; “the other property/document”; same person asked about in a different document (e.g. “who prepared the valuation?” after a lease question); any doubt.  
- **SAME_DOC**: Same property/document/report as the previous question; follow-ups like “key dates?”, “summarise the terms”, “who are the parties?”, “explain that”, “more detail”, “format that” with no new subject introduced.

**5. Few-shot examples**  

- Previous “When was the Nzohe lease executed?” / Current “Who prepared the Koch Sales valuation?” → NEW_QUESTION  
- Previous “What’s in the Highlands lease?” / Current “Key dates?” → SAME_DOC  
- Previous “Summarise the lease.” / Current “What about the valuation?” → NEW_QUESTION  
- Previous “Who are the parties in the lease?” / Current “Who prepared the valuation?” → NEW_QUESTION

**6. Output rule**  
Reply with exactly one line: either SAME_DOC or NEW_QUESTION. No explanation, no other text.

---

## 6. User prompt (data only)

In `_build_user_prompt`:

- **Include only**:  
  - “Previous user question:” + truncated previous query  
  - “Previous answer (summary):” + truncated previous summary  
  - “Documents from that turn:” + comma-separated doc names (if any)  
  - “Current user message:” + current query
- **Remove**: Any long instructional sentence from the user block.  
- **Add**: One closing line: “Reply SAME_DOC or NEW_QUESTION.”

---

## 7. Parsing and safe default

- **Parse**: Prefer exact match for “SAME_DOC” and “NEW_QUESTION” (case-insensitive, allow “NEW QUESTION” / “SAME DOC” as variants).  
- **Default**: Empty, unparseable, or ambiguous model output → **new_question** (do not cache).  
- Keep `_parse_response` logic; ensure no code path returns SAME_DOC when the model output is missing or invalid.

---

## 8. Evaluation (intent-routing and nlp-recipes)

- **Eval set**: 20–30 labeled turns (SAME_DOC, NEW_QUESTION) including the regression case and the edge-case taxonomy above.  
- **Metrics**: Accuracy; **confusion matrix** (especially false SAME_DOC count); optional per-category accuracy (same-doc follow-ups vs new-question vs edge).  
- **Iteration**: Log failures; refine criteria or add examples for recurring failure modes. No new dependencies; methodology only (nlp-recipes-style “define task → labels → examples → measure”).

---

## 9. Implementation checklist

1. **Formal task spec**: Document inputs, outputs, routing semantics, and loss asymmetry (comment or short doc).
2. **Subject/entity spec**: Document subject types and comparison rules (for prompt and eval).
3. **Prompt architecture**: Implement system prompt with section order and delimiters as in section 5.
4. **Example taxonomy**: Finalise 3–4 few-shot examples and seed eval set.
5. **Write SYSTEM_PROMPT**: Single string in [follow_up_classifier.py](backend/llm/utils/follow_up_classifier.py) per section 5.
6. **User prompt**: Simplify `_build_user_prompt` to data-only + one-line reminder (section 6).
7. **Parsing**: Keep safe default NEW_QUESTION on parse failure; consider `max_tokens=15`.
8. **Manual test**: Run “Nzohe lease” → “Koch Sales valuation” and confirm NEW_QUESTION. Optionally run 5–10 examples from the taxonomy and log results.

---

## 10. Files to change

- [backend/llm/utils/follow_up_classifier.py](backend/llm/utils/follow_up_classifier.py): Replace `SYSTEM_PROMPT` with the section-5 prompt; simplify `_build_user_prompt` per section 6; ensure `_parse_response` and error paths default to `new_question`; optionally set `max_tokens=15`.

No changes to [backend/views.py](backend/views.py) or config for this plan.