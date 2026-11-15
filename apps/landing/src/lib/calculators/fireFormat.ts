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
