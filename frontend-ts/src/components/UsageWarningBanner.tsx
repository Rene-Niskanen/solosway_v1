"use client";

import * as React from "react";
import { useUsage } from "@/contexts/UsageContext";
import { usePlanModal } from "@/contexts/PlanModalContext";
import { getUsageState, type UsageState } from "@/config/billing";
import { backendApi } from "@/services/backendApi";
import { useTheme } from "next-themes";
import { AlertTriangle } from "lucide-react";

/**
 * Global banner for usage warnings per BILLING_SPEC §5.3:
 * - 80%: Warning — "Approaching Your Limit"
 * - 90%: Urgent — "Almost at your limit" + Upgrade Now
 * - 100%: Limit — "You've reached your plan's page limit"
 *
 * Only shown when usage is loaded, not on Business tier, and at or above warning threshold.
 */
export const UsageWarningBanner: React.FC = () => {
  const { usage, loading, error } = useUsage();
  const { openPlanModal } = usePlanModal();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light" && resolvedTheme !== undefined;
  const [stripeEnabled, setStripeEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    backendApi
      .getBillingConfig()
      .then((res) => {
        setStripeEnabled(
          res.success && (res.data as { stripeEnabled?: boolean })?.stripeEnabled === true
        );
      })
      .catch(() => setStripeEnabled(false));
  }, []);

  if (loading || error || !usage) return null;

  const usagePercent = usage.usage_percent ?? 0;
  const usageState = getUsageState(usagePercent);

  // Don't show for ok state (< 80%) or when already on Business (no upgrade path)
  if (usageState === "ok" || usage.plan === "business") return null;

  const pagesUsed = usage.pages_used ?? 0;
  const monthlyLimit = usage.monthly_limit ?? 0;
  const remaining = Math.max(0, usage.remaining ?? monthlyLimit - pagesUsed);

  const handleUpgrade = async () => {
    if (stripeEnabled === true) {
      const returnUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/dashboard?billing_return=1`
          : "/dashboard";
      const res = await backendApi.createPortalSession(returnUrl);
      if (res.success && (res.data as { url?: string })?.url) {
        window.location.href = (res.data as { url: string }).url;
        return;
      }
    }
    openPlanModal(usage.plan, usage.billing_cycle_end ?? undefined);
  };

  const config: Record<
    Exclude<UsageState, "ok">,
    { title: string; message: string; button: string; severity: "warning" | "urgent" }
  > = {
    warning: {
      title: "Approaching Your Limit",
      message: `You've used ${pagesUsed.toLocaleString()} of ${monthlyLimit.toLocaleString()} pages. Consider upgrading.`,
      button: "Upgrade",
      severity: "warning",
    },
    urgent: {
      title: "Almost at your limit",
      message: `Only ${remaining.toLocaleString()} pages left this month.`,
      button: "Upgrade Now",
      severity: "urgent",
    },
    limit: {
      title: "Limit Reached",
      message: "You've reached your plan's page limit for this period.",
      button: "Manage subscription",
      severity: "urgent",
    },
  };

  const { title, message, button, severity } = config[usageState];

  const bgClass =
    severity === "urgent"
      ? isDark
        ? "bg-red-950/90 border-red-800"
        : "bg-red-50 border-red-200"
      : isDark
        ? "bg-amber-950/80 border-amber-800"
        : "bg-amber-50 border-amber-200";

  const textClass = isDark ? "text-gray-200" : "text-gray-800";
  const buttonClass =
    severity === "urgent"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-amber-600 hover:bg-amber-700 text-white";

  return (
    <div
      role="region"
      aria-label="Usage limit warning"
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b shrink-0 ${bgClass}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <AlertTriangle
          className="shrink-0 h-4 w-4"
          style={{ color: severity === "urgent" ? "#dc2626" : "#d97706" }}
          aria-hidden
        />
        <span className={`text-[13px] font-medium ${textClass}`}>
          {usageState === "limit" ? "🚫" : "⚠️"} {title}
        </span>
        <span className={`text-[13px] ${isDark ? "text-gray-300" : "text-gray-700"}`}>
          {message}
        </span>
      </div>
      <button
        type="button"
        onClick={handleUpgrade}
        className={`shrink-0 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${buttonClass}`}
      >
        {button}
      </button>
    </div>
  );
};
