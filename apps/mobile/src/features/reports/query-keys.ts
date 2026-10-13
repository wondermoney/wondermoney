import type { ReportFilters } from './reports-contract'

const filtersTuple = (filters: ReportFilters) => [
  filters.fromDate,
  filters.toDate,
  filters.accountKeys?.join(',') ?? null,
  filters.categoryKeys?.join(',') ?? null,
  filters.merchantKeys?.join(',') ?? null,
  filters.currencyKey ?? null,
  filters.includePending ?? false,
  filters.includeTransfers ?? false,
] as const

export const budgetVsActualReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'budget-vs-actual', ...filtersTuple(filters)] as const
)

export const portfolioPerformanceReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'portfolio-performance', ...filtersTuple(filters)] as const
)

export const netWorthHistoryReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'net-worth-history', ...filtersTuple(filters)] as const
)

export const spendingByCategoryReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'spending-by-category', ...filtersTuple(filters)] as const
)

export const cashflowReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'cashflow', ...filtersTuple(filters)] as const
)

export const sankeyReportKey = (epochId: number, filters: ReportFilters) => (
  ['reports', epochId, 'sankey', ...filtersTuple(filters)] as const
)
