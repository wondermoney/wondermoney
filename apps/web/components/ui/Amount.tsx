"use client";

import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";
import {
  FINANCIAL_VALUE_LAYOUT,
  getAmountClassName,
  getDeltaClassName,
  getThresholdClassName,
  normalizeFinancialLocale,
} from "@/lib/utils/formatCurrency";

/**
 * The one way to render money.
 *
 * Two things it does that a bare `formatCurrency()` call cannot (DESIGN.md § 9
 * rules 1 and 3):
 *
 * 1. **The unit recedes.** `Intl.NumberFormat` with `style: "currency"` returns
 *    one atomic string — `€11,250.00` — with no seam to style. Split through
 *    `formatToParts`, the symbol can sit in muted ink while the magnitude
 *    stays in foreground, so the eye compares figures down a column and skips
 *    a token that is identical on every row.
 * 2. **Absence is `—`, not `0`.** A zero is a measurement. Passing `null`
 *    renders an em-dash, because the alternative is what made Apple render as
 *    `US$0.00` beside a chart showing $330.
 *
 * Position is **not** hardcoded: the symbol prefixes in `en` (`€11,250.00`)
 * and suffixes in `pt` (`11 250,00 €`), so the parts are rendered in the order
 * the locale returns them.
 */

export type AmountTone = "level" | "delta" | "threshold";

const TONE_CLASS: Record<AmountTone, (value: number) => string> = {
  // A balance, a total, an amount held — never coloured by its sign.
  level: () => getAmountClassName(),
  // A change against a baseline — direction is the information.
  delta: (value) => getDeltaClassName(value),
  // A level that is only exceptional once it goes negative.
  threshold: (value) => getThresholdClassName(value),
};

export interface AmountProps {
  /** `null` / `undefined` / `NaN` all render as an em-dash. */
  value: number | null | undefined;
  currency?: string;
  /** How the figure earns (or does not earn) colour. Defaults to `level`. */
  tone?: AmountTone;
  /** Append the ISO code in muted ink — for multi-currency surfaces. */
  showCode?: boolean;
  /** Force a leading `+` on positives. Deltas usually want this. */
  signed?: boolean;
  className?: string;
  /** Overrides the locale from context. Mostly for tests. */
  locale?: string;
  /**
   * Fraction digits, when a surface genuinely wants something other than 2 —
   * whole-euro budget columns are the usual case. Both default to 2; passing
   * only `maximumFractionDigits: 0` also pulls the minimum down, since asking
   * for no decimals and getting `€1,250.00` is never what was meant.
   */
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

const isCurrencyCode = (currency: string) => /^[A-Z]{3}$/.test(currency);

export function Amount({
  value,
  currency = "EUR",
  tone = "level",
  showCode = false,
  signed = false,
  className,
  locale: localeProp,
  minimumFractionDigits,
  maximumFractionDigits,
}: AmountProps) {
  const contextLocale = useLocale();
  const locale = normalizeFinancialLocale(localeProp ?? contextLocale);

  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span
        className={cn(
          "text-muted-foreground",
          FINANCIAL_VALUE_LAYOUT,
          className,
        )}
      >
        —
      </span>
    );
  }

  const parts = new Intl.NumberFormat(locale, {
    ...(isCurrencyCode(currency)
      ? { style: "currency" as const, currency }
      : { style: "decimal" as const }),
    minimumFractionDigits:
      minimumFractionDigits ??
      Math.min(2, maximumFractionDigits ?? 2),
    maximumFractionDigits: maximumFractionDigits ?? 2,
    signDisplay: signed ? ("exceptZero" as const) : ("auto" as const),
  }).formatToParts(value);

  return (
    <span className={cn(TONE_CLASS[tone](value), className)}>
      {parts.map((part, index) =>
        part.type === "currency" ? (
          <span key={index} className="text-muted-foreground">
            {part.value}
          </span>
        ) : (
          part.value
        ),
      )}
      {showCode && isCurrencyCode(currency) ? (
        <>
          {" "}
          <span className="text-muted-foreground text-[0.9em]">{currency}</span>
        </>
      ) : null}
    </span>
  );
}

export default Amount;
