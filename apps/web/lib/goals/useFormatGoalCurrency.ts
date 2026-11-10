"use client";

import { useCallback } from "react";

import { maskMoney } from "@/lib/privacy/mask";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";

import { formatGoalCurrency } from "./format";

/**
 * `formatGoalCurrency` with privacy mode applied, same signature, so a goals
 * component swaps its import for one hook line and its call sites stay put.
 */
export function useFormatGoalCurrency() {
  const { hidden } = usePrivacyMode();

  return useCallback(
    (value: number, currency: null | string | undefined, locale: string) =>
      hidden
        ? maskMoney(currency, locale)
        : formatGoalCurrency(value, currency, locale),
    [hidden],
  );
}
