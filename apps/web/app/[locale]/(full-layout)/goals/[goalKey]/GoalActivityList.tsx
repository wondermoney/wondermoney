import type { UseQueryResult } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { Timeline } from "@/components/ui/Timeline";
import type {
  GetGoalActivityResponse,
  GoalActivity,
} from "@/lib/api/goals/types";
import { formatGoalCurrency, formatGoalDate } from "@/lib/goals/format";

function formatActivityAmount(
  activity: GoalActivity,
  locale: string,
  fallbackCurrencyCode?: string,
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
  if (activityQuery.isLoading)
    return (
      <Card className="text-muted-foreground p-6 text-sm">
        {t("goals.activity")}
      </Card>
    );
  if (activityQuery.isError)
    return (
      <Card className="text-muted-foreground p-6 text-sm">
        {t("server-error")}
      </Card>
    );
  const activities = activityQuery.data?.activities ?? [];
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-foreground text-sm font-semibold">
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
            trailing: (() => {
              const amount = formatActivityAmount(
                activity,
                locale,
                currencyCode,
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
    </Card>
  );
}
