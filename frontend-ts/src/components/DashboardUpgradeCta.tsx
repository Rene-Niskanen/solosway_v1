"use client";

import * as React from "react";
import { getUpgradeButtonLabel } from "@/config/billing";
import { usePlanModal } from "@/contexts/PlanModalContext";
import { useUsage } from "@/contexts/UsageContext";

/**
 * Dashboard upgrade CTA: pill in top-right, opens plan modal.
 * Shown only when current plan is not business; label is dynamic (e.g. "Upgrade to Velora AI Pro").
 */
export const DashboardUpgradeCta: React.FC = () => {
  const { openPlanModal } = usePlanModal();
  const { usage, loading } = useUsage();

  const label = React.useMemo(
    () => getUpgradeButtonLabel(usage?.plan ?? null),
    [usage?.plan]
  );

  if (loading || !label || !usage) return null;

  const handleClick = () => {
    openPlanModal(usage.plan ?? "professional", usage.billing_cycle_end);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute flex items-center gap-2 rounded-full border-2 px-4 py-1.5 transition-all duration-150 hover:bg-[#F2F2EF] hover:border-[#D4D4D0] hover:shadow-md hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#141413]/20"
      style={{
        top: 24,
        right: 24,
        zIndex: 1000,
        backgroundColor: "#ffffff",
        borderColor: "#F2F2EF",
        color: "#141413",
      }}
      aria-label={label}
    >
      <img
        src="/veloralogo-nobg.png"
        alt=""
        className="h-5 w-5 flex-shrink-0 object-contain"
        style={{ marginTop: 3 }}
      />
      <span className="text-[13px] font-medium text-[#141413]">{label}</span>
    </button>
  );
};
