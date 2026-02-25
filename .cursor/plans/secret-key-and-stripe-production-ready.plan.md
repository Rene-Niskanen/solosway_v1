---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Secret Key Fix + Stripe Integration (Production Ready)

High-level plan to complete **Step 1** (fix hardcoded SECRET_KEY) and **Step 2** (Stripe payment integration) for Velora production readiness.

---

## Step 1: Fix Hardcoded SECRET_KEY

**Effort:** Small (~15 min)  
**Risk:** Low

### 1.1 Current State

- `backend/__init__.py` line 76 hardcodes: `app.config['SECRET_KEY'] = 'hjshjhdjah kjshkjdhjs'`
- This overrides `Config.SECRET_KEY` (which correctly reads from `SECRET_KEY` env var)
- Production deployments must use a strong, random secret from environment

### 1.2 Implementation


| Task                    | Location              | Action                                                                                                                                                      |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use env-based secret    | `backend/__init__.py` | Replace hardcoded string with `Config.SECRET_KEY` (or `os.environ.get('SECRET_KEY') or Config.SECRET_KEY`)                                                  |
| Fail fast in production | `backend/__init__.py` | If `FLASK_ENV=production` or `ENVIRONMENT=production` and `SECRET_KEY` is missing/weak (e.g. default), log error and raise — do not start with insecure key |
| Document                | `.env.example`        | Ensure `SECRET_KEY` is documented; add comment: "Required for production. Generate with: python -c import secrets; print(secrets.token_hex(32))."           |


### 1.3 Acceptance

- `SECRET_KEY` is read from environment (or Config)
- Production mode refuses to start if `SECRET_KEY` is unset or equals the old hardcoded value
- `.env.example` documents how to generate a secure key

---

## Step 2: Stripe Integration

**Effort:** High (~2–4 days)  
**Risk:** Medium (billing is critical path)

### 2.1 Overview

Wire Stripe so that:

1. **New subscribers** → Stripe Checkout Session → redirect to success/cancel URLs
2. **Existing subscribers** (upgrade, downgrade, cancel) → Stripe Customer Portal
3. **Webhooks** → Keep `subscription_tier`, `subscription_period_ends_at`, and Stripe IDs in sync

### 2.2 Prerequisites


| Item              | Action                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe account    | Create at [dashboard.stripe.com](https://dashboard.stripe.com)                                                                                                                                                              |
| API keys          | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (frontend), `STRIPE_WEBHOOK_SECRET`                                                                                                                                           |
| Products & prices | Create 3 products in Stripe Dashboard (or via API): Personal ($15/mo), Professional ($49/mo), Business ($129/mo). Align with `BILLING_SPEC.md` — note: `billing.ts` has Business at $200; reconcile with BILLING_SPEC $129. |


### 2.3 Data Model

**New columns on `users` (Supabase):**


| Column                   | Type                  | Purpose                                                       |
| ------------------------ | --------------------- | ------------------------------------------------------------- |
| `stripe_customer_id`     | VARCHAR(255) nullable | Stripe Customer ID; created on first checkout or portal visit |
| `stripe_subscription_id` | VARCHAR(255) nullable | Active subscription ID; used to manage/cancel via portal      |


**Migration:** Idempotent SQL script (e.g. `backend/migrations/add_stripe_to_users.sql`) + run script.

### 2.4 Backend: Stripe Service

**New file:** `backend/services/stripe_service.py`


| Function                                                                            | Purpose                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `get_or_create_stripe_customer(user_id, email, name)`                               | Look up `stripe_customer_id` from DB; if missing, create Stripe Customer, persist, return ID |
| `create_checkout_session(customer_id, price_id, success_url, cancel_url, metadata)` | Create Stripe Checkout Session for new subscription                                          |
| `create_portal_session(customer_id, return_url)`                                    | Create Stripe Customer Portal session for manage/cancel                                      |
| `get_price_id_for_tier(tier)`                                                       | Map `personal` / `professional` / `business` → Stripe Price ID (from env or config)          |


**Config:** Store Stripe Price IDs in env vars: `STRIPE_PRICE_PERSONAL`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_BUSINESS`.

### 2.5 API Endpoints


| Endpoint                               | Method | Auth                                | Purpose                                                                                                                                                                                                |
| -------------------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/billing/create-checkout-session` | POST   | `@login_required`                   | Body: `{ "plan": "personal" | "professional" | "business" }`. Creates or gets customer, creates Checkout Session, returns `{ "url": "https://checkout.stripe.com/..." }`. Frontend redirects to `url`. |
| `/api/billing/create-portal-session`   | POST   | `@login_required`                   | Creates Customer Portal session; returns `{ "url": "https://billing.stripe.com/..." }`. Frontend redirects to `url`. Requires `stripe_customer_id` (return 400 if missing).                            |
| `/api/billing/webhook`                 | POST   | None (verified by Stripe signature) | Handles Stripe webhooks. **Do not** use `@login_required`.                                                                                                                                             |


### 2.6 Webhook Handlers

Handle at minimum:


| Event                           | Action                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`    | Set `stripe_customer_id`, `stripe_subscription_id`, `subscription_tier` (from metadata), `subscription_period_ends_at`, `subscription_period_started_at` |
| `customer.subscription.updated` | Update `subscription_tier`, `subscription_period_ends_at`                                                                                                |
| `customer.subscription.deleted` | Set `subscription_tier` to free/default (e.g. `personal` or a new `free` tier), clear `stripe_subscription_id`                                           |
| `invoice.payment_failed`        | Log; optionally notify user or downgrade (define policy)                                                                                                 |


**Webhook verification:** Use `stripe.Webhook.construct_event(payload, sig_header, webhook_secret)` to verify signature. Return 200 quickly; process async if needed.

### 2.7 Modify PATCH /api/usage/plan

**Current:** Updates tier directly in DB with no payment.

**New behaviour:**

- **If Stripe is disabled** (no `STRIPE_SECRET_KEY`): Keep current behaviour for dev/testing.
- **If Stripe is enabled:**
  - **Upgrade** (e.g. personal → professional): Return `{ "requires_checkout": true, "checkout_url": "..." }` or 307 redirect; do not update DB. Frontend redirects to Checkout.
  - **Downgrade** (e.g. professional → personal): Return `{ "requires_portal": true, "portal_url": "..." }`; do not update DB. User manages in Customer Portal.
  - **Same tier / no change:** Idempotent 200 as today.

DB updates for upgrades/downgrades happen **only** via webhooks (Stripe is source of truth for paid state).

### 2.8 Frontend Changes


| Component                | Change                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlanSelectionModal`     | When user confirms plan change: call `POST /api/billing/create-checkout-session` (upgrade) or `create-portal-session` (manage/downgrade). On response, `window.location.href = url` instead of calling `updatePlan`. |
| `UsageAndBillingSection` | "Manage Subscription" → call `create-portal-session` and redirect (or open in new tab).                                                                                                                              |
| `backendApi.ts`          | Add `createCheckoutSession(plan)`, `createPortalSession()`; handle `requires_checkout` / `requires_portal` if API returns those.                                                                                     |
| Success / cancel URLs    | Add `/settings?billing=success` and `/settings?billing=cancelled`; optionally show toast on success.                                                                                                                 |


### 2.9 Flow Summary

**New user upgrading:**

1. User selects plan in modal → Confirm
2. Frontend → `POST /api/billing/create-checkout-session` with `{ plan: "professional" }`
3. Backend creates/fetches Stripe Customer, creates Checkout Session with `metadata.plan`, returns `url`
4. Frontend redirects to Stripe Checkout
5. User completes payment
6. Stripe sends `checkout.session.completed` → webhook updates DB
7. User returns to success URL; usage reflects new tier

**Existing user managing subscription:**

1. User clicks "Manage Subscription"
2. Frontend → `POST /api/billing/create-portal-session`
3. Backend creates Portal session, returns `url`
4. Frontend redirects to Stripe Customer Portal
5. User upgrades/downgrades/cancels in Portal
6. Stripe sends subscription webhooks → backend updates DB

### 2.10 Testing


| Phase      | Approach                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | Use Stripe test mode; test cards (e.g. `4242...`). Expose webhook via Stripe CLI: `stripe listen --forward-to localhost:5001/api/billing/webhook` |
| Staging    | Deploy with Stripe test keys; use Stripe Dashboard to send test webhooks                                                                          |
| Production | Use live keys; configure webhook endpoint in Stripe Dashboard                                                                                     |


### 2.11 Acceptance

- New users can subscribe via Stripe Checkout
- Existing subscribers can manage/cancel via Customer Portal
- Webhooks correctly update `subscription_tier`, `subscription_period_`*, Stripe IDs
- Dev mode can still use plan switch without Stripe (no payment)
- Success/cancel URLs work and show appropriate feedback

---

## Implementation Order

1. **Step 1** (Secret key) — quick win, do first
2. **Step 2.3** (Migration) — add Stripe columns
3. **Step 2.4** (Stripe service) — core logic
4. **Step 2.5** (Endpoints) — create-checkout-session, create-portal-session
5. **Step 2.6** (Webhooks) — event handlers
6. **Step 2.7** (Modify PATCH /api/usage/plan) — conditional Stripe vs direct update
7. **Step 2.8** (Frontend) — wire modal and billing section
8. **Step 2.10** (Testing) — end-to-end with Stripe test mode

---

## Price Alignment

`frontend-ts/src/config/billing.ts` has Business at $200; `BILLING_SPEC.md` has $129. Decide single source of truth before creating Stripe products. Recommend: `BILLING_SPEC.md` §4 as canonical; update `billing.ts` if needed.

---

## References

- [Stripe Checkout](https://stripe.com/docs/checkout/quickstart)
- [Stripe Customer Portal](https://stripe.com/docs/billing/subscriptions/integrating-customer-portal)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- `BILLING_SPEC.md` — tier limits, pricing, overage
- `frontend-ts/src/config/billing.ts` — tier IDs, display names

