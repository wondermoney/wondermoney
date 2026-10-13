import { mapCashflow, mapCategorySpending, mapMetricGroups, safeReportingCurrency } from './insights-view-model'
import { cashflowFixture, categoryFixture, metricFixture } from './test-fixtures'

describe('account insight view models', () => {
  it('groups per-account rows without summing mixed currencies', () => {
    const groups = mapMetricGroups([metricFixture, { ...metricFixture, accountKey: 2, accountName: 'Dollar', currencyCode: 'USD', inflowCurrentPeriod: 50 }])
    expect(groups.map((group) => [group.currency, group.rows.length])).toEqual([['EUR', 1], ['USD', 1]])
    expect(groups[1]?.rows[0]?.inflow).toBe(50)
  })
  it('bounds top-N and preserves synthetic category semantics without colors', () => {
    const rows = mapCategorySpending(Array.from({ length: 8 }, (_, index) => ({ ...categoryFixture, categoryKey: index === 0 ? -1 : index, name: `Category ${index}`, amount: 100 - index })), 5)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ id: -1, name: 'Category 0', amount: 100, currency: 'EUR', transactionCount: 4 })
  })
  it('uses reporting currency only when one separately validated code is safe', () => {
    expect(safeReportingCurrency(['EUR', 'EUR'])).toBe('EUR')
    expect(safeReportingCurrency(['EUR', 'USD'])).toBeNull()
    expect(mapCashflow([cashflowFixture], null)[0]).toEqual({ ...cashflowFixture, currency: null })
  })
})
