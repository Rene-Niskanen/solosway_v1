"use client";

import * as React from "react";
import { backendApi, type UsageResponse } from "@/services/backendApi";
import { TIERS, type TierKey } from "@/config/billing";

function parseUsagePayload(res: Awaited<ReturnType<typeof backendApi.getUsage>>): UsageResponse | null {
  const payload =
    res.data && typeof res.data === "object" && "data" in res.data
      ? (res.data as { data: UsageResponse }).data
      : res.data;
  return res.success && payload ? payload : null;
}

type UsageContextValue = {
  usage: UsageResponse | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
  setUsageOptimistic: (plan: TierKey) => void;
};

const UsageContext = React.createContext<UsageContextValue | null>(null);

const OPTIMISTIC_PLAN_GRACE_MS = 5000;

export function useUsage(): UsageContextValue {
  const ctx = React.useContext(UsageContext);
  if (!ctx) {
    throw new Error("useUsage must be used within UsageProvider");
  }
  return ctx;
}

export function useUsageOptional(): UsageContextValue | null {
  return React.useContext(UsageContext);
}

export const UsageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [usage, setUsage] = React.useState<UsageResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const optimisticPlanRef = React.useRef<{ plan: TierKey; at: number } | null>(null);

  const refetch = React.useCallback(() => {
    setError(false);
    backendApi
      .getUsage()
      .then((res) => {
        const payload = parseUsagePayload(res);
        if (!payload) {
          setError(true);
          return;
        }
        const optimistic = optimisticPlanRef.current;
        if (
          optimistic &&
          Date.now() - optimistic.at < OPTIMISTIC_PLAN_GRACE_MS &&
          payload.plan !== optimistic.plan
        ) {
          const tier = TIERS[optimistic.plan];
          const monthly_limit = tier?.pageLimit ?? payload.monthly_limit;
          const remaining = Math.max(0, monthly_limit - payload.pages_used);
          const usage_percent = monthly_limit > 0 ? (payload.pages_used / monthly_limit) * 100 : 0;
          setUsage({
            ...payload,
            plan: optimistic.plan,
            monthly_limit,
            remaining,
            usage_percent,
          });
        } else {
          if (optimistic && (payload.plan === optimistic.plan || Date.now() - optimistic.at >= OPTIMISTIC_PLAN_GRACE_MS)) {
            optimisticPlanRef.current = null;
          }
          setUsage(payload);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const setUsageOptimistic = React.useCallback((plan: TierKey) => {
    optimisticPlanRef.current = { plan, at: Date.now() };
    setUsage((prev) => {
      if (!prev) return prev;
      const tier = TIERS[plan];
      const monthly_limit = tier?.pageLimit ?? prev.monthly_limit;
      const pages_used = prev.pages_used;
      const remaining = Math.max(0, monthly_limit - pages_used);
      const usage_percent = monthly_limit > 0 ? (pages_used / monthly_limit) * 100 : 0;
      return {
        ...prev,
        plan,
        monthly_limit,
        remaining,
        usage_percent,
      };
    });
  }, []);

  React.useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const plan = e instanceof CustomEvent && (e as CustomEvent<{ plan?: string }>).detail?.plan;
      if (plan && (plan === "personal" || plan === "professional" || plan === "business")) {
        setUsageOptimistic(plan as TierKey);
      }
      refetch();
    };
    window.addEventListener("usageShouldRefresh", handler);
    return () => window.removeEventListener("usageShouldRefresh", handler);
  }, [refetch, setUsageOptimistic]);

  const value = React.useMemo(
    () => ({ usage, loading, error, refetch, setUsageOptimistic }),
    [usage, loading, error, refetch, setUsageOptimistic]
  );

  return <UsageContext.Provider value={value}>{children}</UsageContext.Provider>;
};
