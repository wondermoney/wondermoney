"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";

/**
 * Money, formatted in the locale the reader chose.
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
 * active locale. A component swaps the module import for this hook and every
 * existing call site keeps working untouched — the alternative was rewriting
 * ~110 call sites to thread a locale through by hand.
 *
 * Client Components only. A Server Component already receives `locale` as a
 * param and should call `formatCurrencyForLocale` with it directly.
 */
export function useFormatCurrency() {
  const locale = useLocale();

  return useCallback(
    (val: number, currency = "EUR", options?: Intl.NumberFormatOptions) =>
      formatCurrencyForLocale(val, currency, locale, options),
    [locale],
  );
}

