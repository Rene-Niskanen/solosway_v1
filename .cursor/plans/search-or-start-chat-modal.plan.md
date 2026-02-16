---
name: Search or start a chat modal
overview: Implement a picture-perfect Search modal (Sidebar Search button + ⌘K) with exact proportions, clear UI-state logic, and full behind-the-scenes behaviour for 100% successful implementation.
todos: []
isProject: false
---

# Search or start a chat — modal implementation plan

**Visual reference:** Match the reference screenshots: centered white modal, search bar with light-grey input area, highlighted "New chat" row, "Recents >" list (chat bubble + title + optional right meta), and "Actions >" (Projects, **Files**, optional Upload file). Use **"Files"** not "Code". Icon size 22px and spacing as specified.

## Goal

Implement a **centered modal** that: (1) uses exact UI proportions and colours from the reference, (2) follows clear rules for what the UI shows in each state (empty vs typed query), and (3) defines full behind-the-scenes data flow and callbacks so implementation is 100% successful and picture-perfect.

---

## 1. UI specification (picture-perfect proportions)

### 1.1 Modal container

- **Position:** Centered in viewport (e.g. `fixed inset-0 flex items-center justify-center` with overlay).
- **Width:** `min(480px, calc(100vw - 32px))` so it doesn’t touch edges on small screens.
- **Background:** White `#FFFFFF`.
- **Border radius:** `12px` (rounded-xl).
- **Shadow:** `0 4px 24px rgba(0,0,0,0.08)` or similar so it floats above the page.
- **Padding:** `16px` (p-4) on all sides of the content area.
- **Close:** Small "X" in **top-right** of modal, ~32×32px hit area, grey icon. Escape and backdrop click also close.

### 1.2 Search bar (top)

- **Wrapper:** One full-width row; **background** slightly darker than modal: **#EEEEEE** or **#F0F0F0** (reference: "slightly darker light-grey background than the modal"). Rounded corners to match modal.
- **Input:**
  - Placeholder: **"Search or start a chat"** — grey `placeholder:text-gray-400`, font **14px**.
  - Height: **40px** (h-10). Padding `10px 12px` (pl-3 pr-3 py-2.5). No visible border or very subtle.
  - **Left:** Magnifying glass icon (Search), 20×20px, grey, inside the input row.
  - **Right:** Curved arrow (Enter/Return), 20×20px, grey — submit action.
- **Behaviour:** Typing updates local `query` state. Enter (or click submit icon) = submit as new chat (see Section 2). Clear (X) inside input optional; if present, only clears text, does not close modal.

### 1.3 "New chat" row

- **Layout:** Full-width row directly under the search bar. **Background:** **#F5F5F5** (reference: "slightly darker grey than the main modal" for this row).
- **Left:** Icon + label.
  - **Icon:** Circle with plus inside. Circle: **22×22px** (`h-[22px] w-[22px]`), rounded-full, **white fill**, **dark grey border** (e.g. `border border-gray-300`, `bg-white`). Plus icon inside: **12×12px**, dark grey (e.g. `text-gray-700` or `#374151`).
  - **Label:** "New chat", **13px** font, dark grey/black, medium or normal weight.
- **Right:** Same curved arrow icon as search bar (20×20px, grey). Indicates “submit / start”.
- **Row height:** ~44px (e.g. `py-2.5` + content). Padding horizontal consistent with modal (e.g. `px-3`).
- **Interaction:** Hover slightly darker (e.g. `hover:bg-gray-200/80`). Click: start new chat, close modal (same as “New chat” action in sidebar).

### 1.4 "Recents" section

- **Header:** Text **"Recents"** followed by **">"** (chevron), same line. **11px** or **12px**, **medium grey** (`text-gray-500` or `text-gray-600`). Spacing below header ~8px.
- **List:** From `useChatHistory()` — filter `!archived && !id.startsWith('property-')`, sort by `timestamp` desc. **Max 3–5** items when query is empty (reference shows 3).
- **Each row:**
  - **Left:** Chat bubble icon (MessageSquare), **22×22px** area, dark grey.
  - **Center:** Chat **title** (single line, truncate with ellipsis), **13px**, `text-gray-900`.
  - **Right:** Secondary text **11px** `text-gray-500` — e.g. "Tom Horner" or "Past month" (use `formatTimestamp` from ChatHistoryContext; for older than ~30 days show "Past month" if desired).
- **Row height:** ~40–44px; vertical gap between rows ~4–6px.
- **Interaction:** Hover light grey row bg. Click: **restore that chat** (`onChatSelect(chatId)`), close modal.

### 1.5 "Actions" section

- **Header:** **"Actions"** + **">"**, same style as "Recents >".
- **List (order matters for keyboard nav):**
  1. **Projects** — Folder/briefcase icon (22×22px), label "Projects". Click: navigate to Projects, close modal.
  2. **Files** — Angle brackets `</>` or folder icon (22×22px), label **"Files"** (not "Code"). Click: open Files view (Filing sidebar), close modal.
  3. **Upload file** (optional) — Upload icon, label "Upload file". Click: open Filing sidebar / trigger upload, close modal.
- Same row height and hover as Recents.

### 1.6 Typography and colours (quick reference)


| Element            | Font size | Color / class       | Notes                      |
| ------------------ | --------- | ------------------- | -------------------------- |
| Search placeholder | 14px      | gray-400            | "Search or start a chat"   |
| Search input bg    | —         | #EEEEEE / #F0F0F0   | Slightly darker than modal |
| New chat label     | 13px      | gray-900            |                            |
| New chat row bg    | —         | #F5F5F5             |                            |
| Section headers    | 11–12px   | gray-500 / gray-600 | "Recents >", "Actions >"   |
| List item title    | 13px      | gray-900            |                            |
| List item meta     | 11px      | gray-500            | Right-aligned subtitle     |
| Icons              | —         | gray-600 / gray-700 | 22px area; 20px for arrows |


---

## 2. UI logic: what the user sees (state → screen)

This section defines **exactly** what is shown so the UI is deterministic and matches the reference.

### 2.1 State variables

- `**query**` — Current search input (string). Empty string = "empty state".
- `**selectedIndex**` — 0-based index into the **flat list of selectable items** (keyboard highlight and Enter). Reset to 0 when `query` changes or when modal opens.

### 2.2 Flat list of selectable items (for keyboard and Enter)

Build one array in this **exact order** (used for Arrow Up/Down and Enter):

**When `query` is empty:**

1. **New chat** (one item)
2. **Recents** — up to 5 recent chats (each is one item)
3. **Actions** — in order: Projects, Files, (optional) Upload file

So: `[ newChat, recent1, recent2, recent3, projects, files, uploadFile? ]`.  
`selectedIndex` 0 = New chat; 1..5 = recents; then Projects, Files, Upload file.

**When `query` is non-empty:**

1. **New chat with query** — one item, label e.g. `New chat "${query}"`.
2. **Matching actions** (only if they match the query):
  - If query includes "upload": **Upload file**.
  - If query includes "project" / "projects" / "p": **Projects**.
  - If query includes "file" / "files": **Files**.
3. **Matching recents** — filter recents where `title` or `preview` contains `query` (case-insensitive); optional bold highlight on match in title.
4. (Optional) Matching files/projects from API.

For a minimal first version, when `query` is non-empty show:  
`[ newChatWithQuery, uploadFile? (if query~upload), projects? (if query~project), files? (if query~file), ...filteredRecents ]`.  
The **visible list and the flat list use the same order**. Highlight the row at `selectedIndex` (e.g. same #F5F5F5 bg as "New chat" row).

### 2.3 Section visibility (what appears on screen)

- **Always visible:** Search bar (top), Close (X).
- **Empty query:** Always show **New chat** row; section **"Recents >"** with up to 5 items; section **"Actions >"** with Projects, Files, (optional) Upload file.
- **Non-empty query:** Show **New chat "${query}"** row; show **Recents** header only if there are matching recents, list only matching chats; show **Actions** (or "Search results") only for items that match the query.
- **Hover / keyboard:** The row at `selectedIndex` gets light grey background (#F5F5F5) so it is clear which item will be activated on Enter.

### 2.4 Visual states summary


| State       | New chat row     | Recents               | Actions                    |
| ----------- | ---------------- | --------------------- | -------------------------- |
| Empty query | "New chat"       | "Recents >" + 3–5     | "Actions >" + P, F, Upload |
| Typed query | "New chat query" | Filtered list or none | Matched actions only       |


---

## 3. Behind the scenes: data flow and behaviour

### 3.1 On modal open

1. Set `query = ""`, `selectedIndex = 0`.
2. Focus the search input so the user can type immediately.
3. **Data:** Recents come from `useChatHistory()` (already in memory). Optional: on open, fetch **files** and **projects** once (e.g. `backendApi.getDocuments()`, `backendApi.getProjects()`) and store in local state so typing can show matching files/projects without delay.

### 3.2 On each keystroke (query change)

1. Update `query` from input value.
2. Reset `selectedIndex = 0`.
3. **Recents:** Filter `chatHistory` (same filter as above) where `title` or `preview` includes `query` (case-insensitive). Sort by timestamp desc. Cap at e.g. 5.
4. **Actions:** Decide which of [Projects, Files, Upload file] to show: show all when empty; when non-empty, show if label or keyword matches (e.g. "upload" → Upload file, "project"/"p" → Projects, "file" → Files).
5. **Flat list:** Rebuild the ordered list of items (new chat, then matching actions, then filtered recents, then optional files/projects). This list drives both rendering and keyboard `selectedIndex`.

### 3.3 On action (click or Enter)

- **New chat (no query):** Call `onNewChat()`, then `onOpenChange(false)`.
- **New chat with query:** Call `onNewChatWithQuery?.(query)` (or equivalent to prefill/submit the query in the chat input), then `onOpenChange(false)`.
- **Recent chat:** Call `onChatSelect(chatId)`, then `onOpenChange(false)`.
- **Projects:** Call `onNavigate('projects')`, then `onOpenChange(false)`.
- **Files:** Call `onOpenFiles()` (e.g. open Filing sidebar), then `onOpenChange(false)`.
- **Upload file:** Call `onUploadFile?.()` (e.g. open Filing sidebar and focus upload), then `onOpenChange(false)`.

After any action, always close the modal.

### 3.4 Keyboard

- **⌘K / Ctrl+K:** Open modal and focus input. When open, optionally ⌘K again to close.
- **Escape:** Close modal.
- **Arrow Down:** `selectedIndex = min(selectedIndex + 1, flatList.length - 1)`; scroll highlighted row into view if needed.
- **Arrow Up:** `selectedIndex = max(0, selectedIndex - 1)`.
- **Enter:** Run the action for `flatList[selectedIndex]` (same as click), then close.
- **Typing:** Handled by input; `query` and flat list update as above.

### 3.5 Data sources (reference)

- **Recents:** `useChatHistory()` → `chatHistory`. Filter: `!archived && !id.startsWith('property-')`. Sort by `timestamp` descending. Use `title` for label; subtitle = `formatTimestamp(new Date(chat.timestamp))` or "Past month" for very old (e.g. > 30 days).
- **Actions:** Static. Labels: "Projects", "Files", "Upload file". Match rules: "upload" → Upload file; "project"/"projects"/"p" → Projects; "file"/"files" → Files.
- **Files/Projects (optional):** When query is non-empty, optionally show matches from `backendApi.getDocuments()` and `backendApi.getProjects()`; filter by filename / title or client.

### 3.6 Closing the modal

- **Escape** key; **click** on overlay (backdrop); **click** the X button; **after any action** (new chat, recent, Projects, Files, Upload file) — always call `onOpenChange(false)`.

---

## 4. Component structure and wiring

### 4.1 New component: SearchOrStartChatModal

- **Location:** `frontend-ts/src/components/SearchOrStartChatModal.tsx`.
- **Uses:** `useChatHistory()` for recents; optional `backendApi.getDocuments()` / `getProjects()` when modal opens or when query changes (for file/project suggestions).
- **Props:**  
`open`, `onOpenChange`,  
`onNewChat`, `onNewChatWithQuery?: (query: string) => void`,  
`onChatSelect: (chatId: string) => void`,  
`onNavigate: (view: string) => void`,  
`onOpenFiles: () => void`,  
`onUploadFile?: () => void`.
- **Implementation:** Prefer existing `CommandDialog` + `Command` from `@/components/ui/command.tsx` (cmdk) for focus and keyboard; override styles so the modal matches this spec (input bg #EEEEEE, New chat row #F5F5F5, section headers "Recents >" / "Actions >", 22px icons, "Files" not "Code"). Alternatively implement with Radix Dialog + custom list and key handlers.

### 4.2 Where to render and triggers

- **Render:** Inside `DashboardLayout` (e.g. next to Sidebar and MainContent), so it has access to the same layout state and callbacks.
- **State:** `const [searchModalOpen, setSearchModalOpen] = useState(false)`.
- **Open triggers:**
  - **Sidebar:** Add a **Search** button below **New Chat** (collapsed and expanded). New prop `onOpenSearch?: () => void`; button calls `onOpenSearch?.()` which sets `searchModalOpen` to true.
  - **Global shortcut:** In `DashboardLayout`, `useEffect` on keydown: `(e.metaKey || e.ctrlKey) && e.key === 'k'` → `e.preventDefault()`, `setSearchModalOpen(true)`.

### 4.3 Callbacks (DashboardLayout → Modal)

- `onNewChat`: Same as Sidebar "New chat" (e.g. `handleRestoreActiveChat` + `handleNewChat`; clear restoreChatId, open chat panel, new agent).
- `onNewChatWithQuery(query)`: Open new chat and pass `query` into the chat input (prefill and optionally auto-submit depending on existing API). May require ref or callback from MainContent/SideChatPanel to set input value.
- `onChatSelect(chatId)`: Set `restoreChatId` / call existing `handleChatSelect`, ensure chat panel visible.
- `onNavigate('projects')`: `handleViewChange('projects')`.
- `onOpenFiles`: From `useFilingSidebar()`, call `openSidebar()` (and optionally set view to global).
- `onUploadFile`: Same as opening Files for now, or open sidebar and focus upload area if available.

### 4.4 Files to touch


| File                                                             | Purpose                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **New:** `frontend-ts/src/components/SearchOrStartChatModal.tsx` | Modal UI, flat list logic, keyboard, styling to match spec.                          |
| `frontend-ts/src/components/Sidebar.tsx`                         | Add Search button below New Chat; add prop `onOpenSearch`; call it on click.         |
| `frontend-ts/src/components/DashboardLayout.tsx`                 | State `searchModalOpen`; render modal; pass all callbacks; register ⌘K.              |
| `frontend-ts/src/components/ui/command.tsx`                      | Optional: overrides for input height 40px, input bg, group headings, item icon 22px. |


---

## 5. Summary checklist

- **Proportions:** Modal width max 480px, radius 12px, shadow; search input bg #EEEEEE/#F0F0F0, height 40px; New chat row bg #F5F5F5; section headers "Recents >", "Actions >"; 22px icons; labels "Files" and "Upload file" (not "Code").
- **UI logic:** Empty query → New chat + Recents (3–5) + Actions (Projects, Files, Upload file). Non-empty → New chat with query + matching actions + filtered recents; flat list order defined for keyboard.
- **Behaviour:** Open via Sidebar Search button and ⌘K; close via Escape, backdrop, X, or after any action; Arrow Up/Down + Enter on flat list; Enter in search submits as new chat (with or without query).
- **Data:** Recents from `useChatHistory()`; optional files/projects from API when modal opens or when query changes.
- **Wiring:** All callbacks from DashboardLayout; Sidebar receives `onOpenSearch` and renders Search button below New Chat.

This plan gives a single reference for picture-perfect proportions, exact UI-state rules, and full behind-the-scenes flow so implementation can be done correctly in one pass.