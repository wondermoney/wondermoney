"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

import {
  formatMoneyForDisplay,
  formatMoneyForScreenReader,
} from "@/lib/privacy/format-money";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";

/**
 * Money, formatted in the locale the reader chose, and masked while privacy
 * mode is on.
 *
 * `formatCurrency` passes `undefined` for locale, and `Intl.NumberFormat(undefined)`
 * resolves to the *runtime's* locale: the browser's in a Client Component, the
 * container's during SSR (`en-US`, since nothing sets `LANG` in the image).
 * Neither is the locale in the URL segment, so a Portuguese user browsing with an
 * English browser read `€185,000.00` on `/pt` instead of `185.000,00 €` — and the
 * server and client could disagree about the same node, which is a hydration
 * mismatch that visibly rewrites figures after hydration.
 *
 * This returns a function with `formatCurrency`'s exact signature, bound to the
 * active locale and to privacy mode (`€•••••` while it is on). It is the string
 * path every UI component takes; `<Amount>` is the markup path. Both mask, so a
 * figure rendered through either one cannot leak.
 */
export function useFormatCurrency() {
  const locale = useLocale();
  const { hidden } = usePrivacyMode();

  return useCallback(
    (val: number, currency = "EUR", options?: Intl.NumberFormatOptions) =>
      formatMoneyForDisplay(val, currency, locale, { ...options, hidden }),
    [locale, hidden],
  );
}

/**
 * The spoken form of a figure (`11,250.00 euros`), for an `sr-only` span or an
 * `aria-label`. While privacy mode is on it reads "Hidden amount" instead.
 */
export function useFormatCurrencyForScreenReader() {
  const locale = useLocale();
  const { hidden } = usePrivacyMode();
  const t = useTranslations("privacy-mode");

  return useCallback(
    (val: number, currency = "EUR", options?: Intl.NumberFormatOptions) =>
      formatMoneyForScreenReader(val, currency, locale, {
        ...options,
        hidden,
        hiddenLabel: hidden ? t("hidden-amount") : "",
      }),
    [locale, hidden, t],
  );
}
