import type { PortfolioPerformanceReportRow } from './reports-contract'

export type PortfolioPerformanceReportRowViewModel = PortfolioPerformanceReportRow

export type PortfolioPerformanceReportViewModel = Readonly<{
  rows: readonly PortfolioPerformanceReportRowViewModel[]
  generatedAt: string
  /** The household's combined change; null when any portfolio's change is unknown (a partial sum would mislead). */
  aggregateChange: number | null
  /** Web's `totalPortfolioPerformance`: the household row under the table. */
  totals: PortfolioPerformanceTotals
}>

export type PortfolioPerformanceTotals = Readonly<{
  startValue: number | null
  /** Null when any portfolio's is unknown, as for every total here: a partial sum would mislead. */
  netContributions: number | null
  change: number | null
  changePercent: number | null
  dividends: number | null
  endValue: number | null
}>

/** Sums in cents so a column of 2-decimal amounts adds up exactly. */
const sumCents = (values: readonly number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100
const sumKnown = (values: readonly (number | null)[]) => values.some((value) => value === null) ? null : sumCents(values as number[])

/** The percentage is recomputed from the totals (change over start plus contributions), never averaged. */
function totalsOf(rows: readonly PortfolioPerformanceReportRow[]): PortfolioPerformanceTotals {
  const startValue = sumKnown(rows.map((row) => row.startValue))
  const netContributions = sumKnown(rows.map((row) => row.netContributions))
  const change = sumKnown(rows.map((row) => row.change))
  const invested = startValue === null || netContributions === null ? null : sumCents([startValue, netContributions])
  return {
    startValue,
    netContributions,
    change,
    changePercent: change !== null && invested !== null && invested > 0 ? Math.round((change / invested) * 10_000) / 100 : null,
    dividends: sumKnown(rows.map((row) => row.dividends)),
    endValue: sumKnown(rows.map((row) => row.endValue)),
  }
}

/**
 * Mirrors web's sortByAbsoluteChangeDesc (components/reports/reports/portfolio-performance.ts):
 * biggest movers, up or down, first; unknown changes last. Every amount is already in the appuser's
 * currency server-side, so it is formatted with the shared reports currency.
 */
export function mapPortfolioPerformanceReport(response: { data: readonly PortfolioPerformanceReportRow[]; generatedAt: string }): PortfolioPerformanceReportViewModel {
  const rows = [...response.data].sort((a, b) => Math.abs(b.change ?? -1) - Math.abs(a.change ?? -1))
  const changes = response.data.map((row) => row.change)
  const aggregateChange = changes.some((change) => change === null) ? null : sumCents(changes as number[])
  return { rows, generatedAt: response.generatedAt, aggregateChange, totals: totalsOf(response.data) }
}
