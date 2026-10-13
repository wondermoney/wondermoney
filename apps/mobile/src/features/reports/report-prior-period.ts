import type { ReportFilters } from './reports-contract'

/** Mirrors web's getPriorFilters (SpendingByCategoryReport.tsx): the immediately preceding
 * period of the same length, used to compute a period-over-period trend delta. */
export function reportPriorPeriodFilters(filters: ReportFilters): ReportFilters {
  const from = new Date(filters.fromDate)
  const to = new Date(filters.toDate)
  const diffMs = to.getTime() - from.getTime()
  return {
    ...filters,
    fromDate: new Date(from.getTime() - diffMs).toISOString(),
    toDate: new Date(to.getTime() - diffMs).toISOString(),
  }
}
