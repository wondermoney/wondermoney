import type { AccountMetricDto, CashflowDto, CategorySpendingDto } from './insights-contract'

export type MetricRow = Readonly<{
  accountId: number
  accountName: string | null
  currency: string | null
  inflow: number | null
  outflow: number | null
  transactionCount: number | null
}>
export type MetricGroup = Readonly<{ currency: string | null; rows: readonly MetricRow[] }>
export type CategoryRow = Readonly<{ id: number; name: string; amount: number; currency: string | null; transactionCount: number }>
export type CashflowRow = Readonly<{ date: string; amount: number; currency: string | null }>

export function mapMetricGroups(metrics: readonly AccountMetricDto[]): MetricGroup[] {
  const groups = new Map<string, MetricRow[]>()
  for (const metric of metrics) {
    const key = metric.currencyCode ?? '__unavailable__'
    const rows = groups.get(key) ?? []
    rows.push({ accountId: metric.accountKey, accountName: metric.accountName ?? null, currency: metric.currencyCode ?? null, inflow: metric.inflowCurrentPeriod ?? null, outflow: metric.outflowCurrentPeriod ?? null, transactionCount: metric.transactionCountCurrentPeriod ?? null })
    groups.set(key, rows)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, rows]) => ({ currency: currency === '__unavailable__' ? null : currency, rows }))
}

export function mapCategorySpending(rows: readonly CategorySpendingDto[], topN = 5): CategoryRow[] {
  return rows.slice(0, Math.max(0, topN)).map((row) => ({ id: row.categoryKey, name: row.name, amount: row.amount, currency: row.currency ?? null, transactionCount: row.numTransactions }))
}

export function mapCashflow(rows: readonly CashflowDto[], reportingCurrency: string | null): CashflowRow[] {
  return rows.map((row) => ({ date: row.date, amount: row.amount, currency: reportingCurrency }))
}

export function safeReportingCurrency(currencies: readonly (string | null)[]): string | null {
  const valid = new Set(currencies.filter((code): code is string => typeof code === 'string' && /^[A-Z]{3}$/.test(code)))
  return valid.size === 1 ? [...valid][0]! : null
}
