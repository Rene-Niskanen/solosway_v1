# Plan: Plan switch functionality and UI (robust)

End-to-end: persist subscription tier, API to change plan, reassurance + confirmation UI, wire modal and Sidebar, and refresh usage everywhere. This section makes the flow robust and error-safe.

---

## 1. Backend robustness

**1.1 Allowed tiers (single source of truth)**

- Define `ALLOWED_TIERS = ('personal', 'professional', 'business')` in the same place as tier logic (e.g. in [backend/services/usage_service.py](backend/services/usage_service.py) or a small billing config module). Use it for both validation and default.
- In GET /api/usage: when reading `current_user.subscription_tier`, if the value is missing or not in `ALLOWED_TIERS`, treat as `DEFAULT_TIER` and (optionally) persist the default so DB is self-healing.

**1.2 PATCH /api/usage/plan**

- **Input:** JSON body `{ "plan": "personal" | "professional" | "business" }`. Require `plan` key.
- **Validation:** If `plan` is missing, not a string, or not in `ALLOWED_TIERS`, return `400` with body e.g. `{ "success": false, "error": "Invalid plan. Must be one of: personal, professional, business." }`.
- **No-op:** If `current_user.subscription_tier` already equals the requested plan, return `200` with `{ "success": true, "plan": "<tier>" }` (idempotent).
- **Update:** Set `current_user.subscription_tier = plan`, then `db.session.commit()`. On success return `200` with `{ "success": true, "plan": "<tier>" }`.
- **Errors:** On `IntegrityError` or any exception during commit, rollback (`db.session.rollback()`), log, return `500` with a generic message. Do not leave partial state.
- **Auth:** Use existing `@login_required`; only update the authenticated user. No need to check business_id for this endpoint (tier is per user for now).

**1.3 GET /api/usage and plan**

- When building the response, get plan as: `stored = getattr(current_user, 'subscription_tier', None)`; `plan = stored if stored in ALLOWED_TIERS else DEFAULT_TIER`. Pass `plan` into `get_usage_for_api(business_uuid, ..., plan_override=plan)`.
- Ensure `get_usage_for_api` never raises when given a valid plan; use `TIER_LIMITS.get(plan, TIER_LIMITS[DEFAULT_TIER])` so unknown values fall back safely.

**1.4 Migration**

- Add column `subscription_tier` (e.g. `VARCHAR(32)` or `TEXT`) to `users` with default `'professional'`.
- Make the migration idempotent: e.g. "ADD COLUMN IF NOT EXISTS" if the DB supports it, or check for column existence before adding. Document that existing users get default `'professional'`.

---

## 2. Frontend robustness

**2.1 Type safety**

- Use `TierKey` from [frontend-ts/src/config/billing.ts](frontend-ts/src/config/billing.ts) for all plan values sent to the API. Before calling `updatePlan(tierId)`, ensure `tierId` is one of `'personal' | 'professional' | 'business'` (e.g. `TIER_ORDER` or `Object.keys(TIERS)`). Never send arbitrary strings.

**2.2 API client**

- `updatePlan(plan: TierKey): Promise<ApiResponse<{ plan: string }>>`. Send only allowed tiers. Parse response: expect `{ success: true, plan: string }` on 200. On 4xx/5xx or non-JSON, treat as error and surface message from `response.error` or fallback "Unable to update plan. Please try again."

**2.3 Loading and double-submit prevention**

- In DashboardLayout (or wherever the plan-change handler lives), keep a small state: `planChangeInProgress: boolean`. When user confirms (or clicks upgrade), set it to `true`, call `updatePlan(tierId)`, then set to `false` in `finally`.
- Pass a prop into PlanSelectionModal such as `isChangingPlan?: boolean`. When true, disable all "Switch to X" / "Upgrade to Business" buttons (and show a subtle "Updating plan..." on the active button or a small spinner) so the user cannot double-submit or switch again before the first request completes.

**2.4 Error handling**

- On API failure (network error, 400, 500): do **not** close the modal. Show a toast or inline message: e.g. "Could not update plan. Please try again." or the server message if safe. Leave modal open so the user can retry or cancel.
- On success: close modal, dispatch `usageShouldRefresh`, optionally toast "Plan updated to [Starter/Pro/Business]."

**2.5 Confirmation dialog (downgrades)**

- Only for downgrades (e.g. current is Pro/Business and target is lower), show a confirmation step before calling the API. Use a controlled dialog (or second modal) with: message (see Reassurance copy below), [Cancel] and [Confirm]. On Confirm, run the same handler that calls `updatePlan` and handles loading/errors as above. Prevent closing the confirmation by clicking backdrop if you want to force an explicit Cancel/Confirm.

---

## 3. Reassurance copy and date

**3.1 Info line (always visible in the plan modal)**

- **With date:** "Your documents and data are kept when you change plan. You can keep using your current plan limit until [date]. Your new plan takes effect at the start of your next billing cycle."
- **Date source:** Use `usage.billing_cycle_end` from the usage API (e.g. `2026-02-28`). Format for display: e.g. `new Date(billing_cycle_end + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })` to avoid timezone shifts. If the string is invalid or missing, skip the "until [date]" part (see fallback).
- **Fallback when date is missing:** "Your documents and data are kept when you change plan. Plan changes take effect at the start of your next billing cycle." (No "until [date]" so we never show a broken or empty date.)

**3.2 Where the modal gets `billing_cycle_end`**

- Option A: Parent (DashboardLayout or UsageAndBillingSection) fetches usage when opening the modal and passes `billing_cycle_end?: string` (and optionally full usage) into PlanSelectionModal. Modal receives it as a prop and renders the info line; if undefined, use fallback copy.
- Option B: Modal fetches usage on mount when `open === true`. Store `billing_cycle_end` in local state; on fetch error, use fallback copy. Option A is simpler and avoids duplicate usage calls if the parent already has usage.

**3.3 Downgrade confirmation dialog**

- Message: "Your documents are safe. You can keep using your current plan limit until [date]. This change takes effect at the start of your next billing cycle." Use the same date and same fallback (omit "until [date]" if no valid date).

---

## 4. Edge cases and consistency

| Case | Handling |
|------|----------|
| User already on target tier | Backend returns 200 (idempotent). Frontend can still close modal and refresh; no need to show an error. |
| Invalid tier in request | Backend 400 with clear message. Frontend shows error toast/message, modal stays open. |
| Network failure / 5xx | Frontend shows generic or server error message, modal stays open, user can retry. |
| No usage data when opening modal | Pass `billing_cycle_end` as optional; if missing, show fallback reassurance text without date. |
| Refetch after plan change | Dispatch `usageShouldRefresh` once after successful PATCH. Sidebar and UsageAndBillingSection already listen and refetch; no need to wait for refetch before closing modal. |
| Sidebar "Upgrade plan" | Ensure Sidebar has access to `openPlanModal` (e.g. via `usePlanModal`). On click: `openPlanModal(usageData?.plan ?? 'professional')`. If `usageData` is null (e.g. first load or error), fallback to `'professional'` so the modal still opens. |

---

## 5. Files and changes (checklist)

- **Backend:** [backend/models.py](backend/models.py) – add `subscription_tier` to User; migration SQL – add column, idempotent.
- **Backend:** [backend/services/usage_service.py](backend/services/usage_service.py) – `ALLOWED_TIERS`, `get_usage_for_api(..., plan_override=None)`, safe fallback for unknown plan.
- **Backend:** [backend/views.py](backend/views.py) – GET /api/usage passes user’s stored plan; new PATCH /api/usage/plan with validation, idempotent no-op, commit/rollback on error.
- **Frontend:** [frontend-ts/src/services/backendApi.ts](frontend-ts/src/services/backendApi.ts) – `updatePlan(plan: TierKey)` with error handling.
- **Frontend:** [frontend-ts/src/components/PlanSelectionModal.tsx](frontend-ts/src/components/PlanSelectionModal.tsx) – optional props `billingCycleEnd?: string`, `isChangingPlan?: boolean`; reassurance line (with date + fallback); downgrade confirmation step; disable buttons when `isChangingPlan`.
- **Frontend:** [frontend-ts/src/components/DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx) – pass `onSwitch` and `onUpgrade` that handle confirmation (downgrade), loading state, `updatePlan`, success/error handling, close modal + `usageShouldRefresh`; pass `billingCycleEnd` and `isChangingPlan` to modal (billingCycleEnd can come from a one-off usage fetch when opening modal, or from a parent that already has usage).
- **Frontend:** [frontend-ts/src/components/Sidebar.tsx](frontend-ts/src/components/Sidebar.tsx) – "Upgrade plan" buttons call `openPlanModal(usageData?.plan ?? 'professional')`; ensure `usePlanModal` is available in Sidebar.

---

## 6. Reassurance copy (exact strings for implementation)

- **With date:** "Your documents and data are kept when you change plan. You can keep using your current plan limit until {formattedDate}. Your new plan takes effect at the start of your next billing cycle."
- **Fallback (no date):** "Your documents and data are kept when you change plan. Plan changes take effect at the start of your next billing cycle."
- **Downgrade confirm (with date):** "Your documents are safe. You can keep using your current plan limit until {formattedDate}. This change takes effect at the start of your next billing cycle."
- **Downgrade confirm (no date):** "Your documents are safe. This change takes effect at the start of your next billing cycle."
