import { useLocale, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import type { Goal, GoalSummary } from "@/lib/api/goals/types";
import { formatGoalCurrency } from "@/lib/goals/format";

function currencyFor(goal: Goal) {
  return (
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" && goal.currencyKey?.code
      ? goal.currencyKey.code
      : undefined)
  );
}
export default function GoalFundingPanel({
  goal,
  summary,
}: {
  goal: Goal;
  summary: GoalSummary;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const c = currencyFor(goal);

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-foreground text-sm font-semibold">
        {t("goals.monthly-contribution")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t("goals.assigned-this-month")}
          value={formatGoalCurrency(summary.assignedThisMonth, c, locale)}
        />
        <Stat
          label={t("goals.needed-this-month")}
          value={
            summary.requiredMonthlyContribution === null
              ? "—"
              : formatGoalCurrency(
                  summary.requiredMonthlyContribution,
                  c,
                  locale,
                )
          }
        />
        <Stat
          label={t("goals.short-by")}
          value={
            summary.monthlyShortfall === null
              ? "—"
              : formatGoalCurrency(summary.monthlyShortfall, c, locale)
          }
        />
      </div>
      <p className="text-muted-foreground text-sm">
        {t("goals.budget-explainer")}
      </p>
      {/* The Assign money / Move money out pair used to be repeated here,
          identical in label and variant to the pair in the header 370px above
          — two primaries on one screen for the same action. The header owns
          them; this panel reports the numbers. */}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}
