"use client";

import NumberFlow, { Format } from "@number-flow/react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type StatsItem = {
  name: string;
  value: number | null;
  formatOptions?: Format;
  changeType?: "increase" | "decrease" | null;
  changeValue?: string;
  changePositiveDirection?: "up" | "down";
  helperText?: string;
  unavailableValueLabel?: string;
};

interface StatsProps {
  stats: StatsItem[];
}

export default function Stats({ stats }: StatsProps) {
  const t = useTranslations();

  if (!stats || stats.length === 0) {
    return (
      <div className="text-muted-foreground">
        {t("no-statistics-available")}
      </div>
    );
  }

  return (
    <div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((item) => {
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
              className="border-border bg-card overflow-hidden rounded-lg border p-4"
            >
              <dt className="text-muted-foreground flex justify-between truncate text-sm">
                {item.name}
                <div className={cn("flex items-center", colorClass)}>
                  {!isNeutralChange && Icon && <Icon className="size-4" />}
                  {item.changeValue && (
                    <span className="ml-1 text-xs font-medium">
                      {item.changeValue}
                    </span>
                  )}
                </div>
              </dt>
              <dd className="mt-2 space-y-1">
                <div className="text-foreground font-mono text-xl font-semibold tracking-tight whitespace-nowrap md:text-2xl">
                  {item.value != null ? (
                    <NumberFlow
                      value={item.value}
                      format={item.formatOptions}
                    />
                  ) : (
                    <span className="text-muted-foreground">
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
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
