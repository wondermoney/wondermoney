import type { CashflowPoint } from './reports-contract'

export type CashflowSeriesPoint = Readonly<{ x: number; income: number; expenses: number; net: number }>

export type CashflowReportViewModel = Readonly<{
  points: readonly CashflowSeriesPoint[]
  months: readonly string[]
  trailingNetAverage: number
}>

const TRAILING_MONTHS = 3

/** Mirrors web's getTrailingNetAverage (CashflowReport.tsx): the mean net cashflow over the most
 * recent (up to) 3 months, used as a supplementary "recent trend" indicator distinct from any
 * single month's figure. */
function computeTrailingNetAverage(points: readonly CashflowPoint[]): number {
  if (points.length === 0) return 0
  const last = points.slice(-TRAILING_MONTHS)
  return last.reduce((sum, point) => sum + point.net, 0) / last.length
}

export function mapCashflowReport(response: { data: readonly CashflowPoint[] }): CashflowReportViewModel {
  const points = response.data
  return {
    points: points.map((point, index) => ({ x: index, income: point.income, expenses: point.expenses, net: point.net })),
    months: points.map((point) => point.month),
    trailingNetAverage: computeTrailingNetAverage(points),
  }
}
