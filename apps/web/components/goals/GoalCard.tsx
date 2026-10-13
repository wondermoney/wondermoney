import { useLocale, useTranslations } from "next-intl";

import GoalProgressBar from "@/components/goals/GoalProgressBar";
import GoalStatusBadge from "@/components/goals/GoalStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import type { Goal } from "@/lib/api/goals/types";
import {
  formatGoalCurrency,
  formatGoalDate,
  formatGoalPercentage,
} from "@/lib/goals/format";

function getCurrencyCode(goal: Goal) {
  return (
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" && goal.currencyKey?.code
      ? goal.currencyKey.code
      : null)
  );
}

function DebtGoalCardBody({
  currency,
  goal,
  locale,
}: {
  currency: null | string;
  goal: Goal;
  locale: string;
}) {
  const t = useTranslations();
  const projection = goal.summary?.debtProjection;
  const balance = projection?.currentBalance ?? goal.currentBalance ?? null;
  // Use summary.progressPercentage to stay consistent with the goal detail page
  // (GoalDetailHeader) — both views now read the same metric.
  const progress = goal.summary?.progressPercentage ?? null;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-foreground truncate text-sm font-medium">
            {goal.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t("goals.type-debt_paydown")}</Badge>
            <GoalStatusBadge
              label={t(`goals.status-${goal.status}`)}
              status={goal.status}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-foreground font-mono text-lg font-semibold">
            {balance === null
              ? "—"
              : formatGoalCurrency(balance, currency, locale)}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("goals.debt-remaining")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {progress !== null && (
          <GoalProgressBar value={Math.min(progress, 100)} />
        )}
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
          <span>
            {projection?.paysOff && projection.payoffDate
              ? `${t("goals.debt-payoff-by")} ${formatGoalDate(projection.payoffDate, locale)}`
              : projection && !projection.paysOff
                ? t("goals.debt-never-pays-off")
                : t("goals.debt-payoff-timeline")}
          </span>
          <span className="font-mono">
            {progress === null ? "—" : formatGoalPercentage(progress, locale)}
          </span>
        </div>
      </div>
    </>
  );
}

function SaveUpGoalCardBody({
  currency,
  goal,
  locale,
}: {
  currency: null | string;
  goal: Goal;
  locale: string;
}) {
  const t = useTranslations();
  const available = goal.summary?.availableAmount ?? null;
  const target = goal.targetAmount ?? 0;
  const progress =
    available !== null && target > 0 ? (available / target) * 100 : null;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-foreground truncate text-sm font-medium">
            {goal.name}
          </h2>
          <GoalStatusBadge
            label={t(`goals.status-${goal.status}`)}
            status={goal.status}
          />
        </div>
        <div className="text-right">
          <p className="text-foreground font-mono text-lg font-semibold">
            {available === null
              ? "—"
              : formatGoalCurrency(available, currency, locale)}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("goals.available")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {progress !== null && (
          <GoalProgressBar value={Math.min(progress, 100)} />
        )}
        {/* This line used to read "<available> / <target>", repeating the
            available figure already set large above it — the card printed
            €0.00 twice, 45px apart. Only the target is new information. */}
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
          <span className="font-mono whitespace-nowrap tabular-nums">
            {t("goals.of-target", {
              amount: formatGoalCurrency(target, currency, locale),
            })}
          </span>
          <span className="font-mono whitespace-nowrap tabular-nums">
            {progress === null ? "—" : formatGoalPercentage(progress, locale)}
          </span>
        </div>
      </div>
    </>
  );
}

export default function GoalCard({ goal }: { goal: Goal }) {
  const locale = useLocale();
  const currency = getCurrencyCode(goal);
  const isDebt = goal.type === "debt_paydown";

  return (
    <Link href={`/goals/${goal.goalKey}`} className="block">
      <Card className="p-5">
        {isDebt ? (
          <DebtGoalCardBody currency={currency} goal={goal} locale={locale} />
        ) : (
          <SaveUpGoalCardBody currency={currency} goal={goal} locale={locale} />
        )}
      </Card>
    </Link>
  );
}
