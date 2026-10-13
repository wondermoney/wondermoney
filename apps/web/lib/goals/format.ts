function normalizeGoalLocale(locale: string): string {
  return locale === "pt" ? "pt-PT" : locale;
}

export function formatGoalCurrency(
  value: number,
  currency: null | string | undefined,
  locale: string,
): string {
  return new Intl.NumberFormat(normalizeGoalLocale(locale), {
    currency: currency ?? undefined,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: currency ? "currency" : "decimal",
  }).format(value);
}

export function formatGoalDate(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(normalizeGoalLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatGoalPercentage(value: number, locale: string): string {
  return new Intl.NumberFormat(normalizeGoalLocale(locale), {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(value / 100);
}

/** Format an annual interest rate stored in basis points (1999 => "20%"). */
export function formatGoalInterestRate(bps: number, locale: string): string {
  return new Intl.NumberFormat(normalizeGoalLocale(locale), {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(bps / 10000);
}
