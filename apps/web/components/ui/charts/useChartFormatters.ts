"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

import {
  formatChartDate,
  formatChartMonth,
  formatCompactCurrency,
  formatCompactNumber,
  formatPercent,
} from "./chart-formatters";

/**
 * The chart formatters bound to the active locale.
 *
 * Returned from one `useMemo` rather than five `useCallback`s because these are
 * almost always passed straight into a chart's `xFormatter` / `yFormatter`
 * props, and a stable object keeps those props referentially stable across
 * renders.
 */
export function useChartFormatters() {
  const contextLocale = useLocale();
  const locale = normalizeFinancialLocale(contextLocale) ?? contextLocale;

  return useMemo(
    () => ({
      formatChartDate: (value: Date | string | number) =>
        formatChartDate(value, locale),
      formatChartMonth: (value: Date | string | number) =>
        formatChartMonth(value, locale),
      formatCompactCurrency: (value: number, currencyCode?: string) =>
        formatCompactCurrency(value, locale, currencyCode),
      formatCompactNumber: (value: number) => formatCompactNumber(value, locale),
      formatPercent: (value: number) => formatPercent(value, locale),
    }),
    [locale],
  );
}

export default useChartFormatters;
