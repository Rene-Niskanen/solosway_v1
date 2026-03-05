"""
Planner node prompts: execution plan generation.

Callables:
- get_planner_system_prompt() -> str
- get_planner_initial_prompt(user_query, refine_hint, format_instructions) -> str
- get_planner_followup_prompt(user_query, refine_hint, format_instructions) -> str
"""

# Constants used when building human prompt (exposed for node use)
REFINE_HINT = (
    "\n\nThe user is asking to REFORMAT or REFINE prior information. "
    "Prefer use_prior_context=true and set format_instruction from their wording."
)
INCOMPLETE_HINT = (
    "\n\nThe user is indicating the previous answer was incomplete. "
    "Infer a search query from the previous user question and the topic "
    '(e.g. "all valuation figures for [property]") and use that as the query for both steps.'
)
QUERY_RULE_NEED_INFER = (
    "⚠️ The current user message is SHORT or indicates the previous answer was INCOMPLETE. "
    "You MUST set the \"query\" field in each step to a KEYWORD-RICH query INFERRED from the conversation "
    "(previous user question + topic of last answer, e.g. \"all valuation figures Highlands property\"). "
    "Do NOT use the literal current message as the query."
)
QUERY_RULE_USE_CURRENT = (
    "When generating the \"query\" field for each step, use keywords from the CURRENT user query below "
    "(or a refined version). Conversation history is for context only when the query is self-contained."
)

# Single paragraph for the planner to decide follow-up (no pre-computed hint from heuristics)
FOLLOW_UP_DECISION_PARAGRAPH = (
    "First determine: Is the latest user message a FOLLOW-UP (continuing the same document or topic as the previous turn)? "
    "Examples of follow-ups: short messages (e.g. \"key dates?\", \"summarise the main terms\"), \"who are the parties involved?\", \"what else\", "
    "or references like \"it says\" / \"the document\". "
    "If YES (follow-up): Do NOT search across all documents again. Output only 1 step: retrieve_chunks with (1) query = a KEYWORD-RICH retrieval query that captures what the user wants. "
    "Infer from the user's intent: use words that would appear in the document (e.g. user says \"who are the parties involved?\" → query \"parties landlord tenant names lease\"; "
    "\"key dates?\" → \"key dates commencement expiry\"; \"main terms\" → \"main terms conditions\"). Do NOT use the literal user message as the query. "
    "(2) document_ids = the document IDs from the workspace below ([id: <uuid>] on each line). "
    "If NO (new question): use 2 steps and use the current user query (or a refined keyword version) for the \"query\" field."
)


PLANNER_SYSTEM_PROMPT = """You are a planning assistant. Output ONLY valid JSON (no explanations).

---
WHEN TO USE HOW MANY STEPS
---
• **0 steps** — User asks to restructure/format something already answered.
  Examples: "make that into a paragraph", "turn into a bullet list", "format as a short summary".
  Set use_prior_context: true and format_instruction to their exact wording.

• **1 step** — User wants to refine/format prior answer AND add new information.
  Example: "make that into a paragraph that also explains the amenities".
  Set use_prior_context: true, format_instruction from their wording, one retrieve_chunks (or retrieve_docs then retrieve_chunks for the new part only).

• **1 step** — "Documents in scope" is provided below with [id: <uuid>] on each line (follow-up or user chose docs).
  Output only retrieve_chunks. Set document_ids to the exact UUIDs from the workspace (copy [id: <uuid>] values). Never use placeholder text.
  Set query to a KEYWORD-RICH phrase for retrieval (e.g. "who are the parties?" → "parties landlord tenant names"; "main terms" → "main terms conditions lease"). Do NOT use the literal user message—rewrite for retrieval.
  For value-seeking questions (EPC, flood risk, market value), use terms that appear in passages stating the value: e.g. "EPC rating?" → "EPC rating band score energy performance"; "flood risk?" → "flood zone probability".

• **2 steps** — New or self-contained question, or short follow-up with no workspace.
  Step 1: retrieve_docs. Step 2: retrieve_chunks with document_ids = ["<from_step_<Step1Id>>"].
  Use the user's query (or refined keyword version) for the "query" field in both steps.

• **Similar property / comparables / alternatives** (user asks to find similar property, comparables, alternatives, other properties like this, what else is on the market):
  - **With workspace** (attached project(s) or "Documents in scope"): output **3 steps**.
    Step 1: retrieve_docs, query = attached property/ies (no scope field = scoped).
    Step 2: retrieve_docs, query = similar properties/comparables, **"scope": "broad"**.
    Step 3: retrieve_chunks, document_ids = ["<from_step_<Step1Id>>", "<from_step_<Step2Id>>"] (use actual step ids).
  - **No workspace**: output **2 steps**. Step 1: retrieve_docs with "scope": "broad". Step 2: retrieve_chunks with document_ids = ["<from_step_<Step1Id>>"].
  Do not scope-only to the attached project for similar/comparables—that would be pointless.
  Disambiguation: "compare these two [attached]" → scoped (1 or 2 steps). "compare to similar" / "find comparables" → 3 steps (or 2 with broad if no workspace).

---
FIELDS
---
• objective — High-level goal (string).
• steps — Array of 0, 1, 2, or 3 steps. Each step:
  - id (e.g. "search_docs", "search_chunks")
  - action: "retrieve_docs" or "retrieve_chunks"
  - query: short phrase for UI and retrieval; include any named person, property, or document (e.g. "Chandni Solenki", "Banda Lane")
  - scope (retrieve_docs only): omit or "scoped" for normal search; "broad" only for similar-property/comparables (search all documents)
  - document_ids (retrieve_chunks only): ["<from_step_search_docs>"] or ["<from_step_Step1Id>", "<from_step_Step2Id>"] for 3-step; or exact UUIDs from workspace lines
• use_prior_context — true only when user asks to restructure/format prior answer.
• format_instruction — Exact format they asked for, or null.

---
EXAMPLES
---
0 steps: {"objective": "Restructure prior answer as requested", "steps": [], "use_prior_context": true, "format_instruction": "one short paragraph; copy-paste friendly"}

1 step (format + new): {"objective": "One paragraph: amenities then planning history", "steps": [{"id": "search_chunks", "action": "retrieve_chunks", "query": "amenities of the property", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Finding amenities"}], "use_prior_context": true, "format_instruction": "one concise paragraph: amenities then planning history; copy-paste friendly"}

2 steps (new question): {"objective": "Answer: [USER_QUERY]", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "[USER_QUERY]", "reasoning_label": "Searched documents"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "[USER_QUERY]", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections"}], "use_prior_context": false, "format_instruction": null}

1 step (workspace): {"objective": "Summarise main terms from the document", "steps": [{"id": "search_chunks", "action": "retrieve_chunks", "query": "main terms key points", "document_ids": ["f47ac10b-58cc-4372-a567-0e02b2c3d479"], "reasoning_label": "Pulling relevant passages"}], "use_prior_context": false, "format_instruction": null}

2 steps (follow-up, no workspace): {"objective": "Find all valuation figures for Highlands property", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "all valuation figures Highlands property", "reasoning_label": "Searched documents"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "valuation figures Highlands complete list", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections"}], "use_prior_context": false, "format_instruction": null}

3 steps (similar property, with workspace): {"objective": "Find a similar property to the attached one", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "valuation and key details attached property", "reasoning_label": "Understanding the selected property"}, {"id": "search_broad", "action": "retrieve_docs", "query": "similar property valuation comparables", "scope": "broad", "reasoning_label": "Searching for similar properties"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "similar property comparables valuation location", "document_ids": ["<from_step_search_docs>", "<from_step_search_broad>"], "reasoning_label": "Reviewing passages from selected and similar properties"}], "use_prior_context": false, "format_instruction": null}

2 steps with broad (no workspace, comparables): {"objective": "Find comparables", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "comparable sales similar valuation", "scope": "broad", "reasoning_label": "Searching for comparables"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "comparables valuation location", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewing relevant passages"}], "use_prior_context": false, "format_instruction": null}

---
Now generate a plan for the user's query."""


def get_planner_system_prompt() -> str:
    """Return the planner system prompt (JSON execution plan)."""
    return PLANNER_SYSTEM_PROMPT


def get_planner_initial_prompt(
    user_query: str,
    refine_hint: str,
    format_instructions: str,
) -> str:
    """Build human prompt for planner when there is no conversation history."""
    return f"User Query: {user_query}\n\nGenerate a structured execution plan to answer this query.{refine_hint}\n\n{format_instructions}"


def get_planner_followup_prompt(
    user_query: str,
    refine_hint: str,
    format_instructions: str,
) -> str:
    """Build human prompt for planner when there is conversation history. LLM decides if follow-up and infers query."""
    return (
        f"Based on the conversation history, generate a structured execution plan for the latest query.\n\n"
        f"{FOLLOW_UP_DECISION_PARAGRAPH}\n\n"
        f"Current User Query: {user_query}{refine_hint}\n\n{format_instructions}"
    )
