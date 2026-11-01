import { cashflowResponseSchema, categorySpendingResponseSchema, createAccountMetricsEndpoint, createAggregateMetricsEndpoint, createCategorySpendingEndpoint, metricsResponseSchema } from './insights-contract'
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
  it.each([
    { ...metricFixture, currencyCode: 'eur' },
    { ...metricFixture, inflowCurrentPeriod: Infinity },
    { ...metricFixture, transactionCountCurrentPeriod: -1 },
  ])('rejects malformed present metric values', (metric) => expect(metricsResponseSchema.safeParse({ metrics: [metric] }).success).toBe(false))
})
