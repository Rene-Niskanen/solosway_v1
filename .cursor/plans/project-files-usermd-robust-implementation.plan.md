# Project Files & USER.md — Robust Implementation Plan

**Goal:** USER.md card in Projects grid (same layout as project cards, peach icon), editor, backend API, and agent tools so Velora can read/write USER.md. Implementation must be exact and error-free on first try.

**OpenClaw reference:** Workspace files on disk; agent has `read`/`write`/`edit`/`apply_patch` (fs group). We use DB only; same semantics (read/write by name, scoped to user).

---

## Part 1: Backend API (exact spec)

### 1.1 GET /api/bootstrap/user-context

- **Auth:** `@login_required`. No auth → 401.
- **Scope:** `user_id = str(current_user.id)`, `business_id = _ensure_business_uuid()`.
- **Behavior:** If `business_id` is None or empty, return `400` with `{"error": "User is not associated with a business"}`.
- **Query:** No query params required. Optional `business_id` in query is ignored; always use session business.
- **DB:** `supabase.table("velora_bootstrap_files").select("content").eq("business_id", business_id).eq("user_id", user_id).eq("name", "USER.md").limit(1).execute()`.
- **Response:**
  - **200:** `{"content": "<string or null>"}`. If no row or `content` is null/empty, return `{"content": null}` (not 404).
  - **400:** No business.
  - **401:** Not logged in.
- **Encoding:** Response JSON; ensure content is UTF-8 (Supabase text is UTF-8).

### 1.2 PUT /api/bootstrap/user-context

- **Auth:** `@login_required`.
- **Scope:** Same `user_id`, `business_id` as GET. No business → 400.
- **Body:** JSON only. `{"content": "<string>"}`. Key must be `content`.
- **Validation:**
  - If body is not JSON or missing `content` key: **400** `{"error": "Missing or invalid body: expected { \"content\": \"...\" }"}`.
  - If `content` is not a string: **400** `{"error": "content must be a string"}`.
  - Max length: **150_000** characters (use `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS` from `backend.llm.bootstrap.constants`). If over: **400** `{"error": "content exceeds maximum length (150000 characters)"}`.
- **DB:** Upsert: `.upsert({"business_id": business_id, "user_id": user_id, "name": "USER.md", "content": content, "updated_at": "now()"}, on_conflict="business_id,user_id,name")`. Use Supabase upsert with `on_conflict` matching unique index `(business_id, user_id, name)`. Ensure `business_id` is UUID string; `user_id` is string.
- **Response:** **200** `{"success": true}`. On DB error log and return **500** `{"error": "Failed to save"}`.
- **CORS:** Same as other API routes (Origin, credentials if needed).

### 1.3 File and placement

- Add both routes in [backend/views.py](backend/views.py) (or a small blueprint if you prefer). Keep logic minimal; call a small helper if needed (e.g. `get_bootstrap_user_context(user_id, business_id)` / `upsert_bootstrap_user_context(user_id, business_id, content)` that use Supabase). Do not duplicate scope resolution; use the same `_ensure_business_uuid()` and `current_user.id` pattern as chat/session routes.

---

## Part 2: Frontend (exact spec)

### 2.1 API client

- **File:** [frontend-ts/src/services/backendApi.ts](frontend-ts/src/services/backendApi.ts).
- **Add:**
  - `getBootstrapUserContext(): Promise<{ success: boolean; content?: string | null; error?: string }>`  
    GET `/api/bootstrap/user-context`. On 200 return `{ success: true, content: data.content }`. On 4xx/5xx return `{ success: false, error: body?.error || statusText }`. Use same `fetch`/credential pattern as other backendApi methods.
  - `putBootstrapUserContext(content: string): Promise<{ success: boolean; error?: string }>`  
    PUT `/api/bootstrap/user-context` with body `JSON.stringify({ content })`, `Content-Type: application/json`. On 200 return `{ success: true }`. On 4xx/5xx return `{ success: false, error: body?.error || statusText }`.
- **Validation:** In `putBootstrapUserContext`, optionally clamp `content.length` to 150_000 before sending to avoid server rejection (or let server reject and show error).

### 2.2 USER.md card (same placement as project cards)

- **Location:** [frontend-ts/src/components/ProjectsPage.tsx](frontend-ts/src/components/ProjectsPage.tsx). Projects grid: same `gridTemplateColumns`, `gridAutoRows`, `gap` as existing project cards.
- **Structure:** First child of the grid = USER.md card. Reuse the same wrapper structure as [ProjectGlassCard](frontend-ts/src/components/ProjectGlassCard.tsx) inner content:
  - Outer: `div` with `className="flex flex-col items-center w-full h-full min-w-0"`, `style={{ borderRadius: '12px', border: '2px solid transparent', padding: '12px', ... }}` (match ProjectGlassCard so height aligns).
  - Icon area: `div` 140×122, `img` with `src="/user.md.png"`, `alt="USER.md"`, `className="... object-contain"`.
  - Label: `p` below icon, single line, truncate with ellipsis, text "USER.md" (or "User context"), same font size/weight as project name (13px, 500).
- **Click:** Set state to open the editor (modal/sheet). Do not navigate away.
- **Asset:** [frontend-ts/public/user.md.png](frontend-ts/public/user.md.png) already exists; use `/user.md.png`.

### 2.3 Editor modal/sheet

- **Component:** New component (e.g. `UserContextEditorModal` or inline in ProjectsPage). Use a Dialog/Modal (existing UI lib: e.g. Radix Dialog or similar in the project).
- **Open:** When USER.md card is clicked; pass `onClose` to reset open state.
- **Load:** On open, call `getBootstrapUserContext()`. Show loading state until response. If `success` and `content != null`, set textarea value to `content`; else set to `""`.
- **Body:** Textarea (or simple text input area), full width, min height ~200px. Optional: character count (e.g. "12,345 / 150,000 characters").
- **Save button:** On click: call `putBootstrapUserContext(trimmedContent)`. On success: close modal and optionally show a short success toast. On failure: show `error` in the modal (e.g. below textarea) and do not close.
- **Cancel/Close:** Reset form and close without saving.
- **Edge cases:** Empty content is valid (saves as empty string). Do not submit if request already in flight (disable Save while loading/saving).

---

## Part 3: Agent tools (exact spec)

### 3.1 Tool: read_workspace_file

- **Name:** `read_workspace_file`.
- **Args (for LLM):** `file_name: str` (required). No `user_id`/`business_id` in schema — injected by ExecutionAwareToolNode.
- **Implementation:** Accept `file_name`, `user_id`, `business_id` (injected). Allowlist: `["USER.md"]`. If `file_name` not in allowlist, return `"[error] Only USER.md is supported. Requested: <file_name>."`. Load from `velora_bootstrap_files` with `(business_id, user_id, name=file_name)`. If no row or content null/empty, return `"[empty]"`. Else return content (string). On DB error log and return `"[error] Failed to read file."`.
- **Return:** Plain string (content or error message).

### 3.2 Tool: write_workspace_file

- **Name:** `write_workspace_file`.
- **Args (for LLM):** `file_name: str`, `content: str`. No `user_id`/`business_id` in schema — injected.
- **Implementation:** Allowlist `["USER.md"]`. If `file_name` not in allowlist, return `"[error] Only USER.md is supported."`. Truncate `content` to `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS` (150_000); if truncated, append to return message " Content was truncated to 150000 characters." Upsert row: `(business_id, user_id, name=file_name, content=truncated_content, updated_at=now())`, same unique key. On DB error log and return `"[error] Failed to write file."`. On success return `"Saved USER.md successfully."` (plus truncation note if applicable).
- **Return:** Plain string.

### 3.3 Tool: list_workspace_files (optional)

- **Name:** `list_workspace_files`.
- **Args:** None (or optional; no injection needed). Return `"Available files: USER.md"` or JSON list for future extensibility.

### 3.4 Tool implementation module

- **New file:** [backend/llm/tools/workspace_file_tool.py](backend/llm/tools/workspace_file_tool.py).
- **Content:**
  - Pydantic args: `ReadWorkspaceFileInput(file_name: str)`, `WriteWorkspaceFileInput(file_name: str, content: str)`. Add optional `user_id`, `business_id` with default None for injection.
  - Functions: `read_workspace_file_impl(file_name, user_id=None, business_id=None)`, `write_workspace_file_impl(file_name, content, user_id=None, business_id=None)`. Both validate allowlist; write truncates and upserts. Use `get_supabase_client().table("velora_bootstrap_files")`.
  - `create_read_workspace_file_tool()`, `create_write_workspace_file_tool()` returning `StructuredTool.from_function(..., args_schema=...)`. Descriptions must tell the LLM when to use (e.g. "Read the content of USER.md (user context). Use when the user asks what's in their profile or USER.md.").
- **Allowlist:** Single constant `WORKSPACE_FILE_ALLOWLIST = ("USER.md",)`.

### 3.5 Injection in ExecutionAwareToolNode

- **File:** [backend/llm/nodes/tool_execution_node.py](backend/llm/nodes/tool_execution_node.py).
- **In the same block where you inject `business_id` for `retrieve_documents`/`retrieve_chunks`:** For `name == "read_workspace_file"` inject `args["user_id"] = state.get("user_id") or "anonymous"` and `args["business_id"] = state.get("business_id") or ""`. For `name == "write_workspace_file"` inject the same. Append the injected_tool_calls with these updated args.
- **Emit execution events:** For `read_workspace_file` / `write_workspace_file` add a branch (e.g. description "Read USER.md" / "Updated USER.md") so the UI can show execution feedback if needed.

### 3.6 Register tools in agent and graph

- **Agent node:** [backend/llm/nodes/agent_node.py](backend/llm/nodes/agent_node.py). Import `create_read_workspace_file_tool`, `create_write_workspace_file_tool`. Add both to `all_tools` (e.g. `all_tools = [plan_step] + list(retrieval_tools) + [citation_tool] + [create_read_workspace_file_tool(), create_write_workspace_file_tool()]`). Order is optional but keep retrieval tools together.
- **Graph tools node:** [backend/llm/graphs/main_graph.py](backend/llm/graphs/main_graph.py). The node passed to `ExecutionAwareToolNode` must include every tool the agent can call. **Add** `create_read_workspace_file_tool()` and `create_write_workspace_file_tool()` to the list of tools passed to `ExecutionAwareToolNode`. So the tools list becomes at least: `[create_document_retrieval_tool(), create_chunk_retrieval_tool(), create_read_workspace_file_tool(), create_write_workspace_file_tool()]`. If the agent node binds additional tools (e.g. plan_step, citation_tool), the graph’s tools list must include those too or those tool calls will fail at runtime; add workspace tools to whatever list is currently passed to `ExecutionAwareToolNode`.

---

## Part 4: Error and edge cases (checklist)

- **API**
  - GET with no business → 400, not 500.
  - PUT with non-JSON body → 400.
  - PUT with `content` missing or not string → 400.
  - PUT with `content.length > 150_000` → 400.
  - All responses are JSON; no HTML error pages for these routes.
- **Frontend**
  - Editor: empty content is valid; do not block save.
  - Network errors: show error string from API or "Network error".
  - Do not double-submit Save (disable while loading/saving).
- **Tools**
  - `file_name` not in allowlist → clear error string, no crash.
  - Missing `user_id`/`business_id` after injection → treat as anonymous/empty; DB may return no row (read returns "[empty]", write may need to handle missing business_id if your schema requires it — ensure injection always sets them from state).
  - Write: always truncate to 150_000 before DB; log when truncated.
- **DB**
  - `velora_bootstrap_files.business_id` is UUID type; pass string that Supabase accepts (e.g. `str(uuid)`). `user_id` is TEXT; pass `str(current_user.id)` in API and `str(state.get("user_id") or "anonymous")` in tools.
  - Upsert: use Supabase `.upsert(..., on_conflict="business_id,user_id,name")` or equivalent so one row per (business_id, user_id, name).

---

## Part 5: Implementation order

1. **Backend API** — GET/PUT in views.py, validation and status codes as above. Test with curl/Postman: 401 without auth, 400 when no business or invalid body, 200 with correct body.
2. **Bootstrap truncation marker (optional)** — Align with OpenClaw: in [backend/llm/bootstrap/build.py](backend/llm/bootstrap/build.py) use marker with blank line before/after (head + "\n\n" + line1 + "\n" + line2 + "\n\n" + tail). One-line change.
3. **Workspace file tools** — New workspace_file_tool.py; allowlist, read/write impl, create_*_tool(); inject user_id/business_id in tool_execution_node.py; register in agent_node and in main_graph tools list.
4. **Frontend API** — getBootstrapUserContext, putBootstrapUserContext in backendApi.
5. **USER.md card** — First grid cell in ProjectsPage, same layout as ProjectGlassCard, icon user.md.png, label "USER.md", click opens editor.
6. **Editor** — Modal, load on open (GET), Save (PUT), error display, loading/disable state.
7. **Smoke test** — Log in, open Projects, click USER.md, edit and save; in chat ask "What's in my USER.md?" and "Update my USER.md to say I'm a property solicitor"; confirm read/write tools are called and content persists.

---

## Part 6: OpenClaw alignment (summary)

- **OpenClaw:** Workspace = directory; files = real files; agent has read/write/edit tools. Bootstrap files (USER.md, etc.) loaded at session start and injected into prompt; user edits files externally or via tools.
- **Us:** Workspace = DB table; "files" = rows keyed by name; agent has read_workspace_file and write_workspace_file. USER.md injected into prompt from DB; user edits via Projects UI or via chat (tools). Same semantics (read by name, write by name, one scope per user/business); no filesystem.

No plan changes required for OpenClaw beyond what’s above; this plan is self-contained and implementation-ready.

---

## Part 7: Pre-requisites

- **Migration:** Table `velora_bootstrap_files` must exist (run [backend/migrations/create_velora_bootstrap_files.sql](backend/migrations/create_velora_bootstrap_files.sql) if not already applied). GET/PUT and tools will fail otherwise.
- **Auth:** User must be logged in and have a business (same as chat); `_ensure_business_uuid()` and `current_user.id` must be available in the request context.
