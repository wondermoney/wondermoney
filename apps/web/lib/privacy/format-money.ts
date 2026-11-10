import {
  formatCurrencyForLocale,
  formatCurrencyForScreenReader,
} from "@/lib/utils/formatCurrency";

import { maskMoney } from "./mask";

/**
 * The one string path for money in UI code: the formatted figure, or the mask
 * when privacy mode is on. Components use it through `useFormatCurrency()`;
 * this plain form exists for tests and for code that already holds `hidden`.
 */
export function formatMoneyForDisplay(
  value: number,
  currency: string,
  locale: string,
  { hidden, ...options }: Intl.NumberFormatOptions & { hidden: boolean },
): string {
  if (hidden) return maskMoney(currency, locale);
  return formatCurrencyForLocale(value, currency, locale, options);
}

/**
 * The spoken form. With privacy mode on it is the translated "hidden amount"
 * the caller passes, so a screen reader never reads the figure aloud.
 */
export function formatMoneyForScreenReader(
  value: number,
  currency: string,
  locale: string,
  {
    hidden,
    hiddenLabel,
    ...options
  }: Intl.NumberFormatOptions & { hidden: boolean; hiddenLabel: string },
): string {
  if (hidden) return hiddenLabel;
  return formatCurrencyForScreenReader(value, currency, locale, options);
}
