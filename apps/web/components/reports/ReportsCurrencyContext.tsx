"use client";

import { useLocale } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import useAccounts from "@/lib/api/account/useAccounts";

interface ReportsCurrencyContextValue {
  /** The user's primary currency, derived from the first account or falling back to EUR. */
  currencyKey: string;
  /** The current next-intl locale. */
  locale: string;
}

const ReportsCurrencyContext = createContext<ReportsCurrencyContextValue | null>(
  null,
);

export function ReportsCurrencyProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const { data: accountsData } = useAccounts();

  const currencyKey = useMemo(() => {
    const firstAccount = accountsData?.accounts[0];
    return (
      firstAccount?.accountOwnerAppuserKey?.currencyKey?.code ??
      firstAccount?.currencyKey?.code ??
      "EUR"
    );
  }, [accountsData]);

  const value = useMemo(
    () => ({ currencyKey, locale }),
    [currencyKey, locale],
  );

  return (
    <ReportsCurrencyContext.Provider value={value}>
      {children}
    </ReportsCurrencyContext.Provider>
  );
}

export function useReportsCurrency(): ReportsCurrencyContextValue {
  const context = useContext(ReportsCurrencyContext);
  if (!context) {
    throw new Error(
      "useReportsCurrency must be used within a ReportsCurrencyProvider",
    );
  }
  return context;
}
