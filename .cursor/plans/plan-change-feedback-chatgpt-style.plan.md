---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: ChatGPT-style plan change success feedback

## Scope

Improve the **success toast** shown after a user changes plan (upgrade or switch) so it feels more like ChatGPT: warmer copy, success icon, optional “Got it” button, and optional light success styling. The feedback remains a **toast** (non-blocking, top-right, auto-dismiss); no switch to a modal.

**Current behaviour:** In [DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx), on successful `updatePlan`, the code calls `toast({ title: 'Plan updated', description: \`You're now on ${name}. })`. No icon, no action button.

---

## 1. Copy and tone

**File:** [frontend-ts/src/components/DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx)

- **Title:** Change from **"Plan updated"** to a short, friendly line, e.g. **"You're all set"** or **"Done"**.
- **Description:** Keep **"You're now on [Plan name]."** (e.g. "You're now on Starter."). Optionally use **"the [Plan name] plan"** for consistency (e.g. "You're now on the Starter plan.").

Apply the same title/description in **both** success paths: `onUpgrade` (around line 788) and `onSwitch` (around line 818).

---

## 2. Success icon

**Files:** [DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx), optionally [toaster.tsx](frontend-ts/src/components/ui/toaster.tsx)

- The existing toaster already supports an `**icon**` prop and renders it for non-destructive toasts.
- In `DashboardLayout`, for the **plan-success** toast only, pass an **icon**:
  - Use `**CheckCircle2**` from `lucide-react` (already used in [status-chip.tsx](frontend-ts/src/components/ui/status-chip.tsx) for success).
  - Style so it reads as success, e.g. `className="h-4 w-4 text-green-600"` (or use your design token for success green).

Example:

```ts
import { CheckCircle2 } from "lucide-react";
// ...
toast({
  title: "You're all set",
  description: `You're now on the ${name} plan.`,
  icon: <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />,
});
```

---

## 3. “Got it” button (optional but recommended)

**Files:** [DashboardLayout.tsx](frontend-ts/src/components/DashboardLayout.tsx), [ui/toast.tsx](frontend-ts/src/components/ui/toast.tsx) (for `ToastAction` import)

- Add a single **“Got it”** (or “OK”) button that dismisses the toast, so the user has an explicit confirm action (ChatGPT-style).
- The toast hook returns `{ id, dismiss, update }`. Use `**useToast()**` in the same component to get `**dismiss**`, then pass an `**action**` that calls `dismiss(id)`.
- Because `id` is only available after `toast()` is called, either:
  - **Option A:** Call `toast(...)` without `action`, then `**update({ action: <ToastAction onClick={() => dismiss(id)}>Got it</ToastAction> })**` so the button has the correct toast `id`, or
  - **Option B:** If you prefer a single call, extend the toast API so `action` can be a function `(dismiss: () => void) => ReactNode` and the toaster invokes it with the toast’s dismiss; then pass that function from `DashboardLayout`.

Recommendation: **Option A** to avoid API changes; the toast may render for one frame without the button, which is acceptable.

- Import `**ToastAction**` from `@/components/ui/toast` in `DashboardLayout` and use it for the button. Style to match your light theme (e.g. secondary or subtle primary so it’s clearly a dismiss action).

---

## 4. Optional: success variant for toast

**Files:** [frontend-ts/src/components/ui/toast.tsx](frontend-ts/src/components/ui/toast.tsx), [frontend-ts/src/components/ui/toaster.tsx](frontend-ts/src/components/ui/toaster.tsx)

- Add a `**variant: "success"**` to the toast component:
  - In **toast.tsx** `toastVariants`: add `success` with light success styling (e.g. subtle green border or background, e.g. `border-green-200 bg-green-50/50` or similar) so it’s distinct from the default neutral toast.
  - In **toaster.tsx**: when `variant === "success"`, render the same layout as default (icon, title, description, action, close) and optionally force a success icon if none provided (e.g. `CheckCircle2` with green) so success toasts always look consistent.
- In **DashboardLayout**, use `**variant: "success"**` for the plan-success toast so it gets this styling (and optionally rely on the toaster to add the icon for success variant if you prefer not to pass `icon` at the call site).

This step is optional: the improvement is already clear with copy + icon + “Got it” button; the variant is for visual consistency and reuse for other success toasts.

---

## 5. Error toasts (no change)

- Leave **error** toasts as-is: `title: 'Could not update plan'`, `description: res.error ?? 'Please try again.'`, `variant: 'destructive'`. No copy or UI changes required for this plan.

---

## Files to change (summary)


| File                                               | Changes                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **frontend-ts/src/components/DashboardLayout.tsx** | (1) Update success toast copy (title + description) in both `onUpgrade` and `onSwitch`. (2) Add `CheckCircle2` icon for plan-success toast. (3) Use `useToast()`, then add “Got it” action via `update()` after `toast()`. (4) Optionally set `variant: "success"`. |
| **frontend-ts/src/components/ui/toast.tsx**        | Optional: add `success` to `toastVariants` with light green styling.                                                                                                                                                                                                |
| **frontend-ts/src/components/ui/toaster.tsx**      | Optional: handle `variant === "success"` (same layout as default; optional default success icon).                                                                                                                                                                   |


---

## Order of implementation

1. **Copy + icon** in `DashboardLayout` (quick win).
2. **“Got it” button** in `DashboardLayout` using `useToast()` and `toast().update({ action })`.
3. **Optional:** Add `success` variant in `toast.tsx` and `toaster.tsx`, then set `variant: "success"` for the plan-success toast in `DashboardLayout`.

---

## Acceptance

- After upgrading or switching plan, the success toast shows:
  - A friendly title (e.g. “You're all set”).
  - Description “You're now on [Plan name].” (or “... the [Plan name] plan.”).
  - A green check-circle icon.
  - A “Got it” button that dismisses the toast.
  - Optional: light success styling (border/background) via `variant: "success"`.
- Error toasts for failed plan changes are unchanged.
- Toast remains non-blocking (top-right, auto-dismiss); no new modal.

