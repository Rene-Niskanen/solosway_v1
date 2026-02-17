---
name: ""
overview: ""
todos: []
isProject: false
---

# Central Usage Tracking and Billing UI — Implementation Plan (v2)

Expert-level plan for a reliable usage-tracking pipeline and UI that matches the reference design. No hardcoded page counts; assume Professional tier; page count sourced from existing documents.

---

## 1. Page count pipeline (single source of truth, callable anytime)

### 1.1 Definition

- **"Pages used this month"** = sum of `page_count` over all documents that:
  - belong to the current user's business (`business_uuid` = current business),
  - have `status = 'completed'`,
  - have `created_at` within the **current billing month (UTC)**.
- **Billing month** = calendar month in UTC (1st 00:00:00 to last day 23:59:59.999). No timezone ambiguity: use UTC for both storage and queries.

### 1.2 Backend: one function, one place

- **File**: `backend/services/usage_service.py` (new).
- **Function**: `get_pages_used_this_month(business_uuid: str) -> int`
  - Query Supabase `documents`: `business_uuid` = given, `status` = `'completed'`, `created_at` in current month (UTC).
  - Select only `id, page_count, created_at` (or `page_count` only).
  - Filter in Python or via Supabase: `created_at >= month_start_utc` and `created_at < next_month_start_utc` (use `.gte()` and `.lt()` if available, else fetch and filter).
  - Return `sum(page_count or 0 for each row)`.
  - No caching inside this function; every call is a fresh read. Callable from API, tasks, or scripts anytime.
- **Helpers in same module**:
  - `get_current_billing_month_utc() -> (str, datetime, datetime)` returning `(yyyy_mm, start_utc, end_utc)` for the current UTC month.
  - `get_usage_for_api(business_uuid: str, user_id=None)` (see below) uses `get_pages_used_this_month(business_uuid)` and tier config to build the API payload.

### 1.3 Tier config (no hardcoding of plan per user)

- In `usage_service.py` (or a small `backend/config/billing.py`), define from [BILLING_SPEC.md](BILLING_SPEC.md):
  - `TIER_LIMITS = {'personal': 500, 'professional': 2000, 'business': 5000}`.
  - `DEFAULT_TIER = 'professional'` (assumed tier for all users until real billing exists).
- **No** `if email == 'admin@solosway.com'`. Everyone gets `monthly_limit = TIER_LIMITS[DEFAULT_TIER]`, `plan = DEFAULT_TIER`.

### 1.4 API: GET /api/usage

- **Route**: `GET /api/usage` in [backend/views.py](backend/views.py), `@login_required`.
- **Logic**:
  - `business_uuid = _ensure_business_uuid()`; if missing, return 400.
  - Call `usage_service.get_usage_for_api(business_uuid, user_id=current_user.id)`.
- `**get_usage_for_api**`:
  - `pages_used = get_pages_used_this_month(business_uuid)`.
  - `plan = DEFAULT_TIER`, `monthly_limit = TIER_LIMITS[plan]`.
  - `remaining = max(0, monthly_limit - pages_used)`.
  - `usage_percent = round((pages_used / monthly_limit) * 100, 2)` if monthly_limit > 0 else 0.
  - `billing_cycle_start`, `billing_cycle_end` from `get_current_billing_month_utc()` (ISO date strings, e.g. `2026-02-01`, `2026-02-28`).
  - Return dict: `plan`, `monthly_limit`, `pages_used`, `remaining`, `usage_percent`, `billing_cycle_start`, `billing_cycle_end`, optionally `user_email` for display.
- **Response**: `jsonify({ 'success': True, 'data': <dict> })`. On error, 500 with message.

### 1.5 Supabase documents table

- Ensure `documents` has:
  - `page_count` (integer, already present per migrations).
  - `created_at` (timestamp; set on insert in [document_storage_service.py](backend/services/document_storage_service.py) — already present).
- If `created_at` is stored in a different timezone, document it and ensure the usage query uses UTC boundaries for the billing month.

### 1.6 Optional: increment on processing (for future monthly_usage table)

- For this phase, **no** `monthly_usage` table is required: the single source of truth is the sum over `documents` for the current month. Later, if you add `monthly_usage` for reporting or locking, the pipeline can still expose "callable anytime" by either (a) keeping this document-based sum as the source and syncing to `monthly_usage`, or (b) reading from `monthly_usage` and ensuring it is updated on every successful doc completion. This plan keeps (a) so implementation is simple and 100% reliable.

---

## 2. Frontend: API client and types

- **File**: [frontend-ts/src/services/backendApi.ts](frontend-ts/src/services/backendApi.ts).
- Add type: `UsageResponse = { plan: string; monthly_limit: number; pages_used: number; remaining: number; usage_percent: number; billing_cycle_start: string; billing_cycle_end: string; user_email?: string }`.
- Add method: `getUsage(): Promise<ApiResponse<UsageResponse>>` calling `GET /api/usage`, parsing `response.data` from the `data` field.

---

## 3. Sidebar: usage card above profile (match reference image)

### 3.1 Placement and structure

- **Where**: In [frontend-ts/src/components/Sidebar.tsx](frontend-ts/src/components/Sidebar.tsx), the usage card is a **fixed block above the profile strip** (avatar + plan label), in the same column. So the vertical order is: **[Usage card]** → **[Profile button (avatar + name + plan)]**. The card is always visible when the sidebar is visible (not inside the account dropdown).
- **Both sidebar variants**: Render the same card in (1) the collapsed sidebar and (2) the expanded sidebar, each time above the profile strip in that variant. Avoid duplicating large JSX: extract a single `<UsageCard />` component (can live in Sidebar.tsx or a small `UsageCard.tsx`) that receives `usage`, `loading`, `onGoToUsageBilling`.

### 3.2 Card design (match reference)

- **Container**: White card, rounded corners (e.g. `rounded-lg`), subtle shadow (e.g. `shadow` or `boxShadow: '0 4px 12px rgba(0,0,0,0.1)'`), padding (e.g. `p-3`). Matches the "Almost There!" style card.
- **Layout**:
  - **Row 1**: Title (left) + percentage pill (right). Title: bold, dark text, e.g. "Your Usage This Month" (or dynamic later by threshold). Pill: rounded-full, red-orange background (e.g. `bg-orange-500` or `#e85d04`-style), white text, e.g. "42%".
  - **Row 2**: One or two lines of description: "843 of 2,000 pages used" and "1,157 pages remaining" (from API: `pages_used`, `monthly_limit`, `remaining`).
  - **Row 3**: **Segmented progress bar**: horizontal bar made of small vertical segments (e.g. 20–40 segments). Filled segment count = `Math.round((usage_percent / 100) * segmentCount)`. Filled segments: red-orange gradient (e.g. from red to orange); unfilled: light grey. Height thin (e.g. 6–8px).
  - **Row 4**: Button: label **"Go to Usage & Billing"**. Style: rounded, light grey background, dark text (match "Go to checklist" from reference). On click: close dropdown if open, then navigate to Settings with the Usage & Billing section selected (see §4).

### 3.3 Data and states

- **Fetch**: When Sidebar mounts (or when the usage card is first visible), call `backendApi.getUsage()`. Store result in state (e.g. `usageData: UsageResponse | null`, `usageLoading: boolean`, `usageError: boolean`).
- **Loading**: Show a minimal skeleton (e.g. grey placeholder bar and "Loading..." or just the card frame with a spinner).
- **Error**: Show card with "Unable to load usage" and still show "Go to Usage & Billing" so user can try again from the full page.
- **Empty / no business**: If API returns 400 (no business), hide the card or show "No usage data" so the sidebar doesn’t break.

### 3.4 Plan label in profile strip

- Where the sidebar currently shows "Free plan", replace with the plan name from `usageData?.plan` when available (e.g. "Professional"); otherwise keep "Free plan". Use the same logic in both collapsed and expanded profile strips.

---

## 4. Navigation: "Go to Usage & Billing" → Settings with category open

- **Requirement**: Clicking "Go to Usage & Billing" must open the **Settings** view and select the **Usage & Billing** category so the user lands directly on that section.
- **Implementation**:
  - **Option A (recommended)**: Extend navigation to support an optional "open category" for settings.
    - In [DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx): add state e.g. `settingsOpenCategory: string | null`. When `handleViewChange` is called, accept an optional second argument `options?: { openCategory?: string }`. If `viewId === 'settings'` and `options?.openCategory === 'usage-billing'`, set `settingsOpenCategory` to `'usage-billing'` (and clear it when leaving settings or after applying).
    - Pass `settingsOpenCategory` (or `initialSettingsCategory`) to [MainContent](frontend-ts/src/components/MainContent.tsx). MainContent passes it to `SettingsView` as `initialCategory`.
  - In **SettingsView** (MainContent.tsx): accept `initialCategory?: string`. In `useEffect` on mount or when `initialCategory` changes, if `initialCategory` is set, call `setActiveCategory(initialCategory)`. This way the first time we render settings with `initialCategory='usage-billing'`, the Usage & Billing section is selected.
  - **Sidebar**: On "Go to Usage & Billing" click, call `onNavigate?.('settings', { openCategory: 'usage-billing' })`. Ensure `Sidebar`’s `onNavigate` type accepts the optional second parameter and that DashboardLayout’s handler passes it through.

---

## 5. Settings: "Usage & Billing" section

### 5.1 Nav and content

- In [MainContent.tsx](frontend-ts/src/components/MainContent.tsx), add to `settingsCategories`:
  - `{ id: 'usage-billing', label: 'Usage & Billing', icon: CreditCard }` (or BarChart3). Import the icon from lucide-react.
- In `renderSettingsContent()`, add:
  - `case 'usage-billing': return <UsageAndBillingSection />;`

### 5.2 UsageAndBillingSection component

- **Location**: New file `frontend-ts/src/components/UsageAndBillingSection.tsx` (or a section inside MainContent if you prefer to avoid an extra file). Fetches usage on mount via `backendApi.getUsage()`.
- **A. Subscription overview card**
  - Plan: e.g. "Professional – $49/month" (from `plan` + static map of labels/prices from BILLING_SPEC).
  - User: current user email (from API or auth context).
  - Monthly limit, usage, remaining, consumption % (e.g. "42.15%").
  - Button: "Upgrade Plan" — present but disabled (no onClick).
  - Text: "Renews in X days" — compute from `billing_cycle_end` (difference from today in days); if invalid, show "Renews at end of month" or similar.
- **B. Detailed visual usage component**
  - Larger progress bar (or same segmented style as sidebar for consistency) with percentage prominently displayed.
  - Copy: "{pages_used} / {monthly_limit} pages", "{remaining} pages remaining", "{usage_percent}% of monthly allowance used".
  - Optional: colour by threshold (green &lt; 50%, yellow 50–79%, orange 80–89%, red 90%+) per BILLING_SPEC for future consistency; for now a single style is fine.

### 5.3 Loading and error

- Show loading state while `getUsage()` is in progress; on error, show a message and optionally a retry button.

---

## 6. Implementation order (for zero-friction execution)

1. **Backend**
  - Add `backend/services/usage_service.py`: billing month helpers, `get_pages_used_this_month(business_uuid)`, tier config, `get_usage_for_api(...)`.
  - Add `GET /api/usage` in views.py; ensure `_ensure_business_uuid()` and error handling.
  - Verify Supabase `documents` has `created_at` and `page_count`; confirm date filter works in UTC.
2. **Frontend API**
  - Add `UsageResponse` type and `getUsage()` in backendApi.ts.
3. **Navigation**
  - Extend `onNavigate` and DashboardLayout to support `openCategory` for settings; SettingsView `initialCategory` and set `activeCategory` when provided.
4. **Sidebar usage card**
  - Create `UsageCard` (or inline in Sidebar): fetch usage, render card with title, pill %, description, segmented bar, "Go to Usage & Billing" button. Place above profile strip in both sidebar variants. Update plan label to show "Professional" when usage data exists.
5. **Settings**
  - Add "Usage & Billing" category and `UsageAndBillingSection`; implement overview card and detailed usage block.

---

## 7. Testing checklist

- `get_pages_used_this_month(business_uuid)` returns 0 when no completed docs in current month; returns correct sum when there are completed docs with `page_count` and `created_at` in current month.
- `GET /api/usage` returns 200, `plan: 'professional'`, `monthly_limit: 2000`, `pages_used` = actual sum, `remaining` and `usage_percent` correct.
- Sidebar shows usage card above profile with correct numbers and segmented bar; "Go to Usage & Billing" opens Settings on Usage & Billing.
- Settings > Usage & Billing shows same numbers, upgrade button disabled, "Renews in X days" present.
- No hardcoded 843 or email-specific logic; all numbers from API backed by document query.

---

## 8. Summary


| Item              | Detail                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Page count source | Sum of `documents.page_count` where `business_uuid`, `status='completed'`, `created_at` in current UTC month.         |
| Callable anytime  | `get_pages_used_this_month(business_uuid)` and `GET /api/usage` are stateless reads; no cache.                        |
| Tier              | Assume Professional for everyone; no per-user or per-email hardcoding.                                                |
| Sidebar card      | White card, title + pill %, description, segmented progress bar, "Go to Usage & Billing" button; above profile strip. |
| Navigation        | onNavigate('settings', { openCategory: 'usage-billing' }) so Settings opens with Usage & Billing selected.            |
| No enforcement    | No blocking or upgrade logic in this phase.                                                                           |


This plan ensures a single, reliable pipeline for page count and usage, and a UI that matches the reference and supports future billing enforcement.