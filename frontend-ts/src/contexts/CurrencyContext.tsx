"use client";

import * as React from "react";
import { getLocaleCurrency } from "@/config/billing";

const STORAGE_KEY = "velora_currency";

export const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD ($)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "EUR", label: "EUR (€)" },
] as const;

type CurrencyContextValue = {
  currency: string;
  setCurrency: (currency: string) => void;
};

const CurrencyContext = React.createContext<CurrencyContextValue | null>(null);

function readStoredCurrency(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getInitialCurrency(): string {
  const stored = readStoredCurrency();
  if (stored && CURRENCY_OPTIONS.some((o) => o.value === stored)) return stored;
  return getLocaleCurrency();
}

export function useCurrency(): CurrencyContextValue {
  const ctx = React.useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return ctx;
}

export function useCurrencyOptional(): CurrencyContextValue | null {
  return React.useContext(CurrencyContext);
}

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = React.useState<string>(() => getInitialCurrency());

  const setCurrency = React.useCallback((next: string) => {
    if (!CURRENCY_OPTIONS.some((o) => o.value === next)) return;
    setCurrencyState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = React.useMemo(
    () => ({ currency, setCurrency }),
    [currency, setCurrency]
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};
