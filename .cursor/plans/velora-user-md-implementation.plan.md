---
name: ""
overview: ""
todos: []
isProject: false
---

# USER.md Implementation — Step-by-Step Checklist

**Scope:** USER.md only. One source of truth for "who is this user"; injected into system prompt every turn. Storage: database (Phase 1).

**Reference (for constants/strings only):** OpenClaw `workspace.ts`, `pi-embedded-helpers/bootstrap.ts`, `system-prompt.ts`. Use `rstrip()` only (trim end); ellipsis `\u2026`; empty content = skip; section `# Project Context` + intro line + `## USER.md` + content.

---

## Step 1: Config

**File:** `backend/llm/config.py`

- Add two attributes to `LLMConfig`:
  - `bootstrap_max_chars: int = 20_000` (env: `VELORA_BOOTSTRAP_MAX_CHARS`, default 20_000)
  - `bootstrap_total_max_chars: int = 150_000` (env: `VELORA_BOOTSTRAP_TOTAL_MAX_CHARS`, default 150_000)
- No validation in config; validation in the resolve_* functions (see Step 3).

**Done when:** `config.bootstrap_max_chars` and `config.bootstrap_total_max_chars` exist and are read from env with above defaults.

---

## Step 2: Constants and types

**New file:** `backend/llm/bootstrap/constants.py`

Create package `backend/llm/bootstrap/` (add `__init__.py` that exports public API used by loaders and nodes).

In `constants.py`:

- Constants (exact values):
  - `DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000`
  - `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000`
  - `MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64`
  - `BOOTSTRAP_HEAD_RATIO = 0.7`
  - `BOOTSTRAP_TAIL_RATIO = 0.2`
  - `USER_MD_FILENAME = "USER.md"`
  - `BOOTSTRAP_FILE_ORDER_PHASE1 = ("USER.md",)`
- TypedDict or dataclass `BootstrapFileEntry`:
  - `name: str`
  - `path_or_id: str` (display path, e.g. `"USER.md"` or `"db:..."` for missing)
  - `content: Optional[str]` (None when missing)
  - `missing: bool`

**Done when:** `from backend.llm.bootstrap.constants import BootstrapFileEntry, USER_MD_FILENAME, BOOTSTRAP_FILE_ORDER_PHASE1, ...` works.

---

## Step 3: Truncation and build (pure functions)

**New file:** `backend/llm/bootstrap/build.py`

Implement in order:

1. `**resolve_bootstrap_max_chars(config: LLMConfig) -> int`**
  - If `config.bootstrap_max_chars` is a positive int, return it.
  - Else return `DEFAULT_BOOTSTRAP_MAX_CHARS` from constants.
2. `**resolve_bootstrap_total_max_chars(config: LLMConfig) -> int**`
  - If `config.bootstrap_total_max_chars` is a positive int, return it.
  - Else return `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS`.
3. `**trim_bootstrap_content(content: str, file_name: str, max_chars: int) -> Tuple[str, bool, int]**`
  - `trimmed = content.rstrip()` (trim end only).
  - If `len(trimmed) <= max_chars`: return `(trimmed, False, len(trimmed))`.
  - Else: `head_chars = floor(max_chars * 0.7)`, `tail_chars = floor(max_chars * 0.2)`; `head = trimmed[:head_chars]`, `tail = trimmed[-tail_chars:]`. Marker string (exact):
    - Line 1: `"[...truncated, read " + file_name + " for full content...]"`
    - Line 2: `"\u2026(truncated " + file_name + ": kept " + str(head_chars) + "+" + str(tail_chars) + " chars of " + str(len(trimmed)) + ")\u2026"`
    - `marker = "\n" + line1 + "\n" + line2 + "\n"`
  - Return `(head + marker + tail, True, len(trimmed))`.
4. `**clamp_to_budget(content: str, budget: int) -> str**`
  - If `budget <= 0`: return `""`.
  - If `len(content) <= budget`: return `content`.
  - Else: return `content[: budget - 1] + "\u2026"`.
5. `**build_bootstrap_context_files(files: List[BootstrapFileEntry], max_chars: int, total_max_chars: int, warn: Optional[Callable[[str], None]] = None) -> List[Tuple[str, str]]**`
  - Returns list of `(path_for_display, content)` in order.
  - `remaining = max(1, total_max_chars)`.
  - For each file in `files`:
    - If `remaining <= 0`: break.
    - If `file.missing`: `text = "[MISSING] Expected at: " + file.path_or_id`; `capped = clamp_to_budget(text, remaining)`; if not capped: break. Append `(file.path_or_id, capped)` to result; `remaining -= len(capped)`; continue.
    - If `remaining < MIN_BOOTSTRAP_FILE_BUDGET_CHARS`: call warn and break.
    - `file_max = max(1, min(max_chars, remaining))`. `content = (file.content or "").rstrip()`; `trimmed, truncated, orig_len = trim_bootstrap_content(content, file.name, file_max)`; `within = clamp_to_budget(trimmed, remaining)`. If not within: continue. If truncated or len(within) < len(trimmed): call warn. Append `(file.path_or_id, within)`; `remaining -= len(within)`.
  - Return result list.
6. `**format_project_context_section(blocks: List[Tuple[str, str]]) -> str**`
  - If not blocks: return `""`.
  - Header: `"# Project Context\n\nThe following project context files have been loaded:\n\n"`
  - For each `(path, content)`: add `"## " + path + "\n\n" + content + "\n\n"`.
  - Return header + concatenation of the above.

**Done when:** Unit tests pass for trim (under/over limit), clamp (under/over budget), build (one file, missing file, empty content skipped).

---

## Step 4: Database table

**New migration** (Supabase or your migration tool):

- Table name: `velora_bootstrap_files`
- Columns:
  - `id`: uuid primary key default gen_random_uuid()
  - `business_id`: uuid not null
  - `user_id`: text not null (to match your existing user id type)
  - `name`: text not null (e.g. `USER.md`)
  - `content`: text (nullable)
  - `updated_at`: timestamptz default now()
- Unique constraint on `(business_id, user_id, name)`.
- Index on `(business_id, user_id, name)` for the load query.

**Done when:** Migration runs and table exists.

---

## Step 5: Loader and get_bootstrap_context

**New file:** `backend/llm/bootstrap/loaders.py`

1. `**BootstrapScope`** (dataclass or TypedDict): `user_id: str`, `business_id: str`.
2. `**load_user_md_from_db(scope: BootstrapScope) -> BootstrapFileEntry**`
  - Query Supabase (or your DB): `velora_bootstrap_files` where `business_id = scope.business_id`, `user_id = scope.user_id`, `name = 'USER.md'`, limit 1.
  - If no row or row.content is None/empty: return `BootstrapFileEntry(name="USER.md", path_or_id="USER.md", content=None, missing=True)`.
  - Else: return `BootstrapFileEntry(name="USER.md", path_or_id="USER.md", content=row["content"], missing=False)`.
  - Use UTF-8; on DB error log and return missing entry.
3. `**get_bootstrap_context(scope: BootstrapScope, config: LLMConfig) -> str**`
  - `files = [load_user_md_from_db(scope)]` (Phase 1: only USER.md).
  - `max_c = resolve_bootstrap_max_chars(config)`, `total_c = resolve_bootstrap_total_max_chars(config)`.
  - `blocks = build_bootstrap_context_files(files, max_c, total_c, warn=logger.warning)`.
  - Return `format_project_context_section(blocks)`.

**Done when:** Calling `get_bootstrap_context(BootstrapScope(user_id="...", business_id="..."), config)` returns either `""` (if missing/empty) or the full `# Project Context` section string.

---

## Step 6: Integration — conversation node

**File:** `backend/llm/nodes/conversation_node.py`

- After building `workspace_section` and before building `system_content` (or after building system_content and before sending to LLM):
  - `from backend.llm.bootstrap.loaders import get_bootstrap_context, BootstrapScope`
  - `scope = BootstrapScope(user_id=state.get("user_id") or "anonymous", business_id=state.get("business_id") or "")`
  - `project_context = get_bootstrap_context(scope, config)`
  - If `project_context`: append to system content. **Where:** Either pass `project_context` into `build_system_content` as an additional optional arg and append there, or append after `build_system_content` returns: `system_content = system_content + "\n\n" + project_context` (so Project Context is at the end of the system prompt).

**Done when:** In a conversation turn, with a row in `velora_bootstrap_files` for that user/business and name `USER.md`, the system prompt string contains `# Project Context` and `## USER.md` and the content.

---

## Step 7: Integration — responder node

**File:** `backend/llm/nodes/responder_node.py`

- In the block-citation path where system content is built (where `build_system_content("responder", state, ...)` is called and/or where `workspace_section` is appended):
  - Build `scope` from `state` (user_id, business_id). Call `get_bootstrap_context(scope, config)`. If non-empty, append to `system_content` after workspace (e.g. `system_content = system_content + "\n\n" + project_context`).

**Done when:** Document-path replies include Project Context in the system prompt when USER.md exists.

---

## Step 8: Integration — planner node

**File:** `backend/llm/nodes/planner_node.py`

- Where the planner system prompt is built (e.g. where `workspace_section` is appended to `planner_base`):
  - Build `scope` from state; call `get_bootstrap_context(scope, config)`; if non-empty, append to the planner system prompt string.

**Done when:** Planner sees Project Context in its system prompt when USER.md exists.

---

## Step 9: Integration — agent node

**File:** `backend/llm/nodes/agent_node.py`

- Where the agent system prompt is built (e.g. after adding `workspace_section` to `system_prompt.content`):
  - Build `scope` from state (user_id, business_id from state); call `get_bootstrap_context(scope, config)`; if non-empty, append to system prompt content.

**Done when:** Agent path sees Project Context when USER.md exists.

---

## Step 10: Unit tests

**New file:** `backend/llm/bootstrap/tests/test_build.py` (or `tests/unit/llm/bootstrap/test_build.py`)

- Test `trim_bootstrap_content`: content under limit returns unchanged; content over limit returns head + marker + tail, and marker contains `…` and "truncated".
- Test `clamp_to_budget`: under budget returns as-is; over budget returns prefix + `\u2026`.
- Test `build_bootstrap_context_files`: (1) single file present → one block; (2) file missing → one block with "[MISSING] Expected at:"; (3) file present but content empty string → no block (skipped); (4) total_max_chars very small → cap respected.
- Test `format_project_context_section`: empty list → ""; one block → string contains "# Project Context" and "## USER.md" and the content.

**Done when:** All tests pass.

---

## Quick reference: exact strings

- Ellipsis: `"\u2026"` (one character).
- Missing line: `"[MISSING] Expected at: " + path_or_id`
- Truncation line 1: `"[...truncated, read " + file_name + " for full content...]"`
- Truncation line 2: `"\u2026(truncated " + file_name + ": kept " + str(head_chars) + "+" + str(tail_chars) + " chars of " + str(orig_len) + ")\u2026"`
- Section header: `"# Project Context\n\nThe following project context files have been loaded:\n\n"`
- Per-file: `"## " + path + "\n\n" + content + "\n\n"`

---

## Implementation order (checklist)

- Step 1: Config
- Step 2: Constants and types + `backend/llm/bootstrap/__init__.py`
- Step 3: build.py (all six functions)
- Step 10: Unit tests for build + format
- Step 4: DB migration
- Step 5: loaders.py + get_bootstrap_context
- Step 6: conversation_node
- Step 7: responder_node
- Step 8: planner_node
- Step 9: agent_node

Optional later: API or UI to set USER.md content (PATCH body `{"content": "..."}` to a bootstrap endpoint).