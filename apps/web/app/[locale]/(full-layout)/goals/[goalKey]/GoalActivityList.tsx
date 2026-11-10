import type { UseQueryResult } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Timeline } from "@/components/ui/Timeline";
import type {
  GetGoalActivityResponse,
  GoalActivity,
} from "@/lib/api/goals/types";
import { formatGoalDate } from "@/lib/goals/format";
import { useFormatGoalCurrency } from "@/lib/goals/useFormatGoalCurrency";

function formatActivityAmount(
  activity: GoalActivity,
  locale: string,
  fallbackCurrencyCode: string | undefined,
  formatGoalCurrency: ReturnType<typeof useFormatGoalCurrency>,
) {
  if (activity.amount == null) return null;
  const currency =
    typeof activity.currencyKey === "object" && activity.currencyKey?.code
      ? activity.currencyKey.code
      : fallbackCurrencyCode;
  return formatGoalCurrency(activity.amount, currency, locale);
}

export default function GoalActivityList({
  activityQuery,
  currencyCode,
}: {
  activityQuery: UseQueryResult<GetGoalActivityResponse, Error>;
  currencyCode?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formatGoalCurrency = useFormatGoalCurrency();
  if (activityQuery.isLoading)
    return (
      <section className="border-foreground text-muted-foreground border-t-2 pt-4 text-sm">
        {t("goals.activity")}
      </section>
    );
  if (activityQuery.isError)
    return (
      <section className="border-foreground text-muted-foreground border-t-2 pt-4 text-sm">
        {t("server-error")}
      </section>
    );
  const activities = activityQuery.data?.activities ?? [];
  return (
    <section className="border-foreground space-y-4 border-t-2 pt-4">
      <h2 className="text-foreground text-lg font-semibold tracking-tight">
        {t("goals.activity")}
      </h2>
      {/* A rail rather than rules between rows: this is a sequence of things
          that happened, and drawing it as one makes the order the point.
          § 9 Timeline. The newest entry is emphasised because it is the
          state the goal is currently in. */}
      {activities.length ? (
        <Timeline
          items={activities.map((activity, index) => ({
            key: activity.goalActivityKey,
            emphasis: index === 0,
            title: t(`goals.goal-activity-${activity.type}`),
            timestamp: formatGoalDate(activity.occurredAt, locale),
            // The funded transaction was retracted by the bank but the goal still pays
            // for it. Text plus an icon, never colour alone. There is no reversal action in the
            // web UI yet, so this only warns.
            description: activity.transactionExpired ? (
              <span className="text-warning-text inline-flex items-start gap-1">
                <TriangleAlert
                  className="mt-0.5 size-3 shrink-0"
                  aria-hidden="true"
                />
                <span>{t("goals.goal-activity-transaction-expired")}</span>
              </span>
            ) : undefined,
            trailing: (() => {
              const amount = formatActivityAmount(
                activity,
                locale,
                currencyCode,
                formatGoalCurrency,
              );
              return amount ? (
                <p className="text-foreground font-mono text-sm whitespace-nowrap tabular-nums">
                  {amount}
                </p>
              ) : null;
            })(),
          }))}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("goals.activity-empty")}
        </p>
      )}
    </section>
  );
}
