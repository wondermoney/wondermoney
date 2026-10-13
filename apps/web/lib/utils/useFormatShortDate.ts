"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

import {
  formatShortDateForLocale,
  type ShortDateOptions,
} from "./formatDate";

/**
 * `formatShortDateForLocale` bound to the locale in the URL segment.
 *
 * Same shape as `useFormatCurrency` / `useFormatNumber`: the hook exists so a
 * component never has to reach for `useLocale()` itself and never has the
 * option of passing `undefined`, which resolves to the *runtime's* locale —
 * the browser's on the client, the container's during SSR (RAD-575).
 */
export function useFormatShortDate() {
  const locale = useLocale();

  return useCallback(
    (value: Date | string | number, options?: ShortDateOptions) =>
      formatShortDateForLocale(value, locale, options),
    [locale],
  );
}

export default useFormatShortDate;
