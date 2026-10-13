import { cashflowResponseSchema, categorySpendingResponseSchema, createAccountMetricsEndpoint, createAggregateMetricsEndpoint, createCategorySpendingEndpoint, metricsResponseSchema } from './insights-contract'
import { cashflowFixture, categoryFixture, metricFixture } from './test-fixtures'

describe('account insight contracts', () => {
  const scope = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-20T12:00:00.000Z' }
  it('parses nullable finite metric fields and actual endpoints', () => {
    expect(metricsResponseSchema.parse({ metrics: [{ ...metricFixture, accountName: null, inflowCurrentPeriod: null }] }).metrics).toHaveLength(1)
    expect(createAggregateMetricsEndpoint(scope).path).toContain('/v1/account/metrics?fromDate=')
    expect(createAccountMetricsEndpoint(2, scope.fromDate).path).not.toContain('toDate')
  })
  it('accepts signed cashflow and validates dates', () => {
    expect(cashflowResponseSchema.parse({ cashflow: [cashflowFixture] }).cashflow[0]?.amount).toBe(-42.5)
    expect(cashflowResponseSchema.safeParse({ cashflow: [{ ...cashflowFixture, date: 'July' }] }).success).toBe(false)
  })
  it('accepts synthetic category -1 and treats visual fields as inert strings', () => {
    expect(categorySpendingResponseSchema.parse({ categorySpending: [categoryFixture] }).categorySpending[0]?.categoryKey).toBe(-1)
    expect(createCategorySpendingEndpoint(scope, 5).path).toContain('limit=5')
  })
  it.each([
    { ...metricFixture, currencyCode: 'eur' },
    { ...metricFixture, inflowCurrentPeriod: Infinity },
    { ...metricFixture, transactionCountCurrentPeriod: -1 },
  ])('rejects malformed present metric values', (metric) => expect(metricsResponseSchema.safeParse({ metrics: [metric] }).success).toBe(false))
})
