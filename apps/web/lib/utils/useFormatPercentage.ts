"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";
import { formatPercentageForLocale } from "@/lib/utils/formatPercentage";

/**
 * `formatPercentage` bound to the active locale, same signature, so a
 * component swaps its import and adds one line while its call sites stay put.
 * Mirrors `useFormatCurrency`.
 */
export function useFormatPercentage() {
  const locale = useLocale();

  return useCallback(
    (val: number, options?: Intl.NumberFormatOptions) =>
      formatPercentageForLocale(
        val,
        normalizeFinancialLocale(locale) ?? locale,
        options,
      ),
    [locale],
  );
}

