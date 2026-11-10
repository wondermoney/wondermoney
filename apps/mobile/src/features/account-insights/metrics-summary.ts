import type { AccountMetricDto } from './insights-contract'

export type MetricsSummary = Readonly<{
  inflowCurrent: number
  inflowPast: number
  outflowCurrent: number
  outflowPast: number
  /** Proportional change; `Infinity` when last period was 0 and this one is not. */
  inflowPct: number
  outflowPct: number
  netSavings: number
  netSavingsPast: number
  /** Net savings over inflow, 0 when there was no inflow. */
  savingsRate: number
}>

const n = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const change = (current: number, past: number) => (past === 0 ? (current > 0 ? Infinity : 0) : (current - past) / past)

/** Web's `aggregateMetrics` + `MetricsCards`: every account summed into one inflow / outflow / savings view. */
export function summarizeMetrics(metrics: readonly AccountMetricDto[]): MetricsSummary | null {
  if (metrics.length === 0) return null
  let inflowCurrent = 0
  let inflowPast = 0
  let outflowCurrent = 0
  let outflowPast = 0
  for (const metric of metrics) {
    inflowCurrent += n(metric.inflowCurrentPeriod)
    inflowPast += n(metric.inflowPastPeriod)
    outflowCurrent += n(metric.outflowCurrentPeriod)
    outflowPast += n(metric.outflowPastPeriod)
  }
  const netSavings = inflowCurrent - outflowCurrent
  return {
    inflowCurrent,
    inflowPast,
    outflowCurrent,
    outflowPast,
    inflowPct: change(inflowCurrent, inflowPast),
    outflowPct: change(outflowCurrent, outflowPast),
    netSavings,
    netSavingsPast: inflowPast - outflowPast,
    savingsRate: inflowCurrent > 0 ? netSavings / inflowCurrent : 0,
  }
}
