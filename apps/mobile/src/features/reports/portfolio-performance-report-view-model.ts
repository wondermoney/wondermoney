import type { PortfolioPerformanceReportRow } from './reports-contract'

export type PortfolioPerformanceReportRowViewModel = Readonly<{
  accountKey: string
  name: string
  currency: string
  startBalance: number
  endBalance: number
  return: number
  contributions: number
  gaining: boolean
}>

export type PortfolioPerformanceReportViewModel = Readonly<{
  rows: readonly PortfolioPerformanceReportRowViewModel[]
  generatedAt: string
  aggregateReturn: number
}>

const mapRow = (row: PortfolioPerformanceReportRow): PortfolioPerformanceReportRowViewModel => ({
  ...row,
  gaining: row.return >= 0,
})

/**
 * Mirrors web's sortByAbsoluteReturnDesc (PortfolioPerformanceReport.tsx) — biggest movers, up or
 * down, surface first. `row.currency` is each account's own native currency, kept only as an
 * informational label — startBalance/endBalance/contributions/return are all already expressed in
 * the appuser's (household primary) currency server-side (appuserCurrencyBalance /
 * getEffectiveAppuserAmount), so summing `return` across rows into aggregateReturn is safe, and
 * every amount should be *formatted* with the shared reports currency, not row.currency.
 */
export function mapPortfolioPerformanceReport(response: { data: readonly PortfolioPerformanceReportRow[]; generatedAt: string }): PortfolioPerformanceReportViewModel {
  const rows = [...response.data].sort((a, b) => Math.abs(b.return) - Math.abs(a.return)).map(mapRow)
  const aggregateReturn = response.data.reduce((sum, row) => sum + row.return, 0)
  return { rows, generatedAt: response.generatedAt, aggregateReturn }
}
