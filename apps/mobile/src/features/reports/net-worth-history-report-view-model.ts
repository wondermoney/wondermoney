import type { ReportNetWorthPoint } from './reports-contract'

export type NetWorthHistoryChartPoint = Readonly<{ x: number; value: number }>

export type NetWorthHistoryReportTrend = Readonly<{ delta: number; percent: number | null }>

export type NetWorthHistoryReportViewModel = Readonly<{
  points: readonly NetWorthHistoryChartPoint[]
  dates: readonly string[]
  trend: NetWorthHistoryReportTrend
  latestBreakdown: Readonly<{ assets: number; liabilities: number }> | null
}>

/** Month-over-month delta and percent change between the two most recent points.
 *
 * Web returns 0 for the percentage when there are fewer than two points or the
 * prior point was exactly zero, and the note here already said why that is
 * wrong: percent-of-zero is undefined, not "no change". This returns `null`
 * instead, matching the spending report — the two screens sat side by side in
 * the same hub and disagreed about how to say "there is nothing to compare".
 * A deliberate divergence from web; the delta is unchanged. */
function computeTrend(points: readonly ReportNetWorthPoint[]): NetWorthHistoryReportTrend {
  if (points.length < 2) return { delta: 0, percent: null }
  const latest = points[points.length - 1]!
  const previous = points[points.length - 2]!
  const delta = latest.netWorth - previous.netWorth
  const percent = previous.netWorth !== 0 ? Number(((delta / Math.abs(previous.netWorth)) * 100).toFixed(1)) : null
  return { delta, percent }
}

export function mapNetWorthHistoryReport(response: { data: readonly ReportNetWorthPoint[] }): NetWorthHistoryReportViewModel {
  const points = response.data
  return {
    points: points.map((point, index) => ({ x: index, value: point.netWorth })),
    dates: points.map((point) => point.date),
    trend: computeTrend(points),
    latestBreakdown: points.length > 0 ? points[points.length - 1]!.breakdown : null,
  }
}
