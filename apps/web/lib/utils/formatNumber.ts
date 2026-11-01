/**
 * Compact numbers in the reader's locale. See `formatPercentage.ts`
 * for why an `undefined` locale is wrong here.
 */
export const formatNumberForLocale = (val: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
  }).format(val);
