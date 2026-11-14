import type { MonthComparisonCategoryRow, MonthComparisonData, MonthComparisonTotals } from './reports-contract'

export type MonthComparisonRow = Readonly<{
  key: string
  name: string
  color: string
  base: number
  compare: number
  delta: number
  deltaPct: number | null
}>

export type MonthComparisonReportViewModel = Readonly<{
  base: MonthComparisonTotals
  compare: MonthComparisonTotals
  rows: readonly MonthComparisonRow[]
}>

/**
 * Web's `MonthComparisonReport` as a list: the two months' totals and one row per
 * category, already ordered by absolute change by the API. Nothing is folded into
 * "Other" — the comparison is only useful when every category is named.
 */
export function mapMonthComparisonReport(response: { data: MonthComparisonData }): MonthComparisonReportViewModel {
  return {
    base: response.data.base,
    compare: response.data.compare,
    rows: response.data.categories.map((row: MonthComparisonCategoryRow) => ({
      base: row.base,
      color: row.color,
      compare: row.compare,
      delta: row.delta,
      deltaPct: row.deltaPct,
      key: row.categoryKey,
      name: row.name,
    })),
  }
}
