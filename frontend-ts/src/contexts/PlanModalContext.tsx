"use client";

import * as React from "react";

export type PlanModalTargetTier = "personal" | "professional" | "business";

type PlanModalContextValue = {
  isOpen: boolean;
  currentPlan: string | null;
  billingCycleEnd: string | null;
  /** When set, modal opens directly to the confirm step for this tier (used by DashboardUpgradeCta) */
  targetTier: PlanModalTargetTier | null;
  openPlanModal: (currentPlan: string, billingCycleEnd?: string, targetTier?: PlanModalTargetTier) => void;
  closePlanModal: () => void;
  /** Called when targetTier has been consumed (modal opened to confirm) */
  clearTargetTier: () => void;
};

const PlanModalContext = React.createContext<PlanModalContextValue | null>(null);

export function usePlanModal(): PlanModalContextValue {
  const ctx = React.useContext(PlanModalContext);
  if (!ctx) {
    throw new Error("usePlanModal must be used within PlanModalProvider");
  }
  return ctx;
}

export function usePlanModalOptional(): PlanModalContextValue | null {
  return React.useContext(PlanModalContext);
}

export const PlanModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentPlan, setCurrentPlan] = React.useState<string | null>(null);
  const [billingCycleEnd, setBillingCycleEnd] = React.useState<string | null>(null);
  const [targetTier, setTargetTier] = React.useState<PlanModalTargetTier | null>(null);

  const openPlanModal = React.useCallback((plan: string, cycleEnd?: string, tier?: PlanModalTargetTier) => {
    setCurrentPlan(plan);
    setBillingCycleEnd(cycleEnd ?? null);
    setTargetTier(tier ?? null);
    setIsOpen(true);
  }, []);

  const closePlanModal = React.useCallback(() => {
    setIsOpen(false);
    setCurrentPlan(null);
    setBillingCycleEnd(null);
    setTargetTier(null);
  }, []);

  const clearTargetTier = React.useCallback(() => setTargetTier(null), []);

  const value: PlanModalContextValue = React.useMemo(
    () => ({ isOpen, currentPlan, billingCycleEnd, targetTier, openPlanModal, closePlanModal, clearTargetTier }),
    [isOpen, currentPlan, billingCycleEnd, targetTier, openPlanModal, closePlanModal, clearTargetTier]
  );

  return (
    <PlanModalContext.Provider value={value}>
      {children}
    </PlanModalContext.Provider>
  );
};
