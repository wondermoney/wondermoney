"use client";

import { ArrowDownLeft, ArrowUpRight, PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import { aggregateMetrics } from "@/lib/account/accounts-metrics";
import type { AccountMetrics } from "@/lib/api/account/useAccountsMetrics";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

export default function MetricsCards({
  metrics,
  userCurrency,
}: {
  metrics: AccountMetrics[];
  userCurrency: string;
}) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const agg = aggregateMetrics(metrics);

  const netSavings = agg.inflowCurrent - agg.outflowCurrent;
  const savingsRate =
    agg.inflowCurrent > 0 ? netSavings / agg.inflowCurrent : 0;
  const netSavingsPast = agg.inflowPast - agg.outflowPast;

  return (
    <StatCardGrid>
      {/* `inflowPast` / `outflowPast` were already being aggregated and then
          thrown away — the card showed a level with nothing to judge it
          against. § 9 rule 5: a headline figure carries its comparison. */}
      <StatCard
        icon={ArrowDownLeft}
        label={t("inflow")}
        value={agg.inflowCurrent}
        currency={userCurrency}
        comparisonValue={agg.inflowPast}
        comparisonLabel={t("vs-previous-period")}
        deltaPercent={agg.inflowPct}
        positiveDirection="up"
      />
      <StatCard
        icon={ArrowUpRight}
        label={t("outflow")}
        value={agg.outflowCurrent}
        currency={userCurrency}
        comparisonValue={agg.outflowPast}
        comparisonLabel={t("vs-previous-period")}
        deltaPercent={agg.outflowPct}
        // Spending less is the good direction here, so the trend chip inverts.
        positiveDirection="down"
      />
      <StatCard
        icon={PiggyBank}
        label={t("savings-rate")}
        value={netSavings}
        currency={userCurrency}
        comparisonValue={netSavingsPast}
        comparisonLabel={t("vs-previous-period")}
        helper={t("net-savings-rate", { rate: formatPercentage(savingsRate) })}
      />
    </StatCardGrid>
  );
}
