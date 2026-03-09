"""
Stripe billing integration for OpenFind subscriptions.
Uses Checkout Sessions for subscription signup/plan changes and Customer Portal for management.
See BILLING_SPEC.md for tier definitions. Map Stripe Price IDs to tier keys via env.
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PERSONAL, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_BUSINESS
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
STRIPE_PRICE_PERSONAL = os.environ.get("STRIPE_PRICE_PERSONAL")
STRIPE_PRICE_PROFESSIONAL = os.environ.get("STRIPE_PRICE_PROFESSIONAL")
STRIPE_PRICE_BUSINESS = os.environ.get("STRIPE_PRICE_BUSINESS")

TIER_TO_PRICE_ID = {
    "personal": STRIPE_PRICE_PERSONAL,
    "professional": STRIPE_PRICE_PROFESSIONAL,
    "business": STRIPE_PRICE_BUSINESS,
}
PRICE_ID_TO_TIER = {v: k for k, v in TIER_TO_PRICE_ID.items() if v}


def is_stripe_configured() -> bool:
    """True if Stripe is enabled (secret key and at least one price ID)."""
    if not STRIPE_SECRET_KEY:
        return False
    return any(TIER_TO_PRICE_ID.values())


def get_or_create_stripe_customer(stripe_api, email: str, stripe_customer_id: Optional[str] = None):
    """
    Return Stripe Customer ID. If stripe_customer_id is set and valid, use it; else create by email.
    """
    if stripe_customer_id:
        try:
            stripe_api.Customer.retrieve(stripe_customer_id)
            return stripe_customer_id
        except Exception:
            pass
    customers = stripe_api.Customer.list(email=email, limit=1)
    if customers.data:
        return customers.data[0].id
    customer = stripe_api.Customer.create(email=email)
    return customer.id


def create_checkout_session(
    stripe_api,
    plan: str,
    success_url: str,
    cancel_url: str,
    customer_email: str,
    stripe_customer_id: Optional[str] = None,
):
    """
    Create a Stripe Checkout Session for subscription to the given plan (personal|professional|business).
    Returns the session URL or raises.
    """
    price_id = TIER_TO_PRICE_ID.get(plan)
    if not price_id:
        raise ValueError(f"Unknown plan or missing Stripe Price ID for plan: {plan}")

    customer_id = get_or_create_stripe_customer(stripe_api, customer_email, stripe_customer_id)

    session = stripe_api.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        subscription_data={"metadata": {"openfind_plan": plan}},
        allow_promotion_codes=True,
    )
    return session.url


def create_portal_session(stripe_api, customer_id: str, return_url: str):
    """Create a Stripe Customer Portal session. customer_id must be the Stripe Customer ID."""
    session = stripe_api.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


def _get_price_id_from_subscription(subscription) -> Optional[str]:
    """Extract price id from Stripe subscription (dict or StripeObject)."""
    try:
        items = subscription.get("items") if isinstance(subscription, dict) else getattr(subscription, "items", None)
        if not items:
            return None
        data = items.get("data") if isinstance(items, dict) else getattr(items, "data", None)
        if not data or not isinstance(data, list):
            return None
        first = data[0]
        price = first.get("price") if isinstance(first, dict) else getattr(first, "price", None)
        if not price:
            return None
        return price.get("id") if isinstance(price, dict) else getattr(price, "id", None)
    except (IndexError, KeyError, TypeError, AttributeError):
        return None


def tier_from_subscription(stripe_api, subscription) -> Optional[str]:
    """Map a Stripe subscription to OpenFind tier from the first item's price id."""
    price_id = _get_price_id_from_subscription(subscription)
    return PRICE_ID_TO_TIER.get(price_id) if price_id else None
