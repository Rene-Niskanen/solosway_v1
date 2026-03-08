"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { getUpgradeCtaInfo } from "@/config/billing";
import { usePlanModal } from "@/contexts/PlanModalContext";
import { useUsage } from "@/contexts/UsageContext";

/**
 * Dashboard upgrade CTA: pill at top-center of dashboard, opens plan modal.
 * Shown only when current plan is not business.
 * Pro badge (teal) when on Starter; Plus badge (green) when on Pro.
 */
export const DashboardUpgradeCta: React.FC = () => {
  const { openPlanModal } = usePlanModal();
  const { usage, loading } = useUsage();

  const ctaInfo = React.useMemo(
    () => getUpgradeCtaInfo(usage?.plan ?? null),
    [usage?.plan]
  );

  if (loading || !ctaInfo || !usage) return null;

  const handleClick = () => {
    openPlanModal(usage.plan ?? "professional", usage.billing_cycle_end);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border px-2 py-0.5 transition-all duration-150 hover:bg-[#F0F0EE] hover:border-[#D4D4D0] hover:shadow-md hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
      style={{
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
