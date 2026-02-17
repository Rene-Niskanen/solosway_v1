# Align plan confirmation modal with ChatGPT (keep light theme)

## Scope

Update the plan-change confirmation modal in [PlanSelectionModal.tsx](frontend-ts/src/components/PlanSelectionModal.tsx) to match ChatGPT’s **structure and content** (title, copy, new-plan block, close button, button roles), while **keeping our light colour tone** (white/light card, dark text, no dark theme).

## Changes to make

### 1. Title

- Change from **"Change plan?"** to **"Confirm plan changes"** in both the fullscreen inline confirm and the AlertDialog (non-fullscreen).

### 2. Close button

- Add an **X** close button in the **top-right** of the confirm overlay (fullscreen inline confirm only; AlertDialog has its own close behaviour).
- On click: `setConfirmOpen(false)`, `setConfirmPendingTierId(null)` (same as Cancel).
- Style for light theme: e.g. gray icon on white/light card, or subtle border so it’s visible.

### 3. Body copy (one sentence)

- Replace the current single paragraph with **one sentence** in ChatGPT style:
  - *"Your current [Current Plan] subscription will remain active until [Date], when it will change to [New Plan Name]."*
- Use `TIERS[normalizedPlan].name` for current plan, `TIERS[confirmPendingTierId].name` for new plan, and `formatBillingCycleEnd(billingCycleEnd)` for the date.
- Optional: add a short reassurance line below (e.g. "Your documents and data are kept.") or leave as single sentence only.

### 4. New-plan details block

- Add a **dedicated block** below the sentence (visually distinct but **light-themed**):
  - Same light card or a slightly different background (e.g. light gray `bg-gray-50` or `bg-gray-100`) with border so it reads as a “new plan” card.
  - **Line 1:** New plan display name only (e.g. "Starter", "Pro") — `TIERS[confirmPendingTierId].name`.
  - **Line 2:** "Billing will start on [date]" using `formatBillingCycleEnd(billingCycleEnd)`.
  - **Line 3:** Price right-aligned, e.g. "[Currency] [Amount]/month" using `formatPrice(getPriceForTier(confirmPendingTierId, currency), currency)` and currency from `useCurrencyOptional()`.
- Layout: stacked lines; price right-aligned (flexbox or grid). Use dark text on light background to keep our tone.

### 5. Buttons (light theme)

- **Cancel:** Keep light-style button (e.g. white/light gray bg, dark text, border) so it fits the light modal.
- **Confirm:** Keep as primary (e.g. dark bg, white text) so it stays the clear main action.
- No need to switch to dark Cancel/Confirm; keep existing light-theme button styling.

### 6. Theme

- **Do not** change the confirm modal to a dark theme. Keep:
  - Light overlay (e.g. `bg-black/50` is fine).
  - Light card background (e.g. `bg-white`), dark text (`text-gray-900`, `text-gray-600`), and the new-plan block as a light gray/bordered area with dark text.

### 7. Non-fullscreen (AlertDialog)

- Apply the same **content** (title "Confirm plan changes", one-sentence body, new-plan block) inside the existing AlertDialog for non-fullscreen flow.
- Keep AlertDialog’s default light styling; only replace title and body content and add the new-plan block.

### 8. Data and edge cases

- Guard `TIERS[confirmPendingTierId]` and `billingCycleEnd`; fallbacks: "your next billing cycle" if no date, tier id if name missing.
- Use existing `useCurrencyOptional()` for the price in the new-plan block.

## File to change

- [frontend-ts/src/components/PlanSelectionModal.tsx](frontend-ts/src/components/PlanSelectionModal.tsx): fullscreen inline confirm block (~414–435) and AlertDialog confirm section (~471–481). Add close button; change title; replace body with one sentence; add light-themed new-plan block; keep light card and button styling.

## Summary

- **Match ChatGPT:** title, one-sentence transition copy, dedicated new-plan block (name, billing date, price), close button, same info hierarchy.
- **Keep ours:** light colour tone (light card, dark text, light Cancel, dark Confirm, no dark theme).
