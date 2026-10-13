"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

import type { Currency } from "@/lib/api/account/useCurrencies";
import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

/**
 * Options for the currency picker that sits inside a money field.
 *
 * The trigger carries the code alone — "EUR" — while the list keeps the full
 * "EUR (Euro)". Rendering the long form in the trigger is what made the unit
 * price field unreadable: the label, the chevron and the amount fought over a
 * few dozen pixels and the currency clipped (RAD-616).
 */
export function buildCurrencyOptions(currencies: Currency[] | undefined) {
  return currencies?.map((currency) => ({
    shortLabel: currency.code,
    label: `${currency.code} (${currency.description})`,
    value: currency.currencyKey.toString(),
    keywords: [currency.code, currency.description],
  }));
}

/**
 * The currency picker rendered as an inset chip rather than a full-height
 * block. Its hover fill used to run to the very edge of the field and paint
 * over the wrapper's rounded border, so the control looked broken on hover
 * (RAD-617); an inset chip with its own radius cannot reach the border.
 */
export const CURRENCY_TRIGGER_CLASS =
  "h-8 min-w-0 rounded-md border-none px-2 font-mono text-sm";

/** Matching inset for the adornment slot the chip sits in. */
export const CURRENCY_ADORNMENT_CLASS = "pl-1";

/**
 * The empty-state hint for a money input, in the reader's number format.
 *
 * Every amount field hardcoded "00.00", which is not a number in any locale —
 * Portuguese and Spanish write 0,00, and the leading pair of zeroes is not a
 * shape money takes anywhere.
 */
export function useAmountPlaceholder() {
  const locale = useLocale();

  return useMemo(
    () =>
      new Intl.NumberFormat(normalizeFinancialLocale(locale) ?? locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(0),
    [locale],
  );
}
