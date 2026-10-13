import { createInsightDateScope } from './date-scope'
import { accountMetricsKey, aggregateMetricsKey, cashflowKey, categorySpendingKey } from './query-keys'

describe('account insight keys and dates', () => {
  it('isolates epoch, account, scope, resource, and top-N limit', () => {
    const scope = createInsightDateScope('30-days', new Date('2026-07-20T12:00:00.000Z'))
    expect(aggregateMetricsKey(1, scope)).not.toEqual(aggregateMetricsKey(2, scope))
    expect(cashflowKey(1, scope)).not.toEqual(aggregateMetricsKey(1, scope))
    expect(categorySpendingKey(1, scope, 5)).not.toEqual(categorySpendingKey(1, scope, 10))
    expect(accountMetricsKey(1, 2, scope.fromDate)).not.toEqual(accountMetricsKey(1, 3, scope.fromDate))
  })
  it('creates bounded month, 30 and 90 day scopes', () => {
    const now = new Date('2026-07-20T12:00:00.000Z')
    const month = new Date(createInsightDateScope('month', now).fromDate)
    const thirty = new Date(createInsightDateScope('30-days', now).fromDate)
    const ninety = new Date(createInsightDateScope('90-days', now).fromDate)
    expect([month.getDate(), month.getHours()]).toEqual([1, 0])
    expect([thirty.getMonth(), thirty.getDate(), thirty.getHours()]).toEqual([5, 20, 0])
    expect([ninety.getMonth(), ninety.getDate(), ninety.getHours()]).toEqual([3, 21, 0])
  })
})
