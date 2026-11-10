import { z } from 'zod'

import type { RawReadEndpoint } from '../../lib/api/client'
import { readEndpoint, tolerantEnum } from '../../lib/api/runtime-schema'

/**
 * Mirrors web's ReportFilters (components/reports/filters/useReportFilters.ts) and the API's
 * reportFiltersSchema (api/src/validators/reports.ts). fromDate/toDate are ISO datetime strings
 * with offset; every other filter is optional and defaults server-side.
 */
export type ReportFilters = Readonly<{
  fromDate: string
  toDate: string
  accountKeys?: readonly string[]
  categoryKeys?: readonly string[]
  merchantKeys?: readonly string[]
  currencyKey?: string
  includePending?: boolean
  includeTransfers?: boolean
  /** IANA time zone the period's days and months are in; the API's default when absent. */
  timezone?: string
}>

function reportQuery(filters: ReportFilters): string {
  const params = new URLSearchParams()
  params.set('fromDate', filters.fromDate)
  params.set('toDate', filters.toDate)
  if (filters.accountKeys?.length) params.set('accountKeys', filters.accountKeys.join(','))
  if (filters.categoryKeys?.length) params.set('categoryKeys', filters.categoryKeys.join(','))
  if (filters.merchantKeys?.length) params.set('merchantKeys', filters.merchantKeys.join(','))
  if (filters.currencyKey !== undefined) params.set('currencyKey', filters.currencyKey)
  if (filters.includePending) params.set('includePending', 'true')
  if (filters.includeTransfers) params.set('includeTransfers', 'true')
  if (filters.timezone) params.set('timezone', filters.timezone)
  return params.toString()
}

const reportFiltersEchoSchema = z.object({
  accountKeys: z.array(z.string()).optional(),
  categoryKeys: z.array(z.string()).optional(),
  currencyKey: z.string().optional(),
  fromDate: z.string().optional(),
  includePending: z.boolean().optional(),
  includeTransfers: z.boolean().optional(),
  merchantKeys: z.array(z.string()).optional(),
  toDate: z.string().optional(),
})

function reportResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    generatedAt: z.string(),
    filters: reportFiltersEchoSchema,
  })
}

export const spendingByCategoryRowSchema = z.object({
  categoryKey: z.string(),
  parentKey: z.string().nullable(),
  name: z.string(),
  color: z.string(),
  totalAmount: z.number().finite(),
  transactionCount: z.number().int().nonnegative(),
  percentOfTotal: z.number().finite(),
})

const spendingByCategoryResponseSchema = reportResponseSchema(z.array(spendingByCategoryRowSchema))
export type SpendingByCategoryRow = z.infer<typeof spendingByCategoryRowSchema>

export const cashflowPointSchema = z.object({
  month: z.string(),
  income: z.number().finite(),
  expenses: z.number().finite(),
  net: z.number().finite(),
})

const cashflowResponseSchema = reportResponseSchema(z.array(cashflowPointSchema))
export type CashflowPoint = z.infer<typeof cashflowPointSchema>

const sankeyNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  // Only 'income' changes how a node is used; a kind this build doesn't know reads as 'unknown'.
  kind: tolerantEnum(['income', 'expense', 'account'], 'unknown'),
  color: z.string().optional(),
  value: z.number().finite().optional(),
})

const sankeyLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  value: z.number().finite(),
})

export const sankeyDataSchema = z.object({
  nodes: z.array(sankeyNodeSchema),
  links: z.array(sankeyLinkSchema),
})

const sankeyResponseSchema = reportResponseSchema(sankeyDataSchema)
export type SankeyData = z.infer<typeof sankeyDataSchema>

export const reportNetWorthPointSchema = z.object({
  date: z.string(),
  netWorth: z.number().finite(),
  breakdown: z.object({
    assets: z.number().finite(),
    liabilities: z.number().finite(),
  }),
})

const netWorthHistoryReportResponseSchema = reportResponseSchema(z.array(reportNetWorthPointSchema))
export type ReportNetWorthPoint = z.infer<typeof reportNetWorthPointSchema>

export const budgetVsActualRowSchema = z.object({
  categoryKey: z.string(),
  name: z.string(),
  color: z.string(),
  budgeted: z.number().finite(),
  actual: z.number().finite(),
  variance: z.number().finite(),
  percentUsed: z.number().finite(),
})

// The report names the currency its amounts are in: the budget's, which need not be the viewer's.
export const budgetVsActualResponseSchema = reportResponseSchema(z.array(budgetVsActualRowSchema)).extend({
  completeness: z.object({ currencyCode: z.string() }).optional(),
})
export type BudgetVsActualRow = z.infer<typeof budgetVsActualRowSchema>

/**
 * One household portfolio over the period, every amount in the appuser currency. A value the API
 * cannot know (no snapshot, or a trade or dividend with no exchange rate) is null, and so is anything
 * derived from it: change = endValue - startValue - netContributions.
 */
export const portfolioPerformanceReportRowSchema = z.object({
  portfolioKey: z.string(),
  name: z.string(),
  currency: z.string(),
  startValue: z.number().finite().nullable(),
  netContributions: z.number().finite().nullable(),
  change: z.number().finite().nullable(),
  changePercent: z.number().finite().nullable(),
  dividends: z.number().finite().nullable(),
  endValue: z.number().finite().nullable(),
})

const portfolioPerformanceReportResponseSchema = reportResponseSchema(z.array(portfolioPerformanceReportRowSchema))
export type PortfolioPerformanceReportRow = z.infer<typeof portfolioPerformanceReportRowSchema>

export function createSpendingByCategoryEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/spending-by-category?${reportQuery(filters)}`,
    schema: spendingByCategoryResponseSchema,
  })
}

export function createCashflowEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/cashflow?${reportQuery(filters)}`,
    schema: cashflowResponseSchema,
  })
}

export function createSankeyEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/sankey?${reportQuery(filters)}`,
    schema: sankeyResponseSchema,
  })
}

export function createNetWorthHistoryReportEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/net-worth-history?${reportQuery(filters)}`,
    schema: netWorthHistoryReportResponseSchema,
  })
}

export function createBudgetVsActualEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/budget-vs-actual?${reportQuery(filters)}`,
    schema: budgetVsActualResponseSchema,
  })
}

/**
 * The portfolio report covers every household portfolio over the period: account, category,
 * merchant and transaction filters don't apply to it, so only the period is sent.
 */
export function portfolioPerformanceFilters(filters: ReportFilters): ReportFilters {
  return { fromDate: filters.fromDate, toDate: filters.toDate }
}

export function createPortfolioPerformanceReportEndpoint(filters: ReportFilters) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/reports/portfolio-performance?${reportQuery(portfolioPerformanceFilters(filters))}`,
    schema: portfolioPerformanceReportResponseSchema,
  })
}

export type ReportSlug = 'spending-by-category' | 'cashflow' | 'sankey' | 'net-worth-history' | 'budget-vs-actual' | 'portfolio-performance'

/** Mirrors the API's dedicated `<report>.csv` routes (api/src/routes/v1/reports.ts) — same filter
 * query params, server-generated CSV body. Not a schema-validated JSON endpoint, so it's built for
 * apiClient.readRaw rather than .read. */
export function createReportCsvEndpoint(slug: ReportSlug, filters: ReportFilters): RawReadEndpoint {
  const scoped = slug === 'portfolio-performance' ? portfolioPerformanceFilters(filters) : filters
  return { method: 'GET', path: `/v1/reports/${slug}.csv?${reportQuery(scoped)}` }
}
