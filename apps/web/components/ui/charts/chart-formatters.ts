import { parseISO } from "date-fns";

/**
 * RAD-575 — chart axis and tooltip formatters, in the reader's locale.
 *
 * These used to pass `undefined` for locale with a comment saying that
 * "defers to the browser's own locale (matches formatCurrency/formatNumber
 * elsewhere in this codebase)". That was the defect, not the design: `Intl`
 * resolves `undefined` to the *runtime's* locale, which is the browser's on
 * the client and the container's during SSR — neither is the locale in the URL
 * segment. RAD-572 fixed the currency helper it was matching.
 *
 * Every function now takes the locale explicitly. Components should reach for
 * `useChartFormatters()`, which binds it once; these raw forms exist for tests
 * and for anything outside React.
 */

export function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCompactCurrency(
  value: number,
  locale: string,
  currencyCode?: string,
): string {
  if (!currencyCode) return formatCompactNumber(value, locale);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatCompactNumber(value, locale);
  }
}

/**
 * A signed percentage for a chart tooltip.
 *
 * This one was not an `Intl` call at all — it was `toFixed(2)`, so it always
 * produced a decimal *point* no matter who was reading. Same visible defect as
 * the rest of the file, different cause.
 */
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value) + "%";
}

function toValidDate(value: Date | string | number): Date | null {
  const date =
    typeof value === "string"
      ? parseISO(value)
      : value instanceof Date
        ? value
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatChartDate(
  value: Date | string | number,
  locale: string,
): string {
  const date = toValidDate(value);
  return date
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date)
    : String(value);
}

export function formatChartMonth(
  value: Date | string | number,
  locale: string,
): string {
  const date = toValidDate(value);
  return date
    ? new Intl.DateTimeFormat(locale, { month: "short" }).format(date)
    : String(value);
}
