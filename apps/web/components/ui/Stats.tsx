"use client";

import NumberFlow, { Format } from "@number-flow/react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";
import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

export type StatsItem = {
  name: string;
  value: number | null;
  formatOptions?: Format;
  changeType?: "increase" | "decrease" | null;
  changeValue?: string;
  changePositiveDirection?: "up" | "down";
  helperText?: string;
  /** A caveat about how the value was computed, rendered under it. */
  notice?: ReactNode;
  unavailableValueLabel?: string;
};

interface StatsProps {
  stats: StatsItem[];
  /**
   * Figures per row on wide screens. Four suits a set that splits into a row
   * of four and a row of up to four; it steps down to two below `xl`, where a
   * quarter of the content column is too narrow for a currency figure.
   */
  columns?: 3 | 4;
  mobilePrimaryCount?: number;
}

export default function Stats({
  stats,
  columns = 3,
  mobilePrimaryCount,
}: StatsProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations();
  // The reader's locale, not the runtime's: `12,5 %` for pt, `12.5%` for en.
  const locale = useLocale();
  const numberLocale = normalizeFinancialLocale(locale) ?? locale;

  if (!stats || stats.length === 0) {
    return (
      <div className="text-muted-foreground">
        {t("no-statistics-available")}
      </div>
    );
  }

  return (
    <div>
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-8 sm:gap-y-6",
          columns === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        {stats.map((item, index) => {
          const primaryOnMobile =
            mobilePrimaryCount !== undefined && index < mobilePrimaryCount;
          let colorClass = "text-muted-foreground";
          let Icon = null;

          const numericChange = item.changeValue
            ? Number(item.changeValue.replace(/[^0-9.-]/g, ""))
            : null;
          const isZeroChange = numericChange === 0;
          const isNeutralChange = item.changeType == null || isZeroChange;

          if (isNeutralChange) {
            colorClass = "text-muted-foreground";
          } else if (item.changePositiveDirection === "up") {
            if (item.changeType === "increase") {
              colorClass = "text-success-text";
              Icon = TrendingUp;
            } else if (item.changeType === "decrease") {
              colorClass = "text-destructive-text";
              Icon = TrendingDown;
            }
          } else if (item.changePositiveDirection === "down") {
            if (item.changeType === "decrease") {
              colorClass = "text-success-text";
              Icon = TrendingUp;
            } else if (item.changeType === "increase") {
              colorClass = "text-destructive-text";
              Icon = TrendingDown;
            }
          }

          return (
            <div
              key={item.name}
              // Direction A: a figure under a hairline, not a box.
              className={cn(
                "border-border min-w-0 overflow-hidden border-t pt-3",
                primaryOnMobile && "max-sm:flex max-sm:flex-col",
                mobilePrimaryCount !== undefined &&
                  index >= mobilePrimaryCount &&
                  !expanded &&
                  "hidden sm:block",
              )}
            >
              <dt
                className={cn(
                  "text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm",
                  primaryOnMobile && "max-sm:contents",
                )}
              >
                <span
                  className={cn(
                    "min-w-0",
                    primaryOnMobile && "max-sm:order-1 max-sm:text-xs",
                  )}
                >
                  {item.name}
                </span>
                <div
                  className={cn(
                    "flex shrink-0 items-center",
                    colorClass,
                    primaryOnMobile && "max-sm:order-3 max-sm:mt-1",
                  )}
                >
                  {!isNeutralChange && Icon && <Icon className="size-4" />}
                  {item.changeValue && (
                    <span className="ml-1 text-xs font-medium">
                      {item.changeValue}
                    </span>
                  )}
                </div>
              </dt>
              <dd
                className={cn(
                  "mt-2 space-y-1",
                  primaryOnMobile && "max-sm:order-2 max-sm:mt-1",
                )}
              >
                <div className="text-foreground font-mono text-xl font-medium tracking-tight whitespace-nowrap sm:text-2xl">
                  {item.value != null ? (
                    <NumberFlow
                      locales={numberLocale}
                      value={item.value}
                      format={item.formatOptions}
                    />
                  ) : (
                    <span
                      className={cn(
                        "text-muted-foreground",
                        // A sentence ("Needs more history") is language, not
                        // a figure: body face, body size, normal weight.
                        item.unavailableValueLabel &&
                          "font-sans text-sm font-normal tracking-normal whitespace-normal",
                      )}
                    >
                      {/* An em-dash by default, not "N/A" — § 9 rule 3.
                          Callers with something more useful to say (why it is
                          unavailable) still pass their own label. */}
                      {item.unavailableValueLabel ?? "—"}
                    </span>
                  )}
                </div>
                {item.helperText ? (
                  <p className="text-muted-foreground text-xs">
                    {item.helperText}
                  </p>
                ) : null}
                {item.notice ?? null}
              </dd>
            </div>
          );
        })}
      </dl>
      {mobilePrimaryCount !== undefined && stats.length > mobilePrimaryCount ? (
        <button
          type="button"
          className="text-muted-foreground focus-visible:ring-ring mt-2 min-h-11 rounded-md text-sm underline underline-offset-4 focus-visible:ring-2 sm:hidden"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? "summary-less-details" : "summary-more-details")}
        </button>
      ) : null}
    </div>
  );
}
