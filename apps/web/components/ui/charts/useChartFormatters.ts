"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

import { maskMoney } from "@/lib/privacy/mask";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";
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
 *
 * `formatCompactCurrency` follows privacy mode: axis ticks and tooltips that
 * format money through it read `€•••••` while it is on, and the chart keeps
 * its shape. `hidden` is exposed for a chart that needs to drop a label
 * entirely rather than mask it.
 */
export function useChartFormatters() {
  const contextLocale = useLocale();
  const locale = normalizeFinancialLocale(contextLocale) ?? contextLocale;
  const { hidden } = usePrivacyMode();

  return useMemo(
    () => ({
      formatChartDate: (value: Date | string | number) =>
        formatChartDate(value, locale),
      formatChartMonth: (value: Date | string | number) =>
        formatChartMonth(value, locale),
      formatCompactCurrency: (value: number, currencyCode?: string) =>
        hidden
          ? maskMoney(currencyCode, locale)
          : formatCompactCurrency(value, locale, currencyCode),
      formatCompactNumber: (value: number) => formatCompactNumber(value, locale),
      formatPercent: (value: number) => formatPercent(value, locale),
      hidden,
    }),
    [locale, hidden],
  );
}

export default useChartFormatters;
