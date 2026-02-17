/**
 * Billing tier config — single source of truth aligned with BILLING_SPEC.md §9.
 * Use for Usage & Billing UI (current-plan card and plan-selection modal).
 */

export const TIERS = {
  personal: {
    id: 'personal',
    name: 'Starter',
    price: 15,
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
    name: 'Business',
    price: 129,
    pageLimit: 5000,
    overageRatePerPage: 0.04,
    seats: 10,
    targetUser: 'Small teams (3-10 people)',
    sharedPool: true,
  },
} as const;

/** Supported display currencies with regional prices (UK-style rounded where applicable). */
export const PRICES_BY_CURRENCY: Record<string, Record<TierKey, number>> = {
  USD: { personal: 15, professional: 49, business: 129 },
  GBP: { personal: 12, professional: 39, business: 99 },
  EUR: { personal: 14, professional: 45, business: 119 },
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

export type TierKey = keyof typeof TIERS;

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
 * Human-readable line for "upgrade to Business" copy, e.g. for the current-plan card.
 */
export function upgradeToBusinessCopy(currentTier: string): string {
  const multiplier = usageMultiplierForBusiness(currentTier);
  const businessLimit = TIERS.business.pageLimit.toLocaleString();
  if (multiplier <= 1) return `Upgrade to Business for ${businessLimit} pages/month.`;
  return `Upgrade to Business for ${multiplier}× page allowance (${businessLimit} pages/month).`;
}
