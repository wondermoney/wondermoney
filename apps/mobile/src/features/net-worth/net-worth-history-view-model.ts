import type {
  NetWorthHistoryPointDto,
  NetWorthHistoryReadiness,
  NetWorthHistorySummaryDto,
} from './net-worth-contract'

export type NetWorthTrendPoint = Readonly<{
  date: string
  /** Net worth for the month, or null when the month could not be fully resolved. */
  value: number | null
  isComplete: boolean
  /** Signed change from the previous *resolved* point, or null when not computable. */
  change: number | null
}>

export type NetWorthTrendStats = Readonly<{
  earliest: number | null
  latest: number | null
  high: number | null
  low: number | null
  /** latest − earliest across resolved points. */
  netChange: number | null
}>

export type NetWorthTrendViewModel = Readonly<{
  currencyCode: string
  readiness: NetWorthHistoryReadiness
  points: readonly NetWorthTrendPoint[]
  stats: NetWorthTrendStats
}>

/**
 * The server's "monthly" series also carries a point for every day with a transaction in the
 * window, so several points share a month. Keep the last point of each month (the month-end
 * close, or today for the current month), matching web's `monthlyNetWorthPoints`.
 */
export function monthlyHistoryPoints<T extends { date: string }>(points: readonly T[]): T[] {
  const byMonth = new Map<string, T>()
  for (const point of points) byMonth.set(point.date.slice(0, 7), point)
  return [...byMonth.values()]
}

/**
 * Maps the server history summary into a presentation model, one point per month. All
 * arithmetic is confined to resolved (non-null) points; a null value is never treated as
 * zero, and change is only computed between consecutive resolved points.
 */
export function mapNetWorthHistory(summary: NetWorthHistorySummaryDto): NetWorthTrendViewModel {
  let previousResolved: number | null = null
  const points: NetWorthTrendPoint[] = monthlyHistoryPoints(summary.points).map((point: NetWorthHistoryPointDto) => {
    const value = point.totalNetWorth
    const change = value !== null && previousResolved !== null ? value - previousResolved : null
    if (value !== null) previousResolved = value
    return { date: point.date, value, isComplete: point.isComplete, change }
  })

  const resolved = points.map((p) => p.value).filter((v): v is number => v !== null)
  const stats: NetWorthTrendStats = {
    earliest: resolved.length ? resolved[0] : null,
    latest: resolved.length ? resolved[resolved.length - 1] : null,
    high: resolved.length ? Math.max(...resolved) : null,
    low: resolved.length ? Math.min(...resolved) : null,
    netChange: resolved.length >= 2 ? resolved[resolved.length - 1] - resolved[0] : null,
  }

  return { currencyCode: summary.currencyCode, readiness: summary.readiness, points, stats }
}
