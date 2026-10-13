import {
  budgetVsActualResponseSchema,
  createBudgetVsActualEndpoint,
  createCashflowEndpoint,
  createNetWorthHistoryReportEndpoint,
  createPortfolioPerformanceReportEndpoint,
  createReportCsvEndpoint,
  createSankeyEndpoint,
  createSpendingByCategoryEndpoint,
  type ReportFilters,
} from './reports-contract'

const baseFilters: ReportFilters = {
  fromDate: '2026-05-01T00:00:00.000Z',
  toDate: '2026-08-01T00:00:00.000Z',
}

const budgetVsActualFixture = {
  data: [
    { categoryKey: 'groceries', name: 'Groceries', color: '#22c55e', budgeted: 400, actual: 320.5, variance: 79.5, percentUsed: 80.125 },
  ],
  generatedAt: '2026-08-11T00:00:00.000Z',
  filters: { fromDate: baseFilters.fromDate, toDate: baseFilters.toDate },
}

describe('reports contract', () => {
  it('builds the from/to query for the minimal filter set', () => {
    const endpoint = createBudgetVsActualEndpoint(baseFilters)
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe(
      `/v1/reports/budget-vs-actual?fromDate=${encodeURIComponent(baseFilters.fromDate)}&toDate=${encodeURIComponent(baseFilters.toDate)}`,
    )
  })

  it('serializes array filters as comma-joined values and omits empty ones', () => {
    const endpoint = createCashflowEndpoint({
      ...baseFilters,
      accountKeys: ['acc-1', 'acc-2'],
      categoryKeys: [],
      merchantKeys: ['Amazon'],
      currencyKey: 'EUR',
      includePending: true,
      includeTransfers: false,
    })
    const query = new URLSearchParams(endpoint.path.split('?')[1])
    expect(query.get('accountKeys')).toBe('acc-1,acc-2')
    expect(query.has('categoryKeys')).toBe(false)
    expect(query.get('merchantKeys')).toBe('Amazon')
    expect(query.get('currencyKey')).toBe('EUR')
    expect(query.get('includePending')).toBe('true')
    expect(query.has('includeTransfers')).toBe(false)
  })

  it.each([
    ['spending-by-category', createSpendingByCategoryEndpoint],
    ['cashflow', createCashflowEndpoint],
    ['sankey', createSankeyEndpoint],
    ['net-worth-history', createNetWorthHistoryReportEndpoint],
    ['budget-vs-actual', createBudgetVsActualEndpoint],
    ['portfolio-performance', createPortfolioPerformanceReportEndpoint],
  ] as const)('points %s at its own endpoint path', (segment, createEndpoint) => {
    const endpoint = createEndpoint(baseFilters)
    expect(endpoint.path.startsWith(`/v1/reports/${segment}?`)).toBe(true)
  })

  it('parses the report envelope and pins the budget-vs-actual fixture', () => {
    expect(budgetVsActualResponseSchema.parse(budgetVsActualFixture)).toEqual(budgetVsActualFixture)
  })

  it('rejects a row missing required numeric fields', () => {
    expect(budgetVsActualResponseSchema.safeParse({
      ...budgetVsActualFixture,
      data: [{ categoryKey: 'groceries', name: 'Groceries', color: '#22c55e' }],
    }).success).toBe(false)
  })

  it.each([
    'spending-by-category', 'cashflow', 'sankey', 'net-worth-history', 'budget-vs-actual', 'portfolio-performance',
  ] as const)('builds the %s.csv endpoint with the same filter query as the JSON endpoint', (slug) => {
    const endpoint = createReportCsvEndpoint(slug, { ...baseFilters, accountKeys: ['acc-1'] })
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path.startsWith(`/v1/reports/${slug}.csv?`)).toBe(true)
    const query = new URLSearchParams(endpoint.path.split('?')[1])
    expect(query.get('accountKeys')).toBe('acc-1')
  })
})
