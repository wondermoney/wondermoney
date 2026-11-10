"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { cn } from "@/lib/utils";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

/**
 * The month's figures above the category ledger: what is left (or how far
 * over), what was spent and planned, and how many lines are over plan. The
 * figures are the ones the page already computes; this only sets them.
 */
export function BudgetMonthLead({
  monthName,
  planned,
  available = planned,
  spent,
  overPlanCount,
  currency,
}: {
  monthName: string;
  planned: number;
  /** Plan plus what rollover carried in; what is left is measured against it. */
  available?: number;
  spent: number;
  overPlanCount: number;
  currency: SupportedCurrencyCodes;
}) {
  const t = useTranslations("budgetPage");
  const left = available - spent;
  const overspent = left < 0;
  const cell =
    "border-border min-w-0 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0";

  return (
    <dl className="grid grid-cols-3 items-end gap-x-4 gap-y-6 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] sm:gap-x-0">
      <div className={cn(cell, "col-span-3 sm:col-span-1")}>
        <dt className="text-foreground text-base font-medium">
          {overspent
            ? t("overspent-in", { month: monthName })
            : t("left-in", { month: monthName })}
        </dt>
        <dd className="mt-1">
          <Amount
            value={overspent ? -left : left}
            currency={currency}
            className={cn(
              "font-mono text-4xl leading-tight font-medium tracking-tight lg:text-5xl",
              overspent && "text-destructive-text",
            )}
          />
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-muted-foreground text-sm">{t("spent")}</dt>
        <dd className="mt-1">
          <Amount
            value={spent}
            currency={currency}
            className="font-mono text-lg font-medium sm:text-2xl"
          />
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-muted-foreground text-sm">{t("planned")}</dt>
        <dd className="mt-1">
          <Amount
            value={planned}
            currency={currency}
            className="font-mono text-lg font-medium sm:text-2xl"
          />
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-muted-foreground text-sm">{t("over-plan")}</dt>
        <dd
          className={cn(
            "mt-1 flex items-baseline gap-2",
            overPlanCount > 0 ? "text-destructive-text" : "text-foreground",
          )}
        >
          <span className="font-mono text-lg font-medium sm:text-2xl">
            {overPlanCount}
          </span>
          <span className="text-sm">
            {t("over-plan-unit", { count: overPlanCount })}
          </span>
        </dd>
      </div>
    </dl>
  );
}

/** What the measure's marks mean, once, under the ledger. */
export function MeasureKey() {
  const t = useTranslations("budgetPage");
  return (
    <ul
      className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-xs"
      aria-label={t("key-label")}
    >
      <li className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="bg-foreground h-3.5 w-0.5" />
        {t("key-plan")}
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="bg-chart-1 h-2.5 w-4 rounded-sm" />
        {t("key-spent")}
      </li>
      <li className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="ring-destructive-text h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,var(--destructive-text)_0_3px,transparent_3px_6px)] ring-1 ring-inset"
        />
        {t("key-over")}
      </li>
    </ul>
  );
}
