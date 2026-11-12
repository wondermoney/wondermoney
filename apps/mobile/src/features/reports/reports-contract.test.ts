import {
  budgetVsActualResponseSchema,
  createBudgetVsActualEndpoint,
  createCashflowEndpoint,
  createMonthComparisonEndpoint,
  createNetWorthHistoryReportEndpoint,
  createPortfolioPerformanceReportEndpoint,
  portfolioPerformanceReportRowSchema,
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

  it('sends the viewer\'s time zone when the filters state one', () => {
    const query = new URLSearchParams(createCashflowEndpoint({ ...baseFilters, timezone: 'Asia/Tokyo' }).path.split('?')[1])
    expect(query.get('timezone')).toBe('Asia/Tokyo')
  })

  it.each([
    ['spending-by-category', createSpendingByCategoryEndpoint],
    ['cashflow', createCashflowEndpoint],
    ['month-comparison', createMonthComparisonEndpoint],
    ['sankey', createSankeyEndpoint],
    ['net-worth-history', createNetWorthHistoryReportEndpoint],
    ['budget-vs-actual', createBudgetVsActualEndpoint],
    ['portfolio-performance', createPortfolioPerformanceReportEndpoint],
  ] as const)('points %s at its own endpoint path', (segment, createEndpoint) => {
    const endpoint = createEndpoint(baseFilters)
    expect(endpoint.path.startsWith(`/v1/reports/${segment}?`)).toBe(true)
  })

  it('sends the two months the comparison asks for', () => {
    const query = new URLSearchParams(createMonthComparisonEndpoint({ ...baseFilters, base: '2026-08', compare: '2026-07' }).path.split('?')[1])
    expect(query.get('base')).toBe('2026-08')
    expect(query.get('compare')).toBe('2026-07')
  })

  it('parses the report envelope and pins the budget-vs-actual fixture', () => {
    expect(budgetVsActualResponseSchema.parse(budgetVsActualFixture)).toEqual(budgetVsActualFixture)
  })

  it('strips fields the API adds and reads a sankey node kind this build does not know as unknown', () => {
    expect(budgetVsActualResponseSchema.parse({
      ...budgetVsActualFixture,
      data: [{ ...budgetVsActualFixture.data[0], forecast: 1 }],
      currency: 'EUR',
    })).toEqual(budgetVsActualFixture)
    const sankey = createSankeyEndpoint(baseFilters).schema.parse({
      data: { nodes: [{ id: 'n1', label: 'Savings', kind: 'savings', depth: 2 }], links: [{ source: 'n1', target: 'n1', value: 1, color: 'red' }] },
      generatedAt: '2026-08-11T00:00:00.000Z',
      filters: {},
    })
    expect(sankey.data.nodes[0]).toEqual({ id: 'n1', label: 'Savings', kind: 'unknown' })
    expect(sankey.data.links[0]).toEqual({ source: 'n1', target: 'n1', value: 1 })
  })

  it('rejects a row missing required numeric fields', () => {
    expect(budgetVsActualResponseSchema.safeParse({
      ...budgetVsActualFixture,
      data: [{ categoryKey: 'groceries', name: 'Groceries', color: '#22c55e' }],
    }).success).toBe(false)
  })

  it('sends only the period for portfolio performance, as JSON and as CSV: account and transaction filters do not apply to portfolios', () => {
    const filters = { ...baseFilters, accountKeys: ['acc-1'], includePending: true }
    for (const path of [createPortfolioPerformanceReportEndpoint(filters).path, createReportCsvEndpoint('portfolio-performance', filters).path]) {
      const query = new URLSearchParams(path.split('?')[1])
      expect([...query.keys()].sort()).toEqual(['fromDate', 'toDate'])
    }
  })

  it('reads each portfolio\'s time- and money-weighted returns, and still parses rows from APIs that send none', () => {
    const row = { portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: 1000, netContributions: 0, change: 100, changePercent: 10, dividends: 0, endValue: 1100 }
    const returns = { timeWeightedReturn: 9.87, moneyWeightedReturn: null, moneyWeightedReturnAnnualized: false, missingSnapshotDates: ['2026-06-01'] }
    expect(portfolioPerformanceReportRowSchema.parse({ ...row, ...returns })).toEqual({ ...row, ...returns })
    const older = portfolioPerformanceReportRowSchema.parse(row)
    expect(older).toEqual(row)
    expect(older.timeWeightedReturn).toBeUndefined()
    expect(portfolioPerformanceReportRowSchema.safeParse({ ...row, timeWeightedReturn: 'n/a' }).success).toBe(false)
  })

  it.each([
    'spending-by-category', 'cashflow', 'sankey', 'net-worth-history', 'budget-vs-actual',
  ] as const)('builds the %s.csv endpoint with the same filter query as the JSON endpoint', (slug) => {
    const endpoint = createReportCsvEndpoint(slug, { ...baseFilters, accountKeys: ['acc-1'] })
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path.startsWith(`/v1/reports/${slug}.csv?`)).toBe(true)
    const query = new URLSearchParams(endpoint.path.split('?')[1])
    expect(query.get('accountKeys')).toBe('acc-1')
  })
})
