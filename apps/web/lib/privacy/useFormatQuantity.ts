"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

import { formatQuantityForDisplay } from "./format-quantity";
import { usePrivacyMode } from "./usePrivacyMode";

/**
 * A holding's or a trade's unit count in the reader's locale, masked while
 * privacy mode is on (quantity × public price is the position's value).
 */
export function useFormatQuantity() {
  const locale = useLocale();
  const { hidden } = usePrivacyMode();

  return useCallback(
    (value: number | string, options?: Intl.NumberFormatOptions) =>
      formatQuantityForDisplay(value, locale, { ...options, hidden }),
    [locale, hidden],
  );
}
