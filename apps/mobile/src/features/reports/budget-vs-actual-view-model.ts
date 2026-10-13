import type { BudgetVsActualRow } from './reports-contract'

export type BudgetVsActualRowViewModel = Readonly<{
  categoryKey: string
  name: string
  color: string
  budgeted: number
  actual: number
  variance: number
  percentUsed: number
  overBudget: boolean
}>

export type BudgetVsActualReportViewModel = Readonly<{
  rows: readonly BudgetVsActualRowViewModel[]
  generatedAt: string
}>

const mapRow = (row: BudgetVsActualRow): BudgetVsActualRowViewModel => ({
  ...row,
  overBudget: row.percentUsed > 100,
})

/** Mirrors web's sortByPercentUsedDesc (BudgetVsActualReport.tsx) — most-overspent categories
 * surface first, matching the same at-a-glance triage the desktop table provides. */
export function mapBudgetVsActualReport(response: { data: readonly BudgetVsActualRow[]; generatedAt: string }): BudgetVsActualReportViewModel {
  const rows = [...response.data].sort((a, b) => b.percentUsed - a.percentUsed).map(mapRow)
  return { rows, generatedAt: response.generatedAt }
}
