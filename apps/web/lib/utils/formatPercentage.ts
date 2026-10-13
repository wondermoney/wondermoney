/**
 * RAD-575 — percentages in the reader's locale.
 *
 * `formatPercentage` passes `undefined` for locale, so `Intl` resolves to the
 * runtime's — the browser's in a Client Component, the container's during SSR.
 * A `pt` reader sees `12.5%` where they expect `12,5%`, and where the two
 * disagree the same node renders differently on each side.
 *
 * Prefer `useFormatPercentage()`; it binds the active locale and keeps this
 * signature. `formatPercentage` is kept only for the non-React callers that
 * pass a locale explicitly via `formatPercentageForLocale`.
 */
export const formatPercentageForLocale = (
  val: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
) =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...options,
  }).format(val);
