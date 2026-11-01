import {
  aggregateDashboardResponseSchema,
  createCreatePortfolioTransactionEndpoint,
  createDeletePortfolioTransactionEndpoint,
  createEditPortfolioTransactionEndpoint,
  createPortfolioDashboardEndpoint,
  createPortfolioDividendIncomeEndpoint,
  createPortfolioEndpoint,
  createPortfolioHoldingsEndpoint,
  createPortfolioActivityEndpoint,
  createPortfolioSettingsEndpoint,
  createPortfolioTransactionResponseSchema,
  createPortfolioWriteEndpoint,
  freezePortfolioTransactionCreate,
  freezePortfolioTransactionEdit,
  isManuallyCreatableTransactionType,
  parsePortfolioId,
  parsePortfolioActivityFilters,
  portfolioActivityResponseSchema,
  portfolioAllocationResponseSchema,
  portfolioDividendIncomeResponseSchema,
  portfolioMetricsResponseSchema,
  portfolioHoldingsResponseSchema,
  portfolioCreateWriteSchema,
  portfolioCurrenciesEndpoint,
  portfolioCurrenciesResponseSchema,
  portfolioSettingsWriteSchema,
  portfolioSettingsResponseSchema,
  portfolioTargetAllocationsEqual,
  portfolioTransactionTypesEndpoint,
  portfolioTransactionTypesResponseSchema,
  PORTFOLIO_ALLOCATION_PRESETS,
  createPortfolioPerformanceEndpoint,
  portfolioPerformanceResponseSchema,
} from './portfolios-contract'

const invalidHolding = {
  allocation: null,
  averageBuyPrice: 0,
  currency: 'EUR',
  currentPrice: null,
  currentValue: null,
  financialAssetKey: 8,
  financialAssetName: 'Example asset',
  financialAssetSymbol: 'EXM',
  financialAssetType: 'Stock',
  invalidReason: 'NEGATIVE_UNITS',
  isInvalid: true,
  quantity: -2,
  relatedTransactionKeys: [4],
  unrealizedGains: null,
  unrealizedGainsPercentage: null,
}

describe('portfolio endpoint contracts', () => {
  it('uses the five exact read paths and fixed YTD query', () => {
    expect(createPortfolioEndpoint(7).path).toBe('/v1/portfolio/7')
    expect(createPortfolioDashboardEndpoint(7).path).toBe('/v1/portfolio/7/dashboard?period=YTD&include=feeConversion')
    expect(createPortfolioHoldingsEndpoint(7).path).toBe('/v1/portfolio/7/holdings')
    expect(createPortfolioDividendIncomeEndpoint(7).path).toBe('/v1/portfolio/7/dividend-income')
    expect(() => createPortfolioDividendIncomeEndpoint(0)).toThrow()
    expect(parsePortfolioId('7')).toBe(7)
    expect(parsePortfolioId('0')).toBeNull()
    expect(parsePortfolioId(['7'])).toBeNull()
  })

  it('keeps create and settings writes strict and non-destructive', () => {
    expect(portfolioCurrenciesEndpoint).toMatchObject({ method: 'GET', path: '/v1/account/currencies' })
    expect(createPortfolioWriteEndpoint).toMatchObject({ method: 'POST', path: '/v1/portfolio', successStatuses: [201] })
    expect(createPortfolioSettingsEndpoint(7)).toMatchObject({ method: 'PUT', path: '/v1/portfolio/7', successStatuses: [200] })
    expect(portfolioCreateWriteSchema.parse({ name: '  Long term  ', currencyId: 151 })).toEqual({ name: 'Long term', currencyId: 151 })
    expect(portfolioCreateWriteSchema.safeParse({ name: ' ', currencyId: 151 }).success).toBe(false)
    expect(portfolioCreateWriteSchema.safeParse({ name: 'x'.repeat(256), currencyId: 151 }).success).toBe(false)
    expect(portfolioCreateWriteSchema.safeParse({ name: 'Fund', currencyId: 0 }).success).toBe(false)
    expect(portfolioCurrenciesResponseSchema.safeParse({ currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] }).success).toBe(true)
    expect(portfolioCurrenciesResponseSchema.parse({ currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro', broker: true }] })).toEqual({ currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }] })
    expect(portfolioSettingsWriteSchema.parse({ name: '  Renamed ', description: null })).toEqual({ name: 'Renamed', description: null })
    expect(portfolioSettingsWriteSchema.parse({ benchmarkSymbol: '  SPY  ' })).toEqual({ benchmarkSymbol: 'SPY' })
    expect(portfolioSettingsWriteSchema.parse({ excluded: true })).toEqual({ excluded: true })
    expect(portfolioSettingsWriteSchema.parse({ favored: true })).toEqual({ favored: true })
    expect(portfolioSettingsResponseSchema.parse({ portfolio: { portfolioKey: 7, name: 'Renamed', description: null, currencyKey: { code: 'EUR' }, benchmarkSymbol: 'SPY', excluded: false, favored: true, targetAllocation: { STOCK: 80 } } })).toEqual({ portfolio: { portfolioKey: 7, name: 'Renamed', description: null, currencyKey: { code: 'EUR' }, benchmarkSymbol: 'SPY', excluded: false, favored: true, targetAllocation: { STOCK: 80 } } })
    for (const body of [{}, { currencyId: 151 }, { targetAllocation: {} }, { benchmarkSymbol: 'x'.repeat(21) }]) expect(portfolioSettingsWriteSchema.safeParse(body).success).toBe(false)
  })

  it('validates target allocation writes against the fixed asset-class set', () => {
    expect(portfolioSettingsWriteSchema.parse({ targetAllocation: { 'Equities': 60, 'Fixed Income': 40 } })).toEqual({ targetAllocation: { 'Equities': 60, 'Fixed Income': 40 } })
    expect(portfolioSettingsWriteSchema.parse({ targetAllocation: null })).toEqual({ targetAllocation: null })
    expect(portfolioSettingsWriteSchema.safeParse({ targetAllocation: { 'Real Estate': 100 } }).success).toBe(false)
    expect(portfolioSettingsWriteSchema.safeParse({ targetAllocation: { 'Equities': -1 } }).success).toBe(false)
    expect(PORTFOLIO_ALLOCATION_PRESETS.balanced).toEqual({ 'Equities': 60, 'Fixed Income': 30, 'Cash & Equivalents': 10 })
    for (const preset of Object.values(PORTFOLIO_ALLOCATION_PRESETS)) expect(portfolioSettingsWriteSchema.safeParse({ targetAllocation: preset }).success).toBe(true)
  })

  it('builds the individual performance path with the given period, defaulting to YTD', () => {
    expect(createPortfolioPerformanceEndpoint(7, '1M')).toMatchObject({ method: 'GET', path: '/v1/portfolio/7/performance?period=1M' })
    expect(createPortfolioPerformanceEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/portfolio/7/performance?period=YTD' })
    expect(() => createPortfolioPerformanceEndpoint(0, 'YTD')).toThrow()
  })

  it('parses a full performance response and strips fields the API adds', () => {
    const response = {
      dataPoints: [{ date: '2026-07-01', value: 1000 }],
      normalizedDataPoints: [{ date: '2026-07-01', value: 0 }],
      benchmarkDataPoints: [{ date: '2026-07-01', value: 500 }],
      normalizedBenchmarkDataPoints: [{ date: '2026-07-01', value: 0 }],
      benchmarkSymbol: 'SPY',
      benchmarkStatus: 'ready',
      portfolioHistoryStatus: 'ready',
      minDataPointsForComparison: 2,
      period: 'YTD',
      readiness: { performance: { status: 'ready' }, benchmark: { status: 'ready' } },
    }
    expect(portfolioPerformanceResponseSchema.parse(response)).toEqual(response)
    expect(portfolioPerformanceResponseSchema.safeParse({ dataPoints: [], minDataPointsForComparison: 2, period: 'YTD' }).success).toBe(true)
    expect(portfolioPerformanceResponseSchema.parse({ ...response, extra: true })).toEqual(response)
    const unknownStatuses = portfolioPerformanceResponseSchema.parse({ ...response, benchmarkStatus: 'rebasing', portfolioHistoryStatus: 'backfilling' })
    expect(unknownStatuses).toMatchObject({ benchmarkStatus: 'unknown', portfolioHistoryStatus: null })
    expect(portfolioPerformanceResponseSchema.safeParse({ ...response, dataPoints: [{ date: '2026/07/01', value: 1000 }] }).success).toBe(false)
  })

  it('compares target allocations by asset-class membership and percentage, not key order', () => {
    expect(portfolioTargetAllocationsEqual(null, null)).toBe(true)
    expect(portfolioTargetAllocationsEqual(null, { 'Equities': 100 })).toBe(false)
    expect(portfolioTargetAllocationsEqual({ 'Equities': 60, 'Fixed Income': 40 }, { 'Fixed Income': 40, 'Equities': 60 })).toBe(true)
    expect(portfolioTargetAllocationsEqual({ 'Equities': 60 }, { 'Equities': 60, 'Fixed Income': 40 })).toBe(false)
    expect(portfolioTargetAllocationsEqual({ 'Equities': 60 }, { 'Equities': 61 })).toBe(false)
  })

  it('accepts invalid holdings only with explicit null valuations', () => {
    expect(portfolioHoldingsResponseSchema.parse({ holdings: [invalidHolding] }).holdings[0]?.isInvalid).toBe(true)
    expect(portfolioHoldingsResponseSchema.safeParse({ holdings: [{ ...invalidHolding, currentValue: 0 }] }).success).toBe(false)
    expect(portfolioHoldingsResponseSchema.safeParse({ holdings: [{ ...invalidHolding, unrealizedGains: 0 }] }).success).toBe(false)
  })

  it('keeps parsing holdings when the API adds fields or an invalid reason this build does not know', () => {
    const parsed = portfolioHoldingsResponseSchema.parse({ holdings: [{ ...invalidHolding, invalidReason: 'MISSING_PRICE', sector: 'Tech' }] }).holdings[0]
    expect(parsed).toMatchObject({ isInvalid: true, invalidReason: 'MISSING_PRICE' })
    expect(parsed).not.toHaveProperty('sector')
  })

  it('reads an activity item type this build does not know as a transaction row', () => {
    const parsed = portfolioActivityResponseSchema.parse({ transactions: [{ itemType: 'CORPORATE_ACTION', transactionKey: 9, transactionDate: '2026-07-18T00:00:00.000Z', extra: 1 }] }).transactions[0]
    expect(parsed).toMatchObject({ itemType: 'TRANSACTION', transactionKey: 9 })
    expect(parsed).not.toHaveProperty('extra')
  })

  it('accepts a holding flagged for a fee that could not be converted', () => {
    const flagged = { ...invalidHolding, feeConversionIncomplete: true }
    expect(portfolioHoldingsResponseSchema.parse({ holdings: [flagged] }).holdings[0]?.feeConversionIncomplete).toBe(true)
    expect(portfolioHoldingsResponseSchema.parse({ holdings: [invalidHolding] }).holdings[0]?.feeConversionIncomplete).toBeUndefined()
  })

  it('strips fields the API adds and rejects ratio-shaped period labels', () => {
    const summary = { assetCount: 1, currency: 'EUR', lastUpdated: '2026-07-19T10:00:00.000Z', periodLabel: 'YTD', periodReturn: 12.4, portfolioCount: 1, realizedGains: 0, totalGainLoss: 4, totalGainLossPercent: 2, totalValue: 204, unrealizedGains: 4 }
    expect(aggregateDashboardResponseSchema.safeParse({ portfolios: [], summary }).success).toBe(true)
    expect(aggregateDashboardResponseSchema.parse({ portfolios: [], summary: { ...summary, extra: true } }).summary).toEqual(summary)
    expect(aggregateDashboardResponseSchema.safeParse({ portfolios: [], summary: { ...summary, periodLabel: 'ALL' } }).success).toBe(false)
  })

  it('normalizes normal transaction numbers and decimal strings without inventing missing values', () => {
    const base = { financialAssetKey: { financialAssetKey: 8, name: 'Apple', symbol: 'AAPL' }, financialTransactionTypeKey: { financialTransactionTypeKey: 1, name: 'BUY' }, portfolioKey: { name: 'Broker', portfolioKey: 3 }, settlementCurrencyKey: { code: 'EUR', currencyKey: 1 }, transactionDate: '2026-07-19T10:00:00.000Z', transactionKey: 9 }
    const numeric = portfolioActivityResponseSchema.parse({ transactions: [{ ...base, quantity: 2.5, settlementAmount: 20.25 }] }).transactions[0]
    const decimal = portfolioActivityResponseSchema.parse({ transactions: [{ ...base, itemType: 'TRANSACTION', quantity: '2.500', settlementAmount: '20.25', feeAmount: null }] }).transactions[0]
    expect(numeric).toMatchObject({ itemType: 'TRANSACTION', quantity: 2.5, settlementAmount: 20.25 })
    expect(decimal).toMatchObject({ itemType: 'TRANSACTION', quantity: 2.5, settlementAmount: 20.25, feeAmount: null })
    expect(portfolioActivityResponseSchema.parse({ transactions: [{ transactionKey: null, transactionDate: null }] }).transactions[0]).toMatchObject({ itemType: 'TRANSACTION', transactionKey: null, transactionDate: null })
    expect(portfolioActivityResponseSchema.safeParse({ transactions: [{ ...base, settlementAmount: 'NaN' }] }).success).toBe(false)
    expect(portfolioActivityResponseSchema.safeParse({ transactions: [{ ...base, quantity: Infinity }] }).success).toBe(false)
  })

  it('accepts nullish stock-split ratio fields without hiding valid activity', () => {
    const split = { denominator: 1, editable: false, financialAssetKey: { financialAssetKey: 8, name: 'Apple', symbol: 'AAPL' }, id: 'stock-split:1:3:8', itemType: 'STOCK_SPLIT', numerator: 4, portfolioKey: { name: 'Broker', portfolioKey: 3 }, splitRatio: 4, transactionDate: '2026-07-19T00:00:00.000Z' }
    expect(portfolioActivityResponseSchema.parse({ transactions: [split] }).transactions[0]).toMatchObject({ itemType: 'STOCK_SPLIT', editable: false, numerator: 4, denominator: 1 })
    expect(portfolioActivityResponseSchema.safeParse({ transactions: [{ ...split, editable: true }] }).success).toBe(false)
    const normal = { transactionDate: '2026-07-18T00:00:00.000Z', transactionKey: 9 }
    const explicitNull = { ...split, id: 'stock-split:null', numerator: null, denominator: null, splitRatio: null }
    const omitted = { editable: false, financialAssetKey: split.financialAssetKey, id: 'stock-split:omitted', itemType: 'STOCK_SPLIT', portfolioKey: split.portfolioKey, transactionDate: split.transactionDate }
    const partials = [
      { ...split, id: 'stock-split:numerator-only', denominator: undefined, splitRatio: undefined },
      { ...split, id: 'stock-split:denominator-only', numerator: undefined, splitRatio: null },
      { ...split, id: 'stock-split:ratio-missing', splitRatio: undefined },
    ]
    const parsed = portfolioActivityResponseSchema.parse({ transactions: [normal, explicitNull, omitted, ...partials] })
    expect(parsed.transactions).toHaveLength(6)
    expect(parsed.transactions[0]).toMatchObject({ itemType: 'TRANSACTION', transactionKey: 9 })
    expect(parsed.transactions[1]).toMatchObject({ itemType: 'STOCK_SPLIT', numerator: null, denominator: null, splitRatio: null })
    expect(parsed.transactions[2]).toMatchObject({ itemType: 'STOCK_SPLIT' })
    expect(parsed.transactions[2]).not.toHaveProperty('numerator')
  })

  it.each([
    ['zero numerator', { numerator: 0 }],
    ['negative denominator', { denominator: -1 }],
    ['zero split ratio', { splitRatio: 0 }],
    ['infinite numerator', { numerator: Infinity }],
    ['NaN denominator', { denominator: Number.NaN }],
    ['string ratio', { splitRatio: '4' }],
  ])('rejects malformed present stock-split values: %s', (_label, invalid) => {
    const split = { denominator: 1, editable: false, financialAssetKey: { financialAssetKey: 8, name: 'Apple', symbol: 'AAPL' }, id: 'stock-split:1:3:8', itemType: 'STOCK_SPLIT', numerator: 4, portfolioKey: { name: 'Broker', portfolioKey: 3 }, splitRatio: 4, transactionDate: '2026-07-19T00:00:00.000Z' }
    expect(portfolioActivityResponseSchema.safeParse({ transactions: [{ ...split, ...invalid }] }).success).toBe(false)
  })

  it('serializes a fixed limit and only validated explicit date filters', () => {
    expect(createPortfolioActivityEndpoint(null).path).toBe('/v1/portfolio/transactions?limit=50')
    expect(createPortfolioActivityEndpoint(7, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T23:59:59.999Z' }).path).toBe('/v1/portfolio/7/transactions?limit=50&fromDate=2026-07-01T00%3A00%3A00.000Z&toDate=2026-07-31T23%3A59%3A59.999Z')
    expect(parsePortfolioActivityFilters('bad', undefined)).toBeNull()
    expect(parsePortfolioActivityFilters(['2026-07-01T00:00:00.000Z'], undefined)).toBeNull()
  })

  it('keeps analytics contracts tolerant of additions and nullable risk explicit', () => {
    const allocation = portfolioAllocationResponseSchema.parse({
      byType: [{ percentage: 12.5, type: 'Stock', value: 100 }],
      byAssetClass: [{ percentage: 12.5, type: 'Equities', value: 100 }],
      unclassifiedHoldings: [{ name: 'Mystery asset', value: 10 }],
      driftRows: [{ assetClass: 'Equities', currentPct: 12.5, targetPct: 20, driftPts: -7.5 }],
      guidanceText: null,
    })
    expect(allocation.byType[0]?.percentage).toBe(12.5)
    expect(allocation.unclassifiedHoldings[0]?.name).toBe('Mystery asset')
    expect(portfolioDividendIncomeResponseSchema.parse({ byAsset: [{ financialAssetKey: 8, symbol: 'AAPL', totalDividends: 4 }], totalDividends: 4 }).totalDividends).toBe(4)
    const response = { metrics: { annualYield: null, assetAllocation: {}, currentValue: 100, maxDrawdown: null, readiness: { allocation: { status: 'ready' }, holdings: { status: 'ready' }, performance: { status: 'insufficient_history' }, riskMetrics: { status: 'insufficient_history' } }, riskLevel: null, sharpeRatio: null, totalReturn: 0, volatility: null } }
    expect(portfolioMetricsResponseSchema.parse(response).metrics.riskLevel).toBeNull()
    expect(portfolioMetricsResponseSchema.parse({ ...response, metrics: { ...response.metrics, extra: true } })).toEqual(response)
    const unknown = portfolioMetricsResponseSchema.parse({ metrics: { ...response.metrics, riskLevel: 'Extreme', readiness: { allocation: { status: 'stale' }, holdings: { status: 'ready' }, performance: { status: 'backfilling' }, riskMetrics: { status: 'backfilling' } } } }).metrics
    expect(unknown.riskLevel).toBeNull()
    expect(unknown.readiness).toEqual({ allocation: { status: 'unknown' }, holdings: { status: 'ready' }, performance: { status: 'insufficient_history' }, riskMetrics: { status: 'insufficient_history' } })
  })

  it('pins the transaction DELETE to a bodiless 204 contract and rejects invalid ids', () => {
    expect(createDeletePortfolioTransactionEndpoint(7, 41)).toMatchObject({ method: 'DELETE', path: '/v1/portfolio/7/transaction/41', successStatuses: [204] })
    for (const [portfolioId, transactionId] of [[0, 41], [7, 0], [7, -1]] as const) expect(() => createDeletePortfolioTransactionEndpoint(portfolioId, transactionId)).toThrow()
  })

  it('pins the transaction PUT to a bodiless 200 contract and rejects invalid ids', () => {
    expect(createEditPortfolioTransactionEndpoint(7, 41)).toMatchObject({ method: 'PUT', path: '/v1/portfolio/7/transaction/41', successStatuses: [200] })
    for (const [portfolioId, transactionId] of [[0, 41], [7, 0], [7, -1]] as const) expect(() => createEditPortfolioTransactionEndpoint(portfolioId, transactionId)).toThrow()
  })

  describe('freezePortfolioTransactionEdit', () => {
    const now = new Date('2026-08-11T12:00:00.000Z')

    it('includes only the fields that were actually touched', () => {
      expect(freezePortfolioTransactionEdit({ quantity: ' 3.5 ' }, now)).toEqual({ quantity: '3.5' })
      expect(freezePortfolioTransactionEdit({ unitPrice: '182.10' }, now)).toEqual({ unitPrice: '182.10' })
      expect(freezePortfolioTransactionEdit({ transactionDate: '2026-08-01' }, now)).toEqual({ transactionDate: '2026-08-01T12:00:00.000Z' })
    })

    it('treats an explicit empty-string notes edit as clearing it to null, distinct from not touching notes at all', () => {
      expect(freezePortfolioTransactionEdit({ notes: '' }, now)).toEqual({ notes: null })
      expect(freezePortfolioTransactionEdit({ notes: '  New note  ' }, now)).toEqual({ notes: 'New note' })
      expect(freezePortfolioTransactionEdit({ quantity: '1' }, now)).not.toHaveProperty('notes')
    })

    it('rejects a future transaction date, matching web', () => {
      expect(() => freezePortfolioTransactionEdit({ transactionDate: '2026-08-12' }, now)).toThrow()
      expect(freezePortfolioTransactionEdit({ transactionDate: '2026-08-11' }, now)).toEqual({ transactionDate: '2026-08-11T12:00:00.000Z' })
    })

    it('rejects a non-positive or malformed quantity/unitPrice', () => {
      expect(() => freezePortfolioTransactionEdit({ quantity: '0' }, now)).toThrow()
      expect(() => freezePortfolioTransactionEdit({ quantity: '-1' }, now)).toThrow()
      expect(() => freezePortfolioTransactionEdit({ unitPrice: 'abc' }, now)).toThrow()
    })

    it('rejects a draft where nothing was actually changed', () => {
      expect(() => freezePortfolioTransactionEdit({}, now)).toThrow()
      expect(() => freezePortfolioTransactionEdit({ quantity: '  ' }, now)).toThrow()
    })
  })

  it('builds the transaction-create POST contract and the transaction-types GET contract', () => {
    expect(createCreatePortfolioTransactionEndpoint(7)).toMatchObject({ method: 'POST', path: '/v1/portfolio/7/transaction', successStatuses: [201] })
    expect(() => createCreatePortfolioTransactionEndpoint(0)).toThrow()
    expect(portfolioTransactionTypesEndpoint).toMatchObject({ method: 'GET', path: '/v1/portfolio/transaction-types' })
    expect(portfolioTransactionTypesResponseSchema.parse({ transactionTypes: [{ financialTransactionTypeKey: 1, name: 'BUY' }] })).toEqual({ transactionTypes: [{ financialTransactionTypeKey: 1, name: 'BUY' }] })
    expect(createPortfolioTransactionResponseSchema.parse({ transaction: { transactionKey: 99, extra: 'ignored' } })).toEqual({ transactionId: 99 })
  })

  it('excludes DIVIDEND (case-insensitively) from the manually-creatable transaction types', () => {
    expect(isManuallyCreatableTransactionType('BUY')).toBe(true)
    expect(isManuallyCreatableTransactionType('SELL')).toBe(true)
    expect(isManuallyCreatableTransactionType('DIVIDEND')).toBe(false)
    expect(isManuallyCreatableTransactionType('dividend')).toBe(false)
  })

  describe('freezePortfolioTransactionCreate', () => {
    const now = new Date('2026-08-11T12:00:00.000Z')
    const draft = {
      assetSymbol: 'AAPL', financialTransactionTypeId: 3, notes: '', quantity: '10', settlementCurrencyId: 2, transactionDate: '2026-08-01', unitPrice: '150.25',
    }

    it('builds the write payload from a fully-filled draft, omitting blank notes', () => {
      expect(freezePortfolioTransactionCreate(draft, now)).toEqual({
        assetSymbol: 'AAPL', financialTransactionTypeId: 3, quantity: '10', settlementCurrencyId: 2, transactionDate: '2026-08-01T12:00:00.000Z', unitPrice: '150.25',
      })
    })

    it('keeps a trimmed, non-blank note', () => {
      expect(freezePortfolioTransactionCreate({ ...draft, notes: '  Bought the dip  ' }, now)).toMatchObject({ notes: 'Bought the dip' })
    })

    it('requires a transaction type and a settlement currency', () => {
      expect(() => freezePortfolioTransactionCreate({ ...draft, financialTransactionTypeId: null }, now)).toThrow()
      expect(() => freezePortfolioTransactionCreate({ ...draft, settlementCurrencyId: null }, now)).toThrow()
    })

    it('rejects a blank asset symbol, a non-positive quantity/unitPrice, and a future date', () => {
      expect(() => freezePortfolioTransactionCreate({ ...draft, assetSymbol: '  ' }, now)).toThrow()
      expect(() => freezePortfolioTransactionCreate({ ...draft, quantity: '0' }, now)).toThrow()
      expect(() => freezePortfolioTransactionCreate({ ...draft, unitPrice: 'abc' }, now)).toThrow()
      expect(() => freezePortfolioTransactionCreate({ ...draft, transactionDate: '2026-08-12' }, now)).toThrow()
    })
  })
})
