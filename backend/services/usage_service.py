"""
Central usage tracking for Velora billing.
Single source of truth: pages used this month = sum of document page_count
for completed docs in the current billing month (UTC).
See BILLING_SPEC.md for tier limits and pricing.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Tuple

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

# Tier limits (pages/month) from BILLING_SPEC.md
TIER_LIMITS = {
    "personal": 500,
    "professional": 2000,
    "business": 5000,
}
ALLOWED_TIERS = ("personal", "professional", "business")
DEFAULT_TIER = "professional"

# For future enforcement (not implemented in this phase)
USAGE_THRESHOLDS = {
    "warning": 0.80,
    "urgent": 0.90,
    "limit": 1.00,
}


def get_current_billing_month_utc() -> Tuple[str, datetime, datetime]:
    """
    Return (yyyy_mm, start_utc, end_utc) for the current UTC month.
    start_utc = first moment of month; end_utc = first moment of next month (exclusive bound).
    """
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month
    start_utc = datetime(year, month, 1, 0, 0, 0, tzinfo=timezone.utc)
    if month == 12:
        end_utc = datetime(year + 1, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    else:
        end_utc = datetime(year, month + 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    yyyy_mm = f"{year}-{month:02d}"
    return yyyy_mm, start_utc, end_utc


def get_pages_used_in_period(
    business_uuid: str, start_utc: datetime, end_utc: datetime
) -> int:
    """
    Sum page_count for completed documents with created_at in [start_utc, end_utc).
    Used for subscription-period usage (start/switch to a plan until period ends).
    """
    start_iso = start_utc.isoformat()
    end_iso = end_utc.isoformat()
    try:
        supabase = get_supabase_client()
        result = (
            supabase.table("documents")
            .select("id, page_count, created_at")
            .eq("business_uuid", business_uuid)
            .eq("status", "completed")
            .gte("created_at", start_iso)
            .lt("created_at", end_iso)
            .execute()
        )
        rows = result.data or []
        # Coerce each page_count to int; treat None/missing as 0 so usage starts at 0 with no docs
        return sum(max(0, int(r.get("page_count") or 0)) for r in rows)
    except Exception as e:
        logger.exception("get_pages_used_in_period failed: %s", e)
        raise


def get_pages_used_this_month(business_uuid: str) -> int:
    """
    Sum page_count for all documents in the current billing month (UTC).
    Only completed documents; created_at must fall in [month_start, month_end).
    Callable anytime; no caching.
    """
    _, start_utc, end_utc = get_current_billing_month_utc()
    return get_pages_used_in_period(business_uuid, start_utc, end_utc)


def get_usage_for_api(
    business_uuid: str,
    user_id: Any = None,
    user_email: str | None = None,
    plan_override: str | None = None,
    billing_cycle_start_override: str | None = None,
    billing_cycle_end_override: str | None = None,
) -> Dict[str, Any]:
    """
    Build the usage payload for GET /api/usage.
    Uses plan_override if provided and in ALLOWED_TIERS; otherwise DEFAULT_TIER.
    When billing_cycle_*_override are provided (subscription period from start/switch),
    usage = pages from documents created in [period_start, min(now, period_end)] so
    usage is tracked only within the current plan period until it ends.
    """
    plan = (
        plan_override
        if plan_override and plan_override in ALLOWED_TIERS
        else DEFAULT_TIER
    )
    monthly_limit = TIER_LIMITS.get(plan, TIER_LIMITS[DEFAULT_TIER])

    if billing_cycle_end_override and billing_cycle_start_override:
        billing_cycle_start = billing_cycle_start_override
        billing_cycle_end = billing_cycle_end_override
        # Count usage only within this subscription period (from start/switch until now or period end)
        try:
            start_date = datetime.strptime(billing_cycle_start_override, "%Y-%m-%d").date()
            end_date = datetime.strptime(billing_cycle_end_override, "%Y-%m-%d").date()
            period_start_utc = datetime(
                start_date.year, start_date.month, start_date.day, 0, 0, 0, tzinfo=timezone.utc
            )
            period_end_utc = datetime(
                end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc
            ) + timedelta(seconds=1)
            now_utc = datetime.now(timezone.utc)
            end_cap = min(now_utc, period_end_utc)
            pages_used = get_pages_used_in_period(business_uuid, period_start_utc, end_cap)
        except (ValueError, TypeError) as e:
            logger.warning("Invalid billing_cycle dates, falling back to calendar month: %s", e)
            pages_used = get_pages_used_this_month(business_uuid)
    else:
        _, start_utc, end_utc = get_current_billing_month_utc()
        last_day = end_utc - timedelta(days=1)
        billing_cycle_start = start_utc.strftime("%Y-%m-%d")
        billing_cycle_end = last_day.strftime("%Y-%m-%d")
        pages_used = get_pages_used_this_month(business_uuid)

    # Ensure pages_used is a non-negative int so UI shows 0/limit when no usage (not 1/limit)
    pages_used = max(0, int(pages_used))
    remaining = max(0, monthly_limit - pages_used)
    usage_percent = (
        round((pages_used / monthly_limit) * 100, 2) if monthly_limit > 0 else 0.0
    )

    return {
        "plan": plan,
        "monthly_limit": monthly_limit,
        "pages_used": pages_used,
        "remaining": remaining,
        "usage_percent": usage_percent,
        "billing_cycle_start": billing_cycle_start,
        "billing_cycle_end": billing_cycle_end,
        "user_email": user_email,
    }
