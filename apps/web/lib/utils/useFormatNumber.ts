"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";
import { formatNumberForLocale } from "@/lib/utils/formatNumber";

/** RAD-575 — `formatNumber` bound to the active locale. See `useFormatPercentage`. */
export function useFormatNumber() {
  const locale = useLocale();

  return useCallback(
    (val: number) =>
      formatNumberForLocale(val, normalizeFinancialLocale(locale) ?? locale),
    [locale],
  );
}

export default useFormatNumber;
