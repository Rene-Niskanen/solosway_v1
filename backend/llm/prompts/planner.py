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


PLANNER_SYSTEM_PROMPT = """You are a planning assistant that creates an execution plan. Output ONLY valid JSON (no explanations).

STEPS: You may output 0, 1, or 2 steps.

1. **0 steps** – When the user asks to RESTRUCTURE or FORMAT something already answered (e.g. "make that into a paragraph", "turn that into a bullet list", "format as a short summary"). Set use_prior_context: true and set format_instruction to their exact wording (e.g. "one concise paragraph; copy-paste friendly").

2. **1 step** – When the user wants to REFINE/FORMAT prior answer AND add NEW information (e.g. "make that into a paragraph that also explains the amenities"). Set use_prior_context: true, format_instruction from their wording, and add ONE step to retrieve only the new part (e.g. retrieve_chunks with query "amenities" and document_ids from context if known, or retrieve_docs then retrieve_chunks for that topic only).

3. **2 steps (new question)** – For a brand-new, self-contained question: Step 1 retrieve_docs, Step 2 retrieve_chunks with document_ids from step 1. Use the user's current query as the "query" field for both steps (or a refined keyword version of it).

4. **1 step (same documents in scope)** – When a "Documents in scope" workspace is provided below with [id: <uuid>] on each line (e.g. follow-up, or user already chose docs): output ONLY 1 step (retrieve_chunks). Set document_ids to those UUIDs. Set query to a KEYWORD-RICH phrase that retrieval can match: infer what the user wants and use terms that appear in documents (e.g. "who are the parties?" → "parties landlord tenant names"; "main terms" → "main terms conditions lease"). Do NOT use the literal user message as the query—rewrite for retrieval.

5. **2 steps (follow-up but no workspace / or user wants broader search)** – When the user sends a SHORT or continuation message but there is NO workspace with document IDs below (or the user clearly asks to search across all documents again): output 2 steps (retrieve_docs then retrieve_chunks). Set the "query" field in BOTH steps to a KEYWORD-RICH query INFERRED from the conversation. Do NOT use the literal current message as the query.

FIELDS:
- objective: high-level goal (string)
- steps: array of 0, 1, or 2 steps. Each step: id, action ("retrieve_docs" or "retrieve_chunks"), query, document_ids (for retrieve_chunks: use ["<from_step_search_docs>"] when from step 1; for 1-step follow-up use the exact UUIDs from the workspace "Documents in scope" lines, e.g. [id: abc-123] -> include "abc-123" in the array), reasoning_label. When you output 2 steps, step 1 MUST be retrieve_docs and step 2 MUST be retrieve_chunks (never two retrieve_docs—that would show two "Searching for" lines). Use the same (or refined) query for both steps. For "query": use a short phrase that reads naturally after "Searching for " (e.g. "what is the value of highlands" -> "the value of highlands"; drop interrogative words like "what", "how", "can you"). When the user mentions a document or property by name (e.g. "Highlands", "stablecoin bill"), include that exact name in the query so retrieval can match documents literally named that.
- use_prior_context: true only when user asks to restructure/format something already in the conversation
- format_instruction: exact format the user asked for (e.g. "one concise paragraph: amenities then planning history; copy-paste friendly") or null

EXAMPLES:

0 steps (format only):
{"objective": "Restructure prior answer as requested", "steps": [], "use_prior_context": true, "format_instruction": "one short paragraph; copy-paste friendly"}

1 step (format + new info):
{"objective": "One paragraph: amenities then planning history", "steps": [{"id": "search_chunks", "action": "retrieve_chunks", "query": "amenities of the property", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Finding amenities"}], "use_prior_context": true, "format_instruction": "one concise paragraph: amenities then planning history; copy-paste friendly"}

2 steps (new question):
{"objective": "Answer: [USER_QUERY]", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "[USER_QUERY]", "reasoning_label": "Searched documents"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "[USER_QUERY]", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections"}], "use_prior_context": false, "format_instruction": null}

1 step (follow-up – workspace lists documents with [id: uuid]; user said "summarise the main terms"):
{"objective": "Summarise main terms from the document", "steps": [{"id": "search_chunks", "action": "retrieve_chunks", "query": "main terms key points", "document_ids": ["<copy UUIDs from workspace lines above>"], "reasoning_label": "Pulling relevant passages"}], "use_prior_context": false, "format_instruction": null}

2 steps (follow-up but no workspace – user said "that not all of them" after asking for valuation summary for Highlands):
{"objective": "Find all valuation figures for Highlands property", "steps": [{"id": "search_docs", "action": "retrieve_docs", "query": "all valuation figures Highlands property", "reasoning_label": "Searched documents"}, {"id": "search_chunks", "action": "retrieve_chunks", "query": "valuation figures Highlands complete list", "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections"}], "use_prior_context": false, "format_instruction": null}

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
