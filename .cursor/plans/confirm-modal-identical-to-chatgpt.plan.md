---
name: ""
overview: ""
todos: []
isProject: false
---

# Confirm plan modal: ChatGPT layout, our light colour scheme

Step-by-step instructions to make the plan-change confirmation modal in [PlanSelectionModal.tsx](frontend-ts/src/components/PlanSelectionModal.tsx) match the ChatGPT layout and content (title, copy, plan-details block, close button, buttons) while **using our light colour scheme throughout** — no dark tones.

---

## 1. Modal container (light)

**ChatGPT layout:** Rounded rectangle, generous padding, subtle shadow.

**Our implementation:**

- Fullscreen inline confirm (the `div` that wraps the confirm content):
  - **Background: light** — keep or use `bg-white`.
  - Corners: `rounded-xl` or `rounded-lg` (~10–12px).
  - Shadow: `shadow-lg` or `shadow-xl` for a floating effect.
  - Keep `max-w-md w-full` and padding (e.g. `p-6`).

---

## 2. Header: title + close button (light)

**ChatGPT layout:** Title top-left, close X top-right, same row.

**Our implementation:**

- **Title**
  - Text: **“Confirm plan changes”** (replace “Change plan?”).
  - **Light scheme:** dark text, e.g. `text-lg font-semibold text-gray-900`.
  - Position: top-left with padding.
- **Close button**
  - Add an **X** button in the **top-right** of the confirm modal.
  - On click: `setConfirmOpen(false)` and `setConfirmPendingTierId(null)` (same as Cancel).
  - **Light scheme:** dark/grey icon on light background, e.g. `text-gray-600 hover:bg-gray-100 rounded ...` with “×” or Lucide `X`.
  - Layout: flex row, title left and close right, e.g. `flex items-start justify-between`.

---

## 3. Main information paragraph (light)

**ChatGPT content:** One sentence stating current plan, date, and new plan.

**Our implementation:**

- Replace the current `confirmMessage` with a **single sentence**:
  - Current plan: `TIERS[normalizedPlan].name` (e.g. “Pro”).
  - Date: `formatBillingCycleEnd(billingCycleEnd)` (e.g. “21 February 2026”).
  - New plan: `TIERS[confirmPendingTierId].name` (e.g. “Starter”).
- Template: *“Your current [Current Plan] subscription will remain active until [Date], when it will change to [New Plan Name].”*
- Fallbacks: if `billingCycleEnd` is missing use “your next billing cycle”; if a tier name is missing use the tier id.
- **Light scheme:** dark body text, e.g. `text-sm text-gray-700` or `text-gray-900`, left-aligned, with spacing below (e.g. `mt-4`).

---

## 4. Plan details card (light)

**ChatGPT layout:** Separate block with plan name, billing date, and price right-aligned.

**Our implementation:**

- Add a **plan details block** below the main paragraph.
- **Container (light):**
  - **Light grey background** to distinguish from modal, e.g. `bg-gray-50` or `bg-gray-100`, border optional e.g. `border border-gray-200`.
  - Rounded corners `rounded-lg`, padding (e.g. `p-4`).
  - Spacing: gap above and below (e.g. `mt-5 mb-5`).
- **Content (light text):**
  1. **Plan name (top-left):** `TIERS[confirmPendingTierId].name`. Bold, dark text, e.g. `font-semibold text-gray-900 text-base`.
  2. **Billing date (below):** “Billing will start on [date]” with `formatBillingCycleEnd(billingCycleEnd)`. Muted grey, smaller, e.g. `text-gray-500 text-sm`.
  3. **Price (right side):** `formatPrice(getPriceForTier(confirmPendingTierId, currency), currency)` + “/month”. Use `useCurrencyOptional()` for `currency`. Same line as plan name, right-aligned, dark text, e.g. `text-gray-900 text-base`.
- **Layout:** One row for plan name + price (flex, price right-aligned), second row for billing date.

---

## 5. Action buttons (light)

**ChatGPT layout:** Cancel and Confirm right-aligned at bottom.

**Our implementation:**

- **Container:** `flex justify-end gap-2` with top margin (e.g. `mt-6`).
- **Cancel (light secondary):**
  - **Light scheme:** light background, dark text, border, e.g. `bg-white text-gray-700 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50`.
  - Behaviour: `setConfirmOpen(false)`, `setConfirmPendingTierId(null)`.
- **Confirm (primary):**
  - **Light scheme:** dark background, white text, primary action, e.g. `bg-gray-900 text-white font-medium rounded-md px-4 py-2 hover:bg-gray-800`.
  - Behaviour: `handleConfirmDowngrade`.

---

## 6. Apply to both fullscreen and non-fullscreen

**Fullscreen:** All of the above apply to the inline confirm overlay (block at ~413–436). Use **light** container, text, plan card, and buttons as specified.

**Non-fullscreen (AlertDialog):** Same content and layout with the **same light styling**:

- AlertDialog content: same title, one-sentence paragraph, plan-details card, button row.
- Keep AlertDialog’s default light look; only ensure the inner plan-details block and buttons use the same light classes (gray-50 card, dark text, Cancel light/secondary, Confirm dark/primary).
- Alternatively, reuse the same inline confirm overlay (high z-index) for both fullscreen and dialog so one implementation is used everywhere.

---

## 7. Data and accessibility

- **Guards:** Fallbacks for missing `confirmPendingTierId` / `normalizedPlan` / `TIERS[...]` (e.g. tier id or “plan”). If `billingCycleEnd` is missing, use “your next billing cycle” in the sentence and in the card.
- **Currency:** Use `useCurrencyOptional()` (already in component).
- **A11y:** Keep `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on “Confirm plan changes”, and `aria-label="Close"` on the close button.

---

## 8. File and locations

- **File:** [frontend-ts/src/components/PlanSelectionModal.tsx](frontend-ts/src/components/PlanSelectionModal.tsx).
- **Fullscreen confirm:** Inline block ~413–436; replace with light container, header row, one sentence, light plan-details card, light-styled buttons.
- **Non-fullscreen:** AlertDialog ~471–481; same content and light styling (or reuse inline overlay).
- **Copy logic:** Replace `confirmMessage` with the one-sentence template; add plan-details data (new plan name, date, price) for both fullscreen and AlertDialog.

