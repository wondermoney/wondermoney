import type { AccountMetrics } from "@/lib/api/account/useAccountsMetrics";

export function aggregateMetrics(metrics: AccountMetrics[]) {
  const agg = metrics.reduce(
    (acc, cur) => ({
      inflowCurrent: acc.inflowCurrent + cur.inflowCurrentPeriod,
      inflowPast: acc.inflowPast + cur.inflowPastPeriod,
      inflowDelta: acc.inflowDelta + cur.inflowDelta,
      outflowCurrent: acc.outflowCurrent + cur.outflowCurrentPeriod,
      outflowPast: acc.outflowPast + cur.outflowPastPeriod,
      outflowDelta: acc.outflowDelta + cur.outflowDelta,
      txCountCurrent: acc.txCountCurrent + cur.transactionCountCurrentPeriod,
      txCountDelta: acc.txCountDelta + cur.transactionCountDelta,
    }),
    {
      inflowCurrent: 0,
      inflowPast: 0,
      inflowDelta: 0,
      outflowCurrent: 0,
      outflowPast: 0,
      outflowDelta: 0,
      txCountCurrent: 0,
      txCountDelta: 0,
    },
  );

  const inflowPct =
    agg.inflowPast === 0
      ? agg.inflowCurrent > 0
        ? Infinity
        : 0
      : (agg.inflowCurrent - agg.inflowPast) / agg.inflowPast;
  const outflowPct =
    agg.outflowPast === 0
      ? agg.outflowCurrent > 0
        ? Infinity
        : 0
      : (agg.outflowCurrent - agg.outflowPast) / agg.outflowPast;

  return { ...agg, inflowPct, outflowPct };
}
