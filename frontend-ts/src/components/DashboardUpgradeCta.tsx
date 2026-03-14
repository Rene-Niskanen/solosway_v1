"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { getUpgradeCtaInfo, getNextTier } from "@/config/billing";
import { usePlanModal } from "@/contexts/PlanModalContext";
import { useUsage } from "@/contexts/UsageContext";
import type { TierKey } from "@/config/billing";

/** Toast shows ~3s; CTA appears 1 min after toast hides. Total hide = 63s so they never overlap. */
const HIDE_AFTER_PLAN_CHANGE_MS = 63000;

/**
 * Dashboard upgrade CTA: pill at top-center of dashboard, opens plan modal.
 * Shown only when current plan is not business.
 * Pro badge (teal) when on Starter; Plus badge (green) when on Pro.
 * Hides temporarily after a plan change, then reappears.
 */
export const DashboardUpgradeCta: React.FC = () => {
  const { openPlanModal } = usePlanModal();
  const { usage, loading } = useUsage();
  const [hideUntil, setHideUntil] = React.useState<number | null>(null);

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const handlePlanChange = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setHideUntil(Date.now() + HIDE_AFTER_PLAN_CHANGE_MS);
      timeoutRef.current = setTimeout(() => {
        setHideUntil(null);
        timeoutRef.current = null;
      }, HIDE_AFTER_PLAN_CHANGE_MS);
    };
    window.addEventListener("planChangeCompleted", handlePlanChange);
    return () => {
      window.removeEventListener("planChangeCompleted", handlePlanChange);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const ctaInfo = React.useMemo(
    () => getUpgradeCtaInfo(usage?.plan ?? null),
    [usage?.plan]
  );

  const isHidden = hideUntil !== null;
  if (loading || !ctaInfo || !usage || isHidden) return null;

  const handleClick = () => {
    const currentTier = (usage.plan ?? "professional") as TierKey;
    const nextTier = getNextTier(currentTier);
    openPlanModal(usage.plan ?? "professional", usage.billing_cycle_end, nextTier ?? undefined);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border px-2 py-0.5 transition-all duration-150 hover:bg-muted hover:border-border hover:shadow-md hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
      style={{
        position: 'absolute',
        top: 24,
        zIndex: 1000,
        backgroundColor: "#FFFFFF",
        borderColor: "#E0E0E0",
        color: "#333333",
      }}
      aria-label={ctaInfo.copy}
    >
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none text-white flex items-center justify-center flex-shrink-0 mr-1"
        style={{ backgroundColor: ctaInfo.badgeColor }}
      >
        {ctaInfo.badgeText}
      </span>
      <span className="text-[13px] font-medium text-[#333333]">{ctaInfo.copy}</span>
      <ChevronRight className="flex-shrink-0 text-[#333333]" size={14} strokeWidth={2} aria-hidden />
    </button>
  );
};
