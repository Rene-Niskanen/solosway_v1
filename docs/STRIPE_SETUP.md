# Stripe billing setup for Velora

Velora’s subscription tiers (Starter, Pro, Ultra) can be powered by Stripe. If Stripe is not configured, the app keeps using the existing “test” flow (PATCH plan with no payment).

## 1. Stripe Dashboard

1. Create Products and recurring Prices for each tier (e.g. monthly):
   - **Starter** (personal) — e.g. $15/month  
   - **Pro** (professional) — e.g. $49/month  
   - **Ultra** (business) — e.g. $129/month (or your BILLING_SPEC amounts)

2. Copy each Price ID (e.g. `price_xxx`).

3. **Webhooks**: Add an endpoint pointing to your backend:
   - URL: `https://your-api-domain.com/api/billing/webhook`
   - Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (starts with `whsec_`).

4. (Optional) Configure [Customer Portal](https://dashboard.stripe.com/settings/billing/portal) for “Manage Subscription” (cancel, update payment method, etc.).

## 2. Environment variables

Set these on the backend (e.g. in `.env` or your host’s env):

```bash
STRIPE_SECRET_KEY=sk_live_xxx   # or sk_test_xxx for test mode
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PERSONAL=price_xxx   # Starter
STRIPE_PRICE_PROFESSIONAL=price_xxx   # Pro
STRIPE_PRICE_BUSINESS=price_xxx   # Ultra
```

If `STRIPE_SECRET_KEY` or the price IDs are missing, the app behaves as before: plan changes use PATCH only (no Stripe).

## 3. Database

Run the migration so users can be linked to Stripe customers and webhooks can update tiers:

```bash
python -m backend.scripts.run_stripe_customer_id_migration
```

## 4. Flow

- **Upgrade / change plan**: User picks a plan in the plan modal → if Stripe is enabled, they are sent to Stripe Checkout; after payment they return to `/dashboard?checkout=success` and usage is refetched.
- **Manage Subscription**: In Settings → Usage & Billing, “Manage Subscription” opens the Stripe Customer Portal when Stripe is enabled.
- **Webhook**: Stripe calls `/api/billing/webhook`; the handler updates `users.subscription_tier`, `subscription_period_ends_at`, and `subscription_period_started_at` by matching `stripe_customer_id`. The frontend does not need to call PATCH after Checkout — the webhook keeps the DB in sync.

## 5. Local webhook testing

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward events to your local server:

```bash
stripe listen --forward-to localhost:5001/api/billing/webhook
```

Use the printed webhook signing secret (e.g. `whsec_...`) as `STRIPE_WEBHOOK_SECRET` for local testing.
