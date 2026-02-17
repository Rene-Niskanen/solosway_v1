# Plan: At-capacity upgrade prompt (global banner + CTA)

When a user reaches full capacity (usage at or over their plan limit), show a clear prompt to upgrade, with a button that opens the plan modal (Manage subscription). The prompt should appear **wherever they are** in the app so they can act without navigating to Settings first.

---

## Goal

- **Trigger:** User is at or over their monthly allowance for the current period (`usage.remaining === 0` or `usage.pages_used >= usage.monthly_limit`).
- **Exclude:** Users already on the top tier (e.g. `usage.plan === 'business'`) so we don’t show “upgrade” when there’s no higher tier.
- **Message:** Short, clear copy that they’ve reached their limit and can upgrade for more capacity.
- **Action:** One primary button: “Manage subscription” (or “Upgrade plan”) that opens the plan modal, i.e. `openPlanModal(usage.plan, usage.billing_cycle_end)`.
- **Placement:** Visible globally (dashboard, projects, chat, settings, etc.), not only on Usage & Billing.

---

## Approach

1. **Global banner** in the main layout that sits above the main content area (to the right of the sidebar). When at capacity and not on Business, render a compact strip with message + “Manage subscription” button. When not at capacity (or loading/error), render nothing.
2. **Reuse existing entry point:** The button opens the same plan modal that Settings > “Manage Subscription” and Sidebar > “Upgrade plan” use, so no new modal or route.
3. **Optional:** In places that already show usage (FilingSidebar popover, Usage & Billing section), make the “at capacity” state more prominent with the same CTA. The plan below focuses on the global banner first; contextual tweaks can follow.

---

## Implementation

### 1. At-capacity banner component

**New file:** `frontend-ts/src/components/AtCapacityBanner.tsx`

- Uses `useUsage()` and `usePlanModal()` (must be used inside `UsageProvider` and `PlanModalProvider`).
- **Show when:** `usage` is loaded (not loading, no error) and `usage.remaining === 0` (or `usage.pages_used >= usage.monthly_limit`) and `usage.plan !== 'business'`.
- **Render:** A horizontal bar (full width of its container) with:
  - Short message, e.g. “You’ve reached your plan’s page limit for this period.”
  - Button: “Manage subscription” that calls `openPlanModal(usage.plan, usage.billing_cycle_end)`.
- **Styling:** Neutral, non-blocking (e.g. light background, subtle border), so it’s visible but not alarming. Match existing UI (e.g. `#F1F2EE` or similar, border-gray-200). Ensure it’s clearly a single row on mobile (stack if needed).
- **Return** `null` when the show condition is false.

### 2. Layout integration

**File:** `frontend-ts/src/components/DashboardLayout.tsx` (inside `DashboardLayoutContent`)

- The main content column is currently a direct sibling of `Sidebar`: root flex container has `Sidebar` and `MainContent` as children.
- **Change:** Wrap `MainContent` in a wrapper so the banner can sit above it:
  - Insert a wrapper `div` with `className="flex-1 flex flex-col min-w-0"` (or equivalent so it takes remaining space and doesn’t overflow).
  - First child of this wrapper: `<AtCapacityBanner />`.
  - Second child: `MainContent` (with `flex-1 min-h-0` or similar so it fills the rest of the column and scrolls correctly).
- Ensure the wrapper does not break existing layout (sidebar width, main content width, or MainContent’s internal flex).

Result: the banner appears at the top of the main content area on every view (home, projects, chat, settings, etc.) when the user is at capacity and not on Business.

### 3. Copy and accessibility

- **Message:** One line, e.g. “You’ve reached your plan’s page limit for this period. Upgrade for more pages.”
- **Button:** “Manage subscription” (consistent with UsageAndBillingSection).
- **A11y:** Banner has a role (e.g. `region`) and `aria-label` describing that it’s an upgrade prompt; button is focusable and has a clear label.

### 4. Optional: contextual emphasis

- **FilingSidebar usage popover:** When `overAllowance` (or `remaining === 0`), the existing “Go to Usage & Billing” can stay; optionally change label to “Manage subscription” and call `openPlanModal(...)` instead of (or in addition to) navigating to Settings, so the CTA is consistent.
- **UsageAndBillingSection:** Already has “Manage Subscription”; when at capacity the section already shows “Over allowance” and the same button. No change required unless you want extra emphasis (e.g. a short line above the card: “You’re at capacity — upgrade below.”).

---

## Summary

| Item | Action |
|------|--------|
| At-capacity condition | `usage` loaded, `remaining === 0` (or `pages_used >= monthly_limit`), `plan !== 'business'` |
| New component | `AtCapacityBanner.tsx` using `useUsage` + `usePlanModal`, message + “Manage subscription” button |
| Layout | In DashboardLayout, wrap MainContent in a flex column wrapper; render banner as first child above MainContent |
| Button action | `openPlanModal(usage.plan, usage.billing_cycle_end)` (same as Settings) |
| Optional | FilingSidebar: “Manage subscription” in usage popover when at capacity, opening plan modal |

No backend changes. No new routes or modals; reuses existing plan modal and usage API.
