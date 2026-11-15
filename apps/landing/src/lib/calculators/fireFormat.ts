import type { Lang } from "../i18nLocale";
import { toIntlLocale } from "../numberFormat";
import { splitMonths } from "./fire";

/** A month count as words, e.g. "23 anos e 3 meses" in pt; Intl handles plurals and the "and". */
export function formatFireDuration(lang: Lang, totalMonths: number): string {
  const locale = toIntlLocale(lang);
  const { years, months } = splitMonths(totalMonths);
  const unit = (value: number, name: "year" | "month") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "long" }).format(value);

  if (years === 0) return unit(months, "month");
  if (months === 0) return unit(years, "year");
  return new Intl.ListFormat(locale, { type: "conjunction" }).format([
    unit(years, "year"),
    unit(months, "month"),
  ]);
}

/** A rate with up to two decimals (4%, 2.5%, 3.25%): the rate shown is the rate the calculation used. */
export function formatFireRate(lang: Lang, value: number): string {
  return new Intl.NumberFormat(toIntlLocale(lang), {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/**
 * Progress toward the FIRE number with one decimal. Below the target it rounds
 * down, so 99.97% reads 99.9% and never 100.0% while there is still a gap.
 */
export function formatFireProgress(lang: Lang, progress: number): string {
  // The small epsilon keeps float noise (10 → 9.999…) from flooring a whole step.
  const shown = progress < 100 ? Math.min(99.9, Math.floor(progress * 10 + 1e-9) / 10) : progress;
  return new Intl.NumberFormat(toIntlLocale(lang), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(shown / 100);
}
