import type { DateScope, InsightPeriod } from './insights-contract'

export function createInsightDateScope(period: InsightPeriod, now = new Date()): DateScope {
  const to = new Date(now)
  const from = new Date(now)
  if (period === 'month') from.setDate(1)
  else from.setDate(from.getDate() - (period === '30-days' ? 30 : 90))
  from.setHours(0, 0, 0, 0)
  return { fromDate: from.toISOString(), toDate: to.toISOString() }
}
