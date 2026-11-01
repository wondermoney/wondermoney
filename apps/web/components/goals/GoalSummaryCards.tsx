import { useLocale, useTranslations } from "next-intl";

import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import type { Goal } from "@/lib/api/goals/types";
import { formatGoalCurrency } from "@/lib/goals/format";

function getCurrencyCode(goal?: Goal) {
  return (
    goal?.currencyCode ??
    (typeof goal?.currencyKey === "object" && goal.currencyKey?.code
      ? goal.currencyKey.code
      : null)
  );
}

export default function GoalSummaryCards({ goals }: { goals: Goal[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const currencyCodes = goals.map((goal) => getCurrencyCode(goal));
  const knownCurrencyCodes = currencyCodes.filter((code): code is string =>
    Boolean(code),
  );
  const uniqueCurrencyCodes = [...new Set(knownCurrencyCodes)];
  const sameKnownCurrency =
    knownCurrencyCodes.length === goals.length &&
    uniqueCurrencyCodes.length === 1;
  const targetTotal = goals.reduce(
    (sum, goal) => sum + (goal.targetAmount ?? 0),
    0,
  );
  const activeCount = goals.filter(
    (goal) => goal.status === "active" || goal.status === "paused",
  ).length;
  // FUNDED is a currency amount — the money actually assigned across goals —
  // not a count of completed goals. Sum each goal's
  // summary.fundedHistorically, mirroring the TARGET total above.
  const fundedTotal = goals.reduce(
    (sum, goal) => sum + (goal.summary?.fundedHistorically ?? 0),
    0,
  );
  const fundedCount = goals.filter(
    (goal) => goal.status === "completed",
  ).length;

  const items = [
    {
      label: sameKnownCurrency ? t("goals.target") : t("goals.goals-count"),
      value: sameKnownCurrency
        ? formatGoalCurrency(targetTotal, uniqueCurrencyCodes[0], locale)
        : String(goals.length),
    },
    { label: t("goals.status-active"), value: String(activeCount) },
    {
      label: t("goals.status-funded"),
      value: sameKnownCurrency
        ? formatGoalCurrency(fundedTotal, uniqueCurrencyCodes[0], locale)
        : String(fundedCount),
      /*
       * § 9 rule 5 — a headline figure carries its comparison, adjacent and
       * muted. Goals have no "last period"; what makes a funded total legible
       * is the target it is measured against, so that is the comparison.
       * Only when every goal shares a currency — summing mixed currencies to
       * one figure would be exactly the dishonest aggregate rule 4 forbids.
       */
      helper: sameKnownCurrency
        ? t("goals.of-target", {
            amount: formatGoalCurrency(
              targetTotal,
              uniqueCurrencyCodes[0],
              locale,
            ),
          })
        : undefined,
    },
  ];

  // Was a bespoke card with a letterspaced uppercase label — the third house
  // style for the same marker in this app. § 9 puts every headline figure on
  // one card with a sentence-case label.
  return (
    <StatCardGrid className="gap-4">
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          {...(item.helper ? { helper: item.helper } : {})}
          valueNode={
            <span className="text-foreground font-mono text-xl font-semibold tracking-tight tabular-nums">
              {item.value}
            </span>
          }
        />
      ))}
    </StatCardGrid>
  );
}
