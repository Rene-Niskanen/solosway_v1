"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { TIERS, upgradeToBusinessCopy, getLocaleCurrency, getPriceForTier, formatPrice, type TierKey } from "@/config/billing";
import { usePlanModal } from "@/contexts/PlanModalContext";
import { useUsage } from "@/contexts/UsageContext";
import { useCurrencyOptional, CURRENCY_OPTIONS } from "@/contexts/CurrencyContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const UsageAndBillingSection: React.FC = () => {
  const { openPlanModal } = usePlanModal();
  const { usage, loading, error } = useUsage();

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-[15px] font-medium text-gray-900">Usage & Billing</h3>
          <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
            View your page usage and plan details.
          </p>
        </div>
        <div className="animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-6">
          <div className="h-6 w-48 bg-gray-200 rounded mb-4" />
          <div className="h-4 w-full bg-gray-200 rounded mb-2" />
          <div className="h-4 w-3/4 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !usage) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-[15px] font-medium text-gray-900">Usage & Billing</h3>
          <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
            View your page usage and plan details.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-600">
          {error ? "Unable to load usage." : "No usage data available."}
        </div>
      </div>
    );
  }

  const tier = usage.plan ? TIERS[usage.plan as keyof typeof TIERS] : null;
  const planName = tier?.name ?? usage.plan;
  const currencyContext = useCurrencyOptional();
  const currency = currencyContext?.currency ?? getLocaleCurrency();
  const planPriceFormatted =
    tier && usage.plan
      ? formatPrice(getPriceForTier(usage.plan as TierKey, currency), currency)
      : null;
  const planDescription = tier?.targetUser ?? "";
  const businessCopy = usage.plan !== "business" ? upgradeToBusinessCopy(usage.plan) : null;

  const pagesUsed = usage.pages_used ?? 0;
  const monthlyLimit = usage.monthly_limit ?? 0;
  const overAllowance = pagesUsed > monthlyLimit;
  const usagePercent = usage.usage_percent ?? 0;
  const formattedPercent = usagePercent === 0 ? "0%" : `${usagePercent.toFixed(1)}%`;
  const displayPercentLabel = overAllowance ? "100%+" : formattedPercent;
  const barFillRatio = Math.min(usagePercent / 100, 1);
  const usageSectionTitle = usage.billing_cycle_end ? "Usage this period" : "Usage this month";
  const periodEndFormatted = usage.billing_cycle_end
    ? new Date(usage.billing_cycle_end + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-gray-900">Usage & Billing</h3>
          <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
            View your page usage and plan details.
          </p>
        </div>
        {currencyContext?.setCurrency && (
          <label className="flex items-center gap-2 text-[13px] text-gray-600">
            <span>Currency</span>
            <Select value={currency} onValueChange={currencyContext.setCurrency}>
              <SelectTrigger className="flex h-6 w-[72px] items-center justify-between rounded-md border border-gray-200 bg-white py-0 pl-1.5 pr-0.5 gap-0.5 text-xs text-gray-900 focus:ring-1 focus:ring-gray-300 focus:ring-offset-0 [&_svg]:h-2.5 [&_svg]:w-2.5">
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent className="z-[200] min-w-0 w-[var(--radix-select-trigger-width)] p-1 text-xs border-gray-200 bg-white shadow-sm" position="popper">
                {CURRENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="py-1 pl-6 pr-2 text-xs focus:bg-gray-100 focus:text-gray-900 data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </div>

      {/* Current plan card — same shape/position as overlay, primary styling */}
      <div className="w-full min-w-0 rounded-xl border border-gray-200 p-6 shadow-sm" style={{ backgroundColor: '#F6F7F3' }}>
        <div className="flex flex-wrap items-baseline gap-2 mb-2">
          <span className="text-[17px] font-normal text-gray-900">{planName}</span>
          <span className="inline-flex items-center rounded-md bg-gray-600 px-1.5 py-px text-[10px] font-medium text-gray-200 leading-tight -translate-y-0.5">Current</span>
          {planPriceFormatted != null && (
            <span className="text-[15px] font-normal text-gray-700">{planPriceFormatted}/mo.</span>
          )}
        </div>
        <p className="text-[13px] text-gray-600 mb-1">
          {usage.monthly_limit.toLocaleString()} pages/month for {planDescription.toLowerCase()}.
        </p>
        {businessCopy && (
          <p className="text-[13px] text-gray-600 mb-4">
            {businessCopy}
          </p>
        )}
        {!businessCopy && <div className="mb-4" />}
        <Button
          variant="outline"
          onClick={() => openPlanModal(usage.plan, usage.billing_cycle_end)}
          className="rounded-sm px-3 py-1 h-auto text-xs font-medium bg-transparent border border-gray-300 text-gray-700 hover:bg-transparent hover:text-gray-700 mt-4"
        >
          Manage Subscription
        </Button>
      </div>

      {/* Usage this period / month */}
      <div className="rounded-lg border border-gray-200 p-6 shadow-sm" style={{ backgroundColor: '#F6F7F3' }}>
        <h4 className="text-[14px] font-normal text-gray-900 mb-3">
          {usageSectionTitle}
          {periodEndFormatted && (
            <span className="text-[12px] font-normal text-gray-500 ml-1.5">(ends {periodEndFormatted})</span>
          )}
        </h4>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[24px] font-normal text-gray-900">{displayPercentLabel}</span>
          <span className="text-[13px] text-gray-600">
            {(usage.pages_used ?? 0).toLocaleString()} / {(usage.monthly_limit ?? 0).toLocaleString()} pages
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden flex">
          {Array.from({ length: 32 }).map((_, i) => {
            const fill = (i + 1) / 32 <= barFillRatio;
            return (
              <div
                key={i}
                className={`flex-1 min-w-0 ${fill ? "bg-gradient-to-r from-orange-500 to-orange-600" : "bg-gray-200"}`}
                style={{ marginRight: i < 31 ? "2px" : 0 }}
              />
            );
          })}
        </div>
        <p className="text-[13px] text-gray-600 mt-2">
          {overAllowance
            ? `0 pages remaining · Over allowance for this period${periodEndFormatted ? ` until ${periodEndFormatted}` : ""}`
            : `${(usage.remaining ?? monthlyLimit).toLocaleString()} pages remaining · ${formattedPercent} of monthly allowance used`}
        </p>
      </div>
    </div>
  );
};
