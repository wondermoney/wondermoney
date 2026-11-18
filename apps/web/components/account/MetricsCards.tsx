"use client";

import { ArrowDownLeft, ArrowUpRight, PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import { aggregateMetrics } from "@/lib/account/accounts-metrics";
import type { AccountMetrics } from "@/lib/api/account/useAccountsMetrics";

export default function MetricsCards({
  metrics,
  userCurrency,
  className,
  compactOnMobile = false,
}: {
  metrics: AccountMetrics[];
  userCurrency: string;
  className?: string;
  compactOnMobile?: boolean;
}) {
  const t = useTranslations();
  const agg = aggregateMetrics(metrics);

  const netSavings = agg.inflowCurrent - agg.outflowCurrent;
  const netSavingsPast = agg.inflowPast - agg.outflowPast;

  return (
    <StatCardGrid className={className}>
      {/* `inflowPast` / `outflowPast` were already being aggregated and then
          thrown away — the card showed a level with nothing to judge it
          against. § 9 rule 5: a headline figure carries its comparison. */}
      <StatCard
        compactOnMobile={compactOnMobile}
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
        compactOnMobile={compactOnMobile}
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
        compactOnMobile={compactOnMobile}
        icon={PiggyBank}
        label={t("net-savings")}
        value={netSavings}
        currency={userCurrency}
        comparisonValue={netSavingsPast}
        comparisonLabel={t("vs-previous-period")}
      />
    </StatCardGrid>
  );
}
