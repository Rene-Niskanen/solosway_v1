"use client";

import * as React from "react";

type PlanModalContextValue = {
  isOpen: boolean;
  currentPlan: string | null;
  billingCycleEnd: string | null;
  openPlanModal: (currentPlan: string, billingCycleEnd?: string) => void;
  closePlanModal: () => void;
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

  const openPlanModal = React.useCallback((plan: string, cycleEnd?: string) => {
    setCurrentPlan(plan);
    setBillingCycleEnd(cycleEnd ?? null);
    setIsOpen(true);
  }, []);

  const closePlanModal = React.useCallback(() => {
    setIsOpen(false);
    setCurrentPlan(null);
    setBillingCycleEnd(null);
  }, []);

  const value: PlanModalContextValue = React.useMemo(
    () => ({ isOpen, currentPlan, billingCycleEnd, openPlanModal, closePlanModal }),
    [isOpen, currentPlan, billingCycleEnd, openPlanModal, closePlanModal]
  );

  return (
    <PlanModalContext.Provider value={value}>
      {children}
    </PlanModalContext.Provider>
  );
};
