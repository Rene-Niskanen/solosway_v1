---
name: ""
overview: ""
todos: []
isProject: false
---

# USER.md Implementation — High-Level Plan (OpenClaw-Exact, No Mistakes)

**Scope:** Implement **USER.md only** for Velora, replicating OpenClaw's bootstrap logic so the model sees user context on every turn. This plan analyses OpenClaw in detail and defines implementation steps that avoid common mistakes.

---

## Part 1: OpenClaw Deep Analysis

### 1.1 Where USER.md lives and how it’s loaded

**Source:** [openclaw/workspace.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/workspace.ts)

- **Path:** `path.join(resolvedDir, DEFAULT_USER_FILENAME)` with `DEFAULT_USER_FILENAME = "USER.md"`. Workspace dir is e.g. `~/.openclaw/workspace`.
- **Loading:** `loadWorkspaceBootstrapFiles(dir)` builds a fixed list of entries (AGENTS, SOUL, TOOLS, IDENTITY, **USER**, HEARTBEAT, BOOTSTRAP, then MEMORY/memory). For each entry it:
  - Tries `readFileWithCache(filePath)` (reads with `fs.readFile(filePath, "utf-8")`).
  - On **any error** (missing, unreadable, decode error): pushes `{ name, path: filePath, missing: true }` — **no content field**.
  - On success: pushes `{ name, path: filePath, content, missing: false }`.
- **No front-matter stripping at runtime.** `stripFrontMatter()` in workspace.ts is used only when **loading templates** for seeding new workspaces (e.g. from `docs/reference/templates/USER.md`). The content returned by `loadWorkspaceBootstrapFiles` is **raw file content**. So we must **not** strip YAML front matter from USER.md when injecting; inject as-is.

**Gotcha:** If we later allow optional front matter for metadata, strip it only when we explicitly decide to (e.g. config flag); default = raw like OpenClaw.

---

### 1.2 Truncation and caps (exact constants and logic)

**Source:** [openclaw/pi-embedded-helpers/bootstrap.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-helpers/bootstrap.ts)

**Constants (copy exactly):**


| Constant                            | Value     | Purpose                                         |
| ----------------------------------- | --------- | ----------------------------------------------- |
| `DEFAULT_BOOTSTRAP_MAX_CHARS`       | `20_000`  | Per-file character limit                        |
| `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS` | `150_000` | Total across all injected files                 |
| `MIN_BOOTSTRAP_FILE_BUDGET_CHARS`   | `64`      | Stop adding more files if remaining budget < 64 |
| `BOOTSTRAP_HEAD_RATIO`              | `0.7`     | Head = 70% of per-file limit                    |
| `BOOTSTRAP_TAIL_RATIO`              | `0.2`     | Tail = 20% of per-file limit                    |


**Config resolution:**

- `resolveBootstrapMaxChars(cfg)`: use `cfg?.agents?.defaults?.bootstrapMaxChars` only if `typeof raw === "number" && Number.isFinite(raw) && raw > 0`, then `Math.floor(raw)`; else `DEFAULT_BOOTSTRAP_MAX_CHARS`.
- `resolveBootstrapTotalMaxChars(cfg)`: same for `bootstrapTotalMaxChars`; else `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS`.

**trimBootstrapContent(content, fileName, maxChars):**

1. `trimmed = content.trimEnd()` — **only trim end**, not start.
2. If `trimmed.length <= maxChars`: return `{ content: trimmed, truncated: false, maxChars, originalLength: trimmed.length }`.
3. Else:
  - `headChars = Math.floor(maxChars * 0.7)`
  - `tailChars = Math.floor(maxChars * 0.2)`
  - `head = trimmed.slice(0, headChars)` (character slice)
  - `tail = trimmed.slice(-tailChars)` (character slice)
  - Marker (exact two lines, blank line before and after in the array):
    - Line 1: `[...truncated, read ${fileName} for full content...]`
    - Line 2: `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`
  - In OpenClaw: `const marker = ["", line1, line2, ""].join("\n")`; `contentWithMarker = [head, marker, tail].join("\n")`.
  - Return `{ content: contentWithMarker, truncated: true, maxChars, originalLength: trimmed.length }`.

**Gotcha:** The ellipsis in the second line is a **single Unicode character** `…` (U+2026), not three dots. Use it in our implementation.

**clampToBudget(content, budget):**

- If `budget <= 0`: return `""`.
- If `content.length <= budget`: return `content`.
- If `budget <= 3`: return `truncateUtf16Safe(content, budget)` (OpenClaw uses a UTF-16–safe slice so surrogates aren’t cut).
- Else: return `truncateUtf16Safe(content, budget - 1) + "…"` (again single `…`).

**Python note:** We don’t have UTF-16 surrogates; slicing by character index in Python is safe. We can do `content[: budget - 1] + "…"` but must ensure we don’t cut a combining character. Simplest: slice by character; for Python 3, `content[: budget - 1]` is character-based. Use `\u2026` for the ellipsis.

---

### 1.3 buildBootstrapContextFiles (order and budget)

**Source:** Same bootstrap.ts.

- Input: `files: WorkspaceBootstrapFile[]` (order matters), `opts?: { warn?, maxChars?, totalMaxChars? }`.
- `totalMaxChars = Math.max(1, Math.floor(opts?.totalMaxChars ?? Math.max(maxChars, DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS)))`.
- `remainingTotalChars = totalMaxChars`.
- For **each file in order**:
  - If `remainingTotalChars <= 0`: **break**.
  - If **file.missing**:
    - `missingText = "[MISSING] Expected at: " + file.path`
    - `cappedMissingText = clampToBudget(missingText, remainingTotalChars)`
    - If `!cappedMissingText`: break.
    - Decrement `remainingTotalChars` by `cappedMissingText.length`.
    - Push `{ path: file.path, content: cappedMissingText }` to result; **continue**.
  - If `remainingTotalChars < 64`: call `opts.warn` with message, **break**.
  - `fileMaxChars = Math.max(1, Math.min(maxChars, remainingTotalChars))`.
  - `trimmed = trimBootstrapContent(file.content ?? "", file.name, fileMaxChars)` — **empty content** is passed through; trim returns content "" and truncated false.
  - `contentWithinBudget = clampToBudget(trimmed.content, remainingTotalChars)`.
  - If `!contentWithinBudget`: **continue** (skip this file, don’t advance remaining).
  - If truncated or content was clamped: call `opts.warn`.
  - Decrement `remainingTotalChars` by `contentWithinBudget.length`.
  - Push `{ path: file.path, content: contentWithinBudget }`.

**Gotcha:** OpenClaw uses `file.content ?? ""`. So **null/undefined** becomes `""`. Empty string after trim stays empty; `clampToBudget("", budget)` returns `""`; then `if (!contentWithinBudget) continue` — so **empty files are skipped** and do not consume budget. We must do the same: empty content = skip, no block added.

---

### 1.4 How Project Context is rendered in the system prompt

**Source:** [openclaw/system-prompt.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/system-prompt.ts) (around lines 608–627 in the saved copy).

- **Before the block:** Lines include `"## Workspace Files (injected)"` and `"These user-editable files are loaded by OpenClaw and included below in Project Context."`
- **Filter:** `validContextFiles = contextFiles.filter(file => typeof file.path === "string" && file.path.trim().length > 0)` — skip entries with empty path.
- **If validContextFiles.length > 0:**
  - Push `"# Project Context"`, `""`, `"The following project context files have been loaded:"`.
  - If any file’s path basename (lowercase) is `"soul.md"`, push the SOUL persona line (we can ignore for USER.md-only).
  - Push `""`.
  - **For each file:** push ``## ${file.path}``, `""`, `file.content`, `""`.

So the **exact section structure** is:

```
# Project Context

The following project context files have been loaded:

## /absolute/path/to/USER.md

<content of USER.md>

```

For Velora we can use a logical path for display, e.g. `USER.md` or `db:business_id:user_id:USER.md`, so the model sees `## USER.md` and the content. No need to expose DB IDs.

**Gotcha:** OpenClaw uses **full file path** as the `##` heading. We can use `USER.md` for simplicity so the heading is `## USER.md`.

---

## Part 2: Implementation Tiers (High-Level)

### Tier 1: Config and constants (no I/O)

- Add `bootstrap_max_chars` (default 20_000) and `bootstrap_total_max_chars` (default 150_000) to LLM config; env vars optional.
- Define constants: `DEFAULT_BOOTSTRAP_MAX_CHARS`, `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS`, `MIN_BOOTSTRAP_FILE_BUDGET_CHARS`, `BOOTSTRAP_HEAD_RATIO`, `BOOTSTRAP_TAIL_RATIO`.
- Implement `resolve_bootstrap_max_chars(config)` and `resolve_bootstrap_total_max_chars(config)` with the same validation as OpenClaw (number, finite, > 0, else default).

### Tier 2: Truncation and build (pure functions, no I/O)

- Implement `trim_bootstrap_content(content: str, file_name: str, max_chars: int) -> Tuple[str, bool, int]`:
  - `trimmed = content.rstrip()` (trim end only).
  - If `len(trimmed) <= max_chars`: return `(trimmed, False, len(trimmed))`.
  - Else: head = 70%, tail = 20%, marker exactly as OpenClaw (two lines, use `\u2026` for ellipsis), return `(head + "\n" + marker + "\n" + tail, True, len(trimmed))`.
- Implement `clamp_to_budget(content: str, budget: int) -> str`: same logic; for Python use character slicing and append `"\u2026"` when truncating.
- Implement `build_bootstrap_context_files(files: List[BootstrapFileEntry], max_chars, total_max_chars, warn=None) -> List[Tuple[str, str]]` (or a small result type with path + content):
  - Same order and budget logic as OpenClaw; return list of (path, content) for each injected file.
  - Then a small helper that turns that list into the **section string**: `"# Project Context\n\nThe following project context files have been loaded:\n\n" + "\n\n".join("## " + path + "\n\n" + content for path, content in results)` (with blank lines as in OpenClaw).

**Checklist:** Unit tests for (1) trim: under limit, over limit (head+marker+tail), (2) clamp: under/over budget, (3) build: one file, missing file, empty content skipped, total cap.

### Tier 3: Load USER.md (one provider for Phase 1)

- **Scope:** `BootstrapScope(user_id, business_id)`.
- **Phase 1:** Single provider. Prefer **database**: table `velora_bootstrap_files (id, business_id, user_id, name, content, updated_at)` with unique (business_id, user_id, name). For name = `USER.md` load one row; if no row or content is null → entry `{ name: "USER.md", path_or_id: "db:...", missing: True }`; else `{ name: "USER.md", path_or_id: "USER.md", content: row.content, missing: False }`.
- **Path for display:** Use `"USER.md"` so the prompt shows `## USER.md`.
- No front-matter stripping; inject raw content.
- **Single entry point:** `get_bootstrap_context(scope: BootstrapScope, config: LLMConfig) -> str`:
  1. Get list with one entry for USER.md (from DB or file provider).
  2. Call `build_bootstrap_context_files` with config’s max/total.
  3. If result list is empty (e.g. no files requested or all skipped), return `""`.
  4. Else build the section string and return it.

### Tier 4: Wire into prompts

- **Conversation node:** Build scope from `state.get("user_id")`, `state.get("business_id")`. Call `get_bootstrap_context(scope, config)`. If non-empty, append to system content **after** workspace_section (or after memories) so order is: turn context + base + workspace + **Project Context (USER.md)**.
- **Responder node:** Same: scope from state, get section, append after workspace.
- **Planner node:** Same.
- **Agent node:** Same.
- Use the **exact section title**: `# Project Context` and `The following project context files have been loaded:` so behaviour and debugging match OpenClaw.

---

## Part 3: Mistakes to Avoid (from OpenClaw analysis)

1. **Don’t strip front matter** from USER.md content when injecting (OpenClaw only strips it for templates when seeding).
2. **Trim only end** of content before truncation (`trimEnd` / `rstrip`), not full strip.
3. **Use single Unicode ellipsis** `…` (U+2026) in truncation marker and in `clamp_to_budget`, not `...`.
4. **Missing file:** exact string `[MISSING] Expected at: ${file.path}`; path can be logical (e.g. `USER.md` or `db:...`) for display.
5. **Empty content:** skip file (no block, no budget consumed); do not inject an empty `## USER.md` block.
6. **Per-file limit:** apply **after** trim; use `trimmed` length for the “over limit” check.
7. **totalMaxChars:** when building, pass `Math.max(1, Math.floor(...))` so it’s at least 1; we do the same in Python.
8. **Section header:** use `# Project Context` (one `#`) and the exact intro line; then for each file `## {path}` then blank then content then blank.
9. **Config:** only use config values when they are a finite positive number; otherwise fall back to 20_000 and 150_000.
10. **Encoding:** read files or DB as UTF-8; on decode error treat as missing.

---

## Part 4: File and Integration Summary


| What                 | Where                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Config               | `backend/llm/config.py` — add two int settings with defaults 20_000, 150_000                                                |
| Constants + types    | New module e.g. `backend/llm/bootstrap/constants.py` — constants and `BootstrapFileEntry`                                   |
| Trim + clamp + build | New module e.g. `backend/llm/bootstrap/build.py` — pure functions, no I/O                                                   |
| Section string       | Same module or build: from list of (path, content) to full `# Project Context` block                                        |
| Loader               | New module e.g. `backend/llm/bootstrap/loaders.py` — scope, DB provider for USER.md, `get_bootstrap_context(scope, config)` |
| DB migration         | Table `velora_bootstrap_files` if using DB                                                                                  |
| Integration          | conversation_node, responder_node, planner_node, agent_node — append section when non-empty                                 |
| Tests                | Unit tests for trim, clamp, build (and optionally loader with in-memory or test DB)                                         |


---

## Part 5: Order of Work

1. Config + constants + types.
2. Trim and clamp (with tests).
3. build_bootstrap_context_files + section string (with tests, including missing and empty).
4. DB table + loader + `get_bootstrap_context`.
5. Integrate into one node (e.g. conversation), manually verify prompt contains `# Project Context` and `## USER.md`.
6. Integrate into the other three nodes.
7. Optional: API or UI to set USER.md content.

This plan keeps the implementation aligned with OpenClaw’s behaviour and avoids the pitfalls listed above.