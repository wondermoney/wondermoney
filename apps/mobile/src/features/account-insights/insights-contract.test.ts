import { cashflowResponseSchema, categorySpendingResponseSchema, createAccountMetricsEndpoint, createAggregateMetricsEndpoint, createCashflowEndpoint, createCategorySpendingEndpoint, metricsResponseSchema } from './insights-contract'
import { inTimeZone } from '@/test/time-zone'

import { cashflowFixture, categoryFixture, metricFixture } from './test-fixtures'

describe('account insight contracts', () => {
  const scope = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-20T12:00:00.000Z' }
  it('parses nullable finite metric fields and actual endpoints', () => {
    expect(metricsResponseSchema.parse({ metrics: [{ ...metricFixture, accountName: null, inflowCurrentPeriod: null }] }).metrics).toHaveLength(1)
    expect(createAggregateMetricsEndpoint(scope).path).toContain('/v1/account/metrics?fromDate=')
    expect(createAccountMetricsEndpoint(2, scope.fromDate).path).not.toContain('toDate')
  })
  it('keeps parsing when the API adds fields or a metric type this build does not know', () => {
    const [metric] = metricsResponseSchema.parse({ metrics: [{ ...metricFixture, type: 'transfer', averageBalance: 3 }], extra: 1 }).metrics
    expect(metric!.type).toBe('unknown')
    expect(metric).not.toHaveProperty('averageBalance')
    const [category] = categorySpendingResponseSchema.parse({ categorySpending: [{ ...categoryFixture, budget: 5, childCategories: categoryFixture.childCategories.map((child) => ({ ...child, budget: 5 })) }] }).categorySpending
    expect(category).not.toHaveProperty('budget')
    expect(cashflowResponseSchema.parse({ cashflow: [{ ...cashflowFixture, balance: 1 }] }).cashflow[0]).toEqual(cashflowFixture)
  })
  it('accepts signed cashflow and validates dates', () => {
    expect(cashflowResponseSchema.parse({ cashflow: [cashflowFixture] }).cashflow[0]?.amount).toBe(-42.5)
    expect(cashflowResponseSchema.safeParse({ cashflow: [{ ...cashflowFixture, date: 'July' }] }).success).toBe(false)
  })
  it('accepts synthetic category -1 and treats visual fields as inert strings', () => {
    expect(categorySpendingResponseSchema.parse({ categorySpending: [categoryFixture] }).categorySpending[0]?.categoryKey).toBe(-1)
    expect(createCategorySpendingEndpoint(scope, 5).path).toContain('limit=5')
  })
  it('reads which category spending was left out for want of an exchange rate', () => {
    const completeness = { currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 2, unconvertedCurrencies: ['USD'] }
    expect(categorySpendingResponseSchema.parse({ categorySpending: [], completeness }).completeness).toEqual(completeness)
    expect(categorySpendingResponseSchema.parse({ categorySpending: [] }).completeness).toBeUndefined()
  })
  it.each([
    { ...metricFixture, currencyCode: 'eur' },
    { ...metricFixture, inflowCurrentPeriod: Infinity },
    { ...metricFixture, transactionCountCurrentPeriod: -1 },
  ])('rejects malformed present metric values', (metric) => expect(metricsResponseSchema.safeParse({ metrics: [metric] }).success).toBe(false))

  describe.each(['America/New_York', 'Asia/Tokyo'])('for a viewer in %s', (zone) => {
    inTimeZone(zone)
    const query = (path: string) => new URLSearchParams(path.split('?')[1])

    it('sends the device time zone with every dated insight, so the API counts a bank booking on its own date', () => {
      expect(query(createAggregateMetricsEndpoint(scope).path).get('timezone')).toBe(zone)
      expect(query(createCashflowEndpoint(scope).path).get('timezone')).toBe(zone)
      expect(query(createCategorySpendingEndpoint(scope, 5).path).get('timezone')).toBe(zone)
      expect(query(createAccountMetricsEndpoint(2, scope.fromDate).path).get('timezone')).toBe(zone)
    })

    it('sends none when no start bounds the period, and keeps a bounded end', () => {
      expect(createAccountMetricsEndpoint(2).path).toBe('/v1/account/2/metrics')
      const bounded = createCashflowEndpoint({ toDate: scope.toDate }).path
      expect(query(bounded).get('fromDate')).toBeNull()
      expect(query(bounded).get('toDate')).toBe(String(Date.parse(scope.toDate)))
      expect(query(bounded).get('timezone')).toBe(zone)
    })
  })
})
