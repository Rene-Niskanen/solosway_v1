/**
 * Billing tier config — single source of truth aligned with BILLING_SPEC.md §9.
 * Use for Usage & Billing UI (current-plan card and plan-selection modal).
 */

export const TIERS = {
  personal: {
    id: 'personal',
    name: 'Starter',
    price: 16,
    pageLimit: 500,
    overageRatePerPage: 0.05,
    seats: 1,
    targetUser: 'Individuals managing personal documents',
  },
  professional: {
    id: 'professional',
    name: 'Pro',
    price: 49,
    pageLimit: 2000,
    overageRatePerPage: 0.045,
    seats: 1,
    targetUser: 'Freelancers, consultants, solo professionals',
  },
  business: {
    id: 'business',
    name: 'Plus',
    price: 210,
    pageLimit: 5000,
    overageRatePerPage: 0.04,
    seats: 10,
    targetUser: 'Small teams (3-10 people)',
    sharedPool: true,
  },
} as const;

/** Supported display currencies with regional prices (UK-style rounded where applicable). */
export const PRICES_BY_CURRENCY: Record<string, Record<TierKey, number>> = {
  USD: { personal: 16, professional: 49, business: 210 },
  GBP: { personal: 12, professional: 39, business: 159 },
  EUR: { personal: 14, professional: 45, business: 183 },
};

/** Overage per page by currency (approximate). */
const OVERAGE_BY_CURRENCY: Record<string, Record<TierKey, number>> = {
  USD: { personal: 0.05, professional: 0.045, business: 0.04 },
  GBP: { personal: 0.04, professional: 0.036, business: 0.032 },
  EUR: { personal: 0.045, professional: 0.04, business: 0.036 },
};

const DEFAULT_CURRENCY = 'USD';

/**
 * Infer display currency from browser locale (e.g. en-GB → GBP, en-US → USD).
 * Sites often use navigator.language or Accept-Language; we map locale to currency.
 */
export function getLocaleCurrency(): string {
  if (typeof navigator === 'undefined' || !navigator.language) return DEFAULT_CURRENCY;
  const locale = navigator.language;
  if (locale.startsWith('en-GB') || locale.startsWith('en-IE')) return 'GBP';
  if (locale.startsWith('en-US') || locale.startsWith('en')) return 'USD';
  if (locale.startsWith('de') || locale.startsWith('fr') || locale.startsWith('it') || locale.startsWith('es') || locale.startsWith('nl') || locale.startsWith('pt') || locale.startsWith('pl')) return 'EUR';
  return DEFAULT_CURRENCY;
}

export function getPriceForTier(tierId: TierKey, currency: string): number {
  const prices = PRICES_BY_CURRENCY[currency] ?? PRICES_BY_CURRENCY[DEFAULT_CURRENCY];
  return prices[tierId] ?? TIERS[tierId].price;
}

export function getOverageForTier(tierId: TierKey, currency: string): number {
  const overages = OVERAGE_BY_CURRENCY[currency] ?? OVERAGE_BY_CURRENCY[DEFAULT_CURRENCY];
  return overages[tierId] ?? TIERS[tierId].overageRatePerPage;
}

/** Format a price in the given currency for display (e.g. "$15" or "£12"). */
export function formatPrice(amount: number, currency: string): string {
  const code = PRICES_BY_CURRENCY[currency] ? currency : DEFAULT_CURRENCY;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount);
}

/** Format a small overage amount (e.g. "$0.05" or "£0.04"). */
export function formatOverage(amount: number, currency: string): string {
  const code = PRICES_BY_CURRENCY[currency] ? currency : DEFAULT_CURRENCY;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(amount);
}

export const USAGE_THRESHOLDS = {
  warning: 0.80,
  urgent: 0.9,
  limit: 1.0,
} as const;

export type UsageState = 'ok' | 'warning' | 'urgent' | 'limit';

/** Get usage state from percentage (0-100+) for UI gating and styling. */
export function getUsageState(usagePercent: number): UsageState {
  if (usagePercent >= 100) return 'limit';
  if (usagePercent >= 90) return 'urgent';
  if (usagePercent >= 80) return 'warning';
  return 'ok';
}

export type TierKey = keyof typeof TIERS;

/** Order of tiers for upgrade progression (Starter → Pro → Business). */
const TIER_ORDER: TierKey[] = ['personal', 'professional', 'business'];

/**
 * Next tier in upgrade order, or null if current is business (top tier).
 */
export function getNextTier(current: TierKey): TierKey | null {
  const i = TIER_ORDER.indexOf(current);
  if (i < 0 || i >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[i + 1];
}

/**
 * CTA label for dashboard upgrade button, e.g. "Upgrade to OpenFind AI Pro".
 * Returns null when current is business (no upgrade to show).
 */
export function getUpgradeButtonLabel(current: TierKey | string | null | undefined): string | null {
  const key = current as TierKey | undefined;
  if (!key || !(key in TIERS)) return null;
  const next = getNextTier(key as TierKey);
  if (!next) return null;
  const name = TIERS[next].name;
  return `Upgrade to OpenFind AI ${name}`;
}

/** Normalize API/context plan string to TierKey. */
function normalizePlanToTier(plan: TierKey | string | null | undefined): TierKey {
  if (!plan || typeof plan !== 'string') return 'professional';
  const p = plan.toLowerCase().trim();
  if (p === 'pro' || p === 'professional') return 'professional';
  if (p === 'starter' || p === 'personal') return 'personal';
  if (p === 'business' || p === 'ultra' || p === 'plus') return 'business';
  return TIER_ORDER.includes(p as TierKey) ? (p as TierKey) : 'professional';
}

/**
 * Badge info for the current plan (sidebar, profile, etc.) — pill label and color.
 * badgeColor: for light mode. badgeColorDark: for dark mode (higher contrast).
 */
export function getPlanBadgeInfo(plan: TierKey | string | null | undefined): {
  badgeText: string;
  badgeColor: string;
  badgeColorDark: string;
} {
  if (!plan || (typeof plan === 'string' && plan.toLowerCase() === 'free')) {
    return { badgeText: 'Free', badgeColor: '#6B7280', badgeColorDark: '#9CA3AF' };
  }
  const key = normalizePlanToTier(plan);
  const tier = TIERS[key];
  const name = tier?.name ?? (plan ? String(plan).charAt(0).toUpperCase() + String(plan).slice(1) : 'Free');
  const colors: Record<TierKey, { light: string; dark: string }> = {
    personal: { light: '#5B9A8B', dark: '#7BC4B5' },
    professional: { light: '#388E8C', dark: '#5DB8B5' },
    business: { light: '#24808C', dark: '#3BA8B0' },
  };
  const { light, dark } = colors[key] ?? { light: '#6B7280', dark: '#9CA3AF' };
  return {
    badgeText: name,
    badgeColor: light,
    badgeColorDark: dark,
  };
}

/**
 * CTA info for dashboard upgrade button — copy, badge text, and badge color.
 * Returns null when current is business (no upgrade to show).
 */
export function getUpgradeCtaInfo(current: TierKey | string | null | undefined): {
  copy: string;
  badgeText: string;
  badgeColor: string;
} | null {
  const key = normalizePlanToTier(current);
  const next = getNextTier(key);
  if (!next) return null;
  if (next === 'professional') {
    return { copy: 'Upgrade for 4× more pages and top AI models', badgeText: 'Pro', badgeColor: '#388E8C' };
  }
  if (next === 'business') {
    return { copy: 'Upgrade for 5,000 pages and faster responses', badgeText: 'Plus', badgeColor: '#24808C' };
  }
  return null;
}

/**
 * CTA copy for dashboard upgrade button — benefit-led, OpenFind-specific.
 * Returns null when current is business (no upgrade to show).
 */
export function getUpgradeCtaCopy(current: TierKey | string | null | undefined): string | null {
  return getUpgradeCtaInfo(current)?.copy ?? null;
}

const BUSINESS_PAGE_LIMIT = TIERS.business.pageLimit;

/**
 * Multiplier for page allowance when upgrading from current tier to Business.
 * e.g. Professional (2000) → Business (5000) = 2.5
 */
export function usageMultiplierForBusiness(currentTier: string): number {
  const tier = TIERS[currentTier as TierKey];
  if (!tier) return 1;
  const currentLimit = tier.pageLimit;
  if (currentLimit <= 0) return 1;
  return Math.round((BUSINESS_PAGE_LIMIT / currentLimit) * 10) / 10;
}

/**
 * Human-readable line for "upgrade to Plus" copy, e.g. for the current-plan card.
 */
export function upgradeToBusinessCopy(currentTier: string): string {
  const multiplier = usageMultiplierForBusiness(currentTier);
  const businessLimit = TIERS.business.pageLimit.toLocaleString();
  if (multiplier <= 1) return `Upgrade to Plus for ${businessLimit} pages/month.`;
  return `Upgrade to Plus for ${multiplier}× page allowance (${businessLimit} pages/month).`;
}
