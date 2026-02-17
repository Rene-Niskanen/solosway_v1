---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Usage by subscription period (start/switch)

Usage is tracked **within the current plan period** only. When a user starts or switches to a plan, a period begins; we count only pages from documents created in that period until it ends. So after switching to a lower tier they see 0/500, not 844/500.

---

## Intended behavior

- **Start:** First time we need usage and the user has a plan but no `subscription_period_ends_at`, we set a period (end = now + 30 days) so usage is tracked from that moment.
- **Switch:** On plan change (PATCH /api/usage/plan), we set `subscription_period_ends_at = now + 30 days`; the new period starts at the switch.
- **Usage in period:** `pages_used` = sum of `page_count` for completed documents with `created_at` in `[period_start_utc, min(now_utc, period_end_utc)]`. So 0/500 right after switch; then 1/500, 2/500, etc. as they upload within the period.
- **No period (legacy):** If we never have overrides, we use calendar month (UTC) for both cycle dates and pages_used.

---

## Implemented (current codebase)

### Backend

** [backend/services/usage_service.py](backend/services/usage_service.py) **

- `**get_pages_used_in_period(business_uuid, start_utc, end_utc)**` (lines 48–73): Sums `page_count` for completed docs with `created_at` in `[start_utc, end_utc)`. Used for subscription-period usage.
- `**get_pages_used_this_month**` (lines 76–83): Delegates to `get_pages_used_in_period` with current calendar month range (unchanged behavior when no period).
- `**get_usage_for_api**` (lines 86–149):
  - When **both** `billing_cycle_start_override` and `billing_cycle_end_override` are provided:
    - Parses dates to UTC; `period_start_utc` = start of start date; `period_end_utc` = end of end date (exclusive).
    - `end_cap = min(now_utc, period_end_utc)`; `pages_used = get_pages_used_in_period(business_uuid, period_start_utc, end_cap)`.
    - Returns same payload shape; `pages_used` / `remaining` / `usage_percent` are period-based.
  - When overrides are **not** provided: uses calendar month and `get_pages_used_this_month` (legacy).
  - On parse error for cycle dates, falls back to calendar month and logs a warning.

** [backend/views.py](backend/views.py) **

- **GET /api/usage** (around 6289–6316):
  - Reads `subscription_period_ends_at`. If **missing**, sets `subscription_period_ends_at = now + 30 days`, commits (starts a period for “start” case), then continues.
  - If period exists: `start = period_end - 30 days`; passes `billing_cycle_start_override` and `billing_cycle_end_override` into `get_usage_for_api`. So usage is period-based.
- **PATCH /api/usage/plan** (6319–6347): On plan change, sets `subscription_tier` and `subscription_period_ends_at = now + 30 days`, commits. No change to this logic.

### Frontend

- **UsageAndBillingSection**, **Sidebar**, **backendApi**: No code changes required for period-based usage. They already display `usage.pages_used`, `usage.monthly_limit`, `usage.usage_percent`, and pass `usage.billing_cycle_end` to the plan modal. The API now returns period-scoped values, so 0/500 after switch is correct by default.
- **Copy:** Section title is still “Usage this month”; the values are actually “this period” when the user has a subscription period. Optional: rename to “Usage this period” or “Usage this billing period” and optionally show “Period ends [date]” using `usage.billing_cycle_end`.

---

## Optional follow-ups (implemented)

1. **Over-allowance display:** When `pages_used > monthly_limit` within the same period (e.g. 600/500 on Starter), cap displayed percentage at 100% or “100%+” and use “Over allowance for this period” instead of “168% of monthly allowance used” (see earlier over-allowance plan).
2. **Period renewal:** When `now > subscription_period_ends_at`, the backend currently still uses the same period (end_cap = min(now, period_end) so usage stops at period_end). There is no automatic “rollover” to a new 30-day period. If you want continuous billing, add logic (e.g. in get_usage or a job) to set a new `subscription_period_ends_at` when the current one has passed.
3. **UI copy:** Optionally show “Period ends [billing_cycle_end]” in Usage & Billing and consider “Usage this period” instead of “Usage this month” when the API returns a subscription period.

---

## Summary


| Item                                   | Status                                 |
| -------------------------------------- | -------------------------------------- |
| Usage in subscription period only      | Done (usage_service + get_usage)       |
| Start: set period when missing         | Done (views get_usage)                 |
| Switch: set period end on plan change  | Done (views update_plan)               |
| Frontend display 0/500 after switch    | Done (no change needed; API drives it) |
| Over-allowance display (100%+, copy)   | Done (UsageAndBillingSection + FilingSidebar) |
| Period renewal after period end        | Done (views get_usage)                 |
| “Usage this period” + period end in UI | Done                                  |


