import { createInsightsEndpoint, insightsResponseSchema } from './insights-contract'

const spending = {
  facts: {
    baselineAmount: '100',
    categoryKey: 9,
    categoryKeys: [10, 11],
    categoryName: 'Food',
    currency: 'EUR',
    currentAmount: '150',
    daysElapsed: 10,
    deviationPercent: '50.00',
    direction: 'above',
    fromDate: '2026-11-01T00:00:00.000Z',
    toDate: '2026-11-10T12:00:00.000Z',
  },
  id: 'spending-1',
  period: '2026-11',
  severity: 'warning',
  type: 'spending_vs_normal',
}

const budget = {
  facts: {
    amountBudgeted: '250',
    amountSpent: '100',
    budgetKey: 4,
    budgetName: 'Plan',
    budgetTemplateCategoryKey: 2,
    categoryKey: 10,
    categoryName: 'Groceries',
    currencyCode: 'EUR',
    daysElapsed: 10,
    daysInMonth: 30,
    elapsedPercent: '33.33',
    overBy: '50',
    parentCategoryName: 'Food',
    projectedAmount: '300',
  },
  id: 'budget-1',
  period: '2026-11',
  severity: 'critical',
  type: 'budget_pace',
}

describe('insights contract', () => {
  it('parses both insight types', () => {
    expect(insightsResponseSchema.parse({ insights: [spending, budget] })).toEqual({ insights: [spending, budget] })
  })

  it('rejects an unknown insight type', () => {
    expect(insightsResponseSchema.safeParse({ insights: [{ ...spending, type: 'other' }] }).success).toBe(false)
  })

  it('asks for the current month when none is given', () => {
    expect(createInsightsEndpoint().path).toBe('/v1/insights')
  })

  it('asks for a named month', () => {
    expect(createInsightsEndpoint('2026-08').path).toBe('/v1/insights?month=2026-08')
  })
})
