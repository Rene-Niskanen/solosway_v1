---
name: ""
overview: ""
todos: []
isProject: false
---

# Velora USER.md and OpenClaw-Style Bootstrap — Implementation Plan

**Goal:** Replicate OpenClaw's exact design for workspace bootstrap files, starting with **USER.md**, so the model sees user/identity context on every turn. The implementation must be robust (encoding, truncation, missing files, config, tests) and extensible (IDENTITY.md, SOUL.md, etc. later).

---

## 1. OpenClaw's Exact Design (Reference)

### 1.1 File list and order

From [openclaw/workspace.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/workspace.ts) `loadWorkspaceBootstrapFiles`:

1. **AGENTS.md**
2. **SOUL.md**
3. **TOOLS.md**
4. **IDENTITY.md**
5. **USER.md**
6. **HEARTBEAT.md**
7. **BOOTSTRAP.md**
8. **MEMORY.md** and/or **memory.md** (one or both if present; deduped by realpath)

Sub-agent/cron sessions only get **AGENTS.md** and **TOOLS.md** (`filterBootstrapFilesForSession`). For Velora we do not have sub-agents; we can ignore filtering for now or later add a "minimal" mode.

### 1.2 Loading semantics

- Each entry: `{ name: WorkspaceBootstrapFileName, path: string, content?: string, missing: boolean }`.
- Read from workspace directory; on read error or missing file: `missing: true`, no content.
- OpenClaw caches by file path and mtime; we can do the same for file-based storage or skip cache for DB.

### 1.3 Truncation and caps (exact)

From [openclaw/pi-embedded-helpers/bootstrap.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-helpers/bootstrap.ts):

- **Per-file max:** `resolveBootstrapMaxChars(config)` → `agents.defaults.bootstrapMaxChars` or **20_000**.
- **Total max:** `resolveBootstrapTotalMaxChars(config)` → `agents.defaults.bootstrapTotalMaxChars` or **150_000**.
- **Missing file:** inject exactly: `[MISSING] Expected at: ${file.path}` (then clamp to remaining total budget).
- **Large file:** `trimBootstrapContent(content, fileName, maxChars)`:
  - If `content.length <= maxChars` → return content unchanged.
  - Else: **head** = first 70% of `maxChars`, **tail** = last 20% of `maxChars` (so 10% is the marker).
  - Marker (literal):

```
    [...truncated, read ${fileName} for full content...]
    …(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${originalLength})…
    

```

- Result: `head + "\n" + marker + "\n" + tail`.
- **Total budget:** Process files in order; for each file subtract injected length from `remainingTotalChars`. If `remainingTotalChars < 64` (MIN_BOOTSTRAP_FILE_BUDGET_CHARS), stop adding more files. Each file's content is also clamped to `remainingTotalChars` (truncate with "…" if over).

### 1.4 Injection into prompt

- Injected blocks are appended under **Project Context** (or equivalent section label). OpenClaw builds `EmbeddedContextFile[]` (path + content) and concatenates them into the system prompt. We will produce a single string "Project Context" section and append it to the system prompt (or workspace_section) in conversation, responder, planner, and agent nodes.

---

## 2. Velora scope (Phase 1: USER.md only)

- Implement the **same** truncation, caps, and missing-file logic as OpenClaw.
- **Phase 1:** Only **USER.md** is loaded and injected. File list for Phase 1: `["USER.md"]`. This keeps the first iteration small and testable.
- **Later phases:** Add IDENTITY.md, SOUL.md, etc. using the same pipeline (same order as OpenClaw when we add them).

---

## 3. Where USER.md content lives (storage)

OpenClaw uses a **workspace directory** on disk (e.g. `~/.openclaw/workspace/USER.md`). Velora is multi-tenant (user_id, business_id) and may not have a single workspace dir per user. Two robust options:

**Option A — File-based (OpenClaw-like)**  

- Workspace root from config (e.g. `VELORA_WORKSPACE_DIR` or per-business path).  
- Path for USER.md: `{workspace_root}/{business_id}/USER.md` or `{workspace_root}/user_{user_id}/USER.md`.  
- Pros: Same as OpenClaw; easy to edit by hand or via tools. Cons: Requires shared filesystem or per-instance path; less natural for hosted app.

**Option B — Database**  

- New table or column: e.g. `velora_bootstrap_files (business_id, user_id, name, content, updated_at)` or `user_profiles.user_md_content` (if one blob per user).  
- Load by (user_id, business_id) for `USER.md`.  
- Pros: Fits Supabase/Postgres; no filesystem. Cons: Need UI or API to edit.

**Recommendation (robust):** Implement a **provider abstraction** so we can support both. Define a small interface:

- `BootstrapProvider.get_bootstrap_files(scope: BootstrapScope) -> List[BootstrapFileEntry]`
- `BootstrapScope`: e.g. `user_id`, `business_id`, optional `workspace_dir` (for file-based).
- `BootstrapFileEntry`: `name: str`, `path_or_id: str`, `content: Optional[str]`, `missing: bool`

Phase 1 can ship with **one** provider (e.g. DB only or file-only). The pipeline (buildBootstrapContextFiles, truncation, injection) is identical; only the loader differs.

---

## 4. Implementation tasks (extremely robust)

### 4.1 Config

- **File:** [backend/llm/config.py](backend/llm/config.py)
- Add to `LLMConfig`:
  - `bootstrap_max_chars: int = 20_000` (env: `VELORA_BOOTSTRAP_MAX_CHARS`)
  - `bootstrap_total_max_chars: int = 150_000` (env: `VELORA_BOOTSTRAP_TOTAL_MAX_CHARS`)
- Validation: both must be positive integers; if invalid, log warning and use OpenClaw defaults (20_000, 150_000).

### 4.2 Constants and types

- **New file:** `backend/llm/bootstrap/constants.py` (or under `backend/llm/utils/` if you prefer no new package).
- Define:
  - `DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000`
  - `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000`
  - `MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64`
  - `BOOTSTRAP_HEAD_RATIO = 0.7`
  - `BOOTSTRAP_TAIL_RATIO = 0.2`
  - `BOOTSTRAP_FILE_ORDER_PHASE1: Tuple[str, ...] = ("USER.md",)`  # Phase 1; later extend to full OpenClaw order.
- TypedDict or dataclass: `BootstrapFileEntry`: `name: str`, `path_or_id: str`, `content: Optional[str]`, `missing: bool`.

### 4.3 Truncation and build (OpenClaw-exact)

- **New file:** `backend/llm/bootstrap/build.py` (or `bootstrap_context.py`).
- `**resolve_bootstrap_max_chars(config: LLMConfig) -> int`**  
Return `config.bootstrap_max_chars` if valid and > 0, else `DEFAULT_BOOTSTRAP_MAX_CHARS`.
- `**resolve_bootstrap_total_max_chars(config: LLMConfig) -> int**`  
Return `config.bootstrap_total_max_chars` if valid and > 0, else `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS`.
- `**trim_bootstrap_content(content: str, file_name: str, max_chars: int) -> Tuple[str, bool, int]**`  
  - Input: raw content, file name, per-file cap.  
  - If `len(content) <= max_chars`: return `(content.strip(), False, len(content))`.  
  - Else: head = 70% of max_chars, tail = 20% of max_chars; marker exactly as OpenClaw (two lines); return `(head + "\n" + marker + "\n" + tail, True, original_length)`.  
  - Use **UTF-8 safe** truncation: do not cut in the middle of a multi-byte character. Python: slice by character (unicode), not bytes; or use a small helper that truncates to last valid character boundary if you ever need byte limits.
- `**clamp_to_budget(content: str, budget: int) -> str`**  
If `len(content) <= budget` return content; else return `content[:budget-1] + "…"` (single Unicode ellipsis), with safe truncation.
- `**build_bootstrap_context_files(files: List[BootstrapFileEntry], max_chars: int, total_max_chars: int, warn: Optional[Callable[[str], None]] = None) -> str**`  
  - Iterate files in order. Maintain `remaining_total_chars = total_max_chars`.  
  - For each file:  
    - If `missing`: inject `[MISSING] Expected at: {path_or_id}`, clamp to `remaining_total_chars`, append to result, subtract length from remaining.  
    - Else: if `remaining_total_chars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS`, optionally call `warn` and break.  
    - `file_max = min(max_chars, remaining_total_chars)`. Trim with `trim_bootstrap_content`, then `clamp_to_budget(trimmed, remaining_total_chars)`. Append to result; subtract length from remaining. If truncated, call `warn` with a message.
  - Concatenate all injected blocks with a clear section header and optional per-file labels (e.g. `## Project Context\n\n### USER.md\n{content}`).  
  - Return the full string (or empty string if no files).

### 4.4 Provider: load USER.md

- **New file:** `backend/llm/bootstrap/loaders.py` (or single module `bootstrap_loader.py`).
- `**BootstrapScope`:** dataclass or TypedDict with `user_id: str`, `business_id: str`, optional `workspace_dir: Optional[str]`.
- `**BootstrapProvider`** (protocol or ABC):  
  - `get_bootstrap_files(scope: BootstrapScope, names: Sequence[str]) -> List[BootstrapFileEntry]`  
  - For each name in `names`, return an entry: content loaded or missing=True.
- **File-based provider (optional for Phase 1):**  
  - Given `scope.workspace_dir` and scope (e.g. `{business_id}/USER.md`), read file from disk; on OSError set missing=True. Path in entry = absolute path.
- **Database provider (recommended for Phase 1):**  
  - Table: e.g. `velora_bootstrap_files`: columns `id`, `business_id`, `user_id`, `name` (e.g. `USER.md`), `content` (text), `updated_at`. Unique on (business_id, user_id, name).  
  - Or: add column `user_md_content` to existing user/business profile table if that fits your schema.  
  - `get_bootstrap_files(scope, ["USER.md"])`: query by (scope.business_id, scope.user_id), name in names; for each requested name, if row exists and content not null return entry else missing=True, path_or_id = e.g. `db:{business_id}:{user_id}:USER.md`.
- **Resolver:** One function used by the rest of the app: `get_bootstrap_context(scope: BootstrapScope, config: LLMConfig) -> str`. It: (1) gets provider from config or default (e.g. DB), (2) calls `get_bootstrap_files(scope, BOOTSTRAP_FILE_ORDER_PHASE1)`, (3) calls `build_bootstrap_context_files(..., resolve_bootstrap_max_chars(config), resolve_bootstrap_total_max_chars(config))`, (4) returns the string. So the graph/nodes only call `get_bootstrap_context(scope, config)`.

### 4.5 Integration into system prompt

- **Conversation node:** [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py)  
  - Build `BootstrapScope(user_id=state.get("user_id"), business_id=state.get("business_id"))`.  
  - Call `get_bootstrap_context(scope, config)`. If non-empty, append to system content (e.g. after workspace_section or as a new section "## Project Context" / "## User context"). Prefer a single section "## Project Context" with USER.md content so we match OpenClaw wording.
- **Responder node:** [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py)  
  - Same: build scope from state, get bootstrap context, append to system content where workspace/project context is used.
- **Planner node:** [backend/llm/nodes/planner_node.py](backend/llm/nodes/planner_node.py)  
  - Same: scope from state, bootstrap context appended to planner system prompt if present.
- **Agent node:** [backend/llm/nodes/agent_node.py](backend/llm/nodes/agent_node.py)  
  - Same: scope from state, bootstrap context in system prompt.
- **Placement:** Prepend or append "Project Context" block so it is visible to the model; OpenClaw appends it after other sections. We can append after `workspace_section` so order is: turn context + base prompt + workspace (documents in scope) + **Project Context (USER.md)**.

### 4.6 Section label and format

- Use a single section header: `**## Project Context`** (OpenClaw uses this).  
- For Phase 1 (only USER.md): content can be either:
  - `## Project Context\n\n{content}` (no per-file subheader), or  
  - `## Project Context\n\n### USER.md\n{content}`
- Prefer the second so we can add more files later with `### IDENTITY.md`, etc., and so `/context list`-style tooling could mirror OpenClaw.

### 4.7 Robustness checklist

- **Encoding:** All file reads and DB text in **UTF-8**. When reading from disk, open with `encoding="utf-8"` and on decode error substitute or skip file (missing).
- **Empty content:** If USER.md exists but content is empty or whitespace, treat as valid (inject empty or a single newline); do not treat as missing.
- **Missing file:** Never crash. Inject `[MISSING] Expected at: ...` and continue.
- **Config:** Invalid or negative caps fall back to OpenClaw defaults and log warning.
- **Safe truncation:** Truncation by character count (len(content)); no mid-character slice. Ellipsis is one character (Unicode `\u2026` or ASCII `...` as you prefer; OpenClaw uses `…`).
- **Logging:** Log when a file is missing, when a file is truncated, and when total budget is exhausted early. Use optional `warn` callback in `build_bootstrap_context_files` and wire to logger in `get_bootstrap_context`.
- **Tests:** Unit tests for: (1) `trim_bootstrap_content` — under limit, over limit (head+tail+marker), (2) `build_bootstrap_context_files` — one file, multiple files, missing file, total cap exhausted, (3) `clamp_to_budget`. Optional: integration test that loads from DB or fixture file and asserts section appears in prompt.

### 4.8 Database schema (if Option B)

- **Table:** `velora_bootstrap_files`  
  - `id` (uuid or serial primary key)  
  - `business_id` (uuid, not null)  
  - `user_id` (uuid or int, not null)  
  - `name` (varchar, e.g. `USER.md`)  
  - `content` (text)  
  - `updated_at` (timestamptz)  
  - Unique constraint on `(business_id, user_id, name)`.
- Migration: create table; optional seed or leave empty so first time we inject `[MISSING] Expected at: db:...` until user/admin adds content via API or UI.

### 4.9 API or UI to edit USER.md (optional for Phase 1)

- If DB provider: need a way to set content. Options: (a) PATCH/PUT endpoint `/api/user/context` or `/api/bootstrap/USER.md` with body `{ "content": "..." }`, (b) Settings page in frontend that saves to that endpoint. Not required for the *plan* to be robust; the pipeline works with empty/missing content. Can be a follow-up task.

---

## 5. File and dependency summary


| Item               | File(s)                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config             | [backend/llm/config.py](backend/llm/config.py) — add `bootstrap_max_chars`, `bootstrap_total_max_chars`                                                                                                                                                                                                                     |
| Constants / types  | New: `backend/llm/bootstrap/constants.py` (or `utils/bootstrap_constants.py`)                                                                                                                                                                                                                                               |
| Truncation + build | New: `backend/llm/bootstrap/build.py` — `trim_bootstrap_content`, `clamp_to_budget`, `build_bootstrap_context_files`, `resolve_bootstrap_max_chars`, `resolve_bootstrap_total_max_chars`                                                                                                                                    |
| Loader / provider  | New: `backend/llm/bootstrap/loaders.py` — `BootstrapScope`, `BootstrapFileEntry`, `BootstrapProvider`, DB provider, optional file provider; and `get_bootstrap_context(scope, config)`                                                                                                                                      |
| Integration        | [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py), [responder_node.py](backend/llm/nodes/responder_node.py), [planner_node.py](backend/llm/nodes/planner_node.py), [agent_node.py](backend/llm/nodes/agent_node.py) — build scope, call `get_bootstrap_context`, append "## Project Context" |
| DB migration       | New migration for `velora_bootstrap_files` (if Option B)                                                                                                                                                                                                                                                                    |
| Tests              | New: `backend/llm/bootstrap/tests/test_build.py` (or `tests/unit/llm/bootstrap/`) — trim, build, clamp, missing                                                                                                                                                                                                             |


---

## 6. Order of implementation

1. Config + constants + types.
2. `build.py`: truncation and `build_bootstrap_context_files` (no I/O).
3. Unit tests for build.
4. Loader: DB provider (and table + migration) or file provider; then `get_bootstrap_context`.
5. Integration: one node first (e.g. conversation_node), verify section appears; then responder, planner, agent.
6. Optional: API to set USER.md content; optional: file-based provider.

---

## 7. OpenClaw alignment summary

- **File order:** Phase 1 = USER.md only; later = same order as OpenClaw (AGENTS, SOUL, TOOLS, IDENTITY, USER, HEARTBEAT, BOOTSTRAP, MEMORY).  
- **Per-file cap:** 20_000 chars (configurable).  
- **Total cap:** 150_000 chars (configurable).  
- **Missing:** `[MISSING] Expected at: {path}`.  
- **Truncation:** 70% head + marker + 20% tail, UTF-8 safe.  
- **Section:** "## Project Context" with optional "### USER.md" subheader.  
- **Injection:** Every turn, in conversation, responder, planner, and agent nodes, so the model always sees user context when present.

This plan replicates OpenClaw's exact bootstrap logic for USER.md and sets up the same pipeline for adding IDENTITY.md, SOUL.md, and other files later.