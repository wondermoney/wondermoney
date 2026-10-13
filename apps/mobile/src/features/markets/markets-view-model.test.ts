import {
  buildWatchlistRows,
  formatAsOfTimestamp,
  formatDateOnly,
  formatScreenerMarketCap,
  formatScreenerPrice,
  mapEarningsChart,
  mapFinancialsChart,
  mapFundamentals,
  mapHistoricalPrice,
  mapQuote,
  mapScreenerResults,
  mapSearchResults,
  mergeCompanyInfo,
  signPrefix,
} from './markets-view-model'

describe('mapSearchResults', () => {
  it('projects the same fields the contract returns, nothing added', () => {
    const rows = mapSearchResults([
      { currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc', symbol: 'AAPL', type: 'Common Stock' },
      { currency: null, exchange: null, name: null, symbol: 'XYZ', type: null },
    ])
    expect(rows).toEqual([
      { currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc', symbol: 'AAPL', type: 'Common Stock' },
      { currency: null, exchange: null, name: null, symbol: 'XYZ', type: null },
    ])
  })

  it('maps an empty list to an empty list', () => {
    expect(mapSearchResults([])).toEqual([])
  })
})

describe('mapQuote', () => {
  it('passes the quote fields through unchanged', () => {
    const dto = {
      change: 1.23,
      changePercent: 0.45,
      currency: 'USD',
      marketState: 'open' as const,
      name: 'Apple Inc',
      price: 232.5,
      source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const },
      symbol: 'AAPL',
      timestamp: '2026-08-10T10:00:00.000Z',
      volume: 1_000_000,
    }
    expect(mapQuote(dto)).toEqual(dto)
  })
})

describe('formatAsOfTimestamp', () => {
  it('formats an ISO timestamp using the given locale', () => {
    const formatted = formatAsOfTimestamp('2026-08-10T10:00:00.000Z', 'en', 'Unavailable')
    expect(formatted).not.toBe('Unavailable')
    expect(formatted.length).toBeGreaterThan(0)
  })

  it('falls back to the unavailable label for null', () => {
    expect(formatAsOfTimestamp(null, 'en', 'Unavailable')).toBe('Unavailable')
  })
})

describe('signPrefix', () => {
  it('prefixes a positive value with a plus sign', () => {
    expect(signPrefix(1.23)).toBe('+')
  })

  it('adds no prefix for a negative value (the native minus sign already carries it)', () => {
    expect(signPrefix(-1.23)).toBe('')
  })

  it('adds no prefix for zero', () => {
    expect(signPrefix(0)).toBe('')
  })
})

describe('buildWatchlistRows', () => {
  const quote = {
    change: 1.23,
    changePercent: 0.45,
    currency: 'USD',
    marketState: 'open' as const,
    name: 'Apple Inc',
    price: 232.5,
    source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const },
    symbol: 'AAPL',
    timestamp: '2026-08-10T10:00:00.000Z',
    volume: 1_000_000,
  }

  it('maps an empty symbol list to an empty row list', () => {
    expect(buildWatchlistRows([], [])).toEqual([])
  })

  it('marks a row loading while its quote query is pending', () => {
    const rows = buildWatchlistRows(['AAPL'], [{ data: undefined, isPending: true, isError: false }])
    expect(rows).toEqual([{ symbol: 'AAPL', quote: null, quoteStatus: 'loading' }])
  })

  it('marks a row loaded with its mapped quote once data arrives', () => {
    const rows = buildWatchlistRows(['AAPL'], [{ data: quote, isPending: false, isError: false }])
    expect(rows).toEqual([{ symbol: 'AAPL', quote, quoteStatus: 'loaded' }])
  })

  it('marks a row errored (degraded, still present) when its quote query fails without data', () => {
    const rows = buildWatchlistRows(['ZZZZ'], [{ data: undefined, isPending: false, isError: true }])
    expect(rows).toEqual([{ symbol: 'ZZZZ', quote: null, quoteStatus: 'error' }])
  })

  it('keeps every symbol present and independently degraded when one quote fails and others succeed', () => {
    const rows = buildWatchlistRows(
      ['AAPL', 'ZZZZ', 'MSFT'],
      [
        { data: quote, isPending: false, isError: false },
        { data: undefined, isPending: false, isError: true },
        { data: undefined, isPending: true, isError: false },
      ],
    )
    expect(rows.map((row) => row.symbol)).toEqual(['AAPL', 'ZZZZ', 'MSFT'])
    expect(rows.map((row) => row.quoteStatus)).toEqual(['loaded', 'error', 'loading'])
  })

  it('treats a missing result for a symbol as loading rather than throwing', () => {
    expect(buildWatchlistRows(['AAPL'], [])).toEqual([{ symbol: 'AAPL', quote: null, quoteStatus: 'loading' }])
  })
})

describe('mapScreenerResults', () => {
  it('projects only the fields this slice renders, nothing added', () => {
    const rows = mapScreenerResults([
      {
        beta: 1.2,
        country: 'US',
        dividendYield: 0.005,
        industry: 'Consumer Electronics',
        marketCap: 3_000_000_000_000,
        name: 'Apple Inc',
        peRatio: 30.1,
        price: 232.5,
        sector: 'Technology',
        symbol: 'AAPL',
        volume: 50_000_000,
      },
      {
        beta: null,
        country: null,
        dividendYield: null,
        industry: null,
        marketCap: null,
        name: null,
        peRatio: null,
        price: null,
        sector: null,
        symbol: 'XYZ',
        volume: null,
      },
    ])
    expect(rows).toEqual([
      { marketCap: 3_000_000_000_000, name: 'Apple Inc', price: 232.5, sector: 'Technology', symbol: 'AAPL' },
      { marketCap: null, name: null, price: null, sector: null, symbol: 'XYZ' },
    ])
  })

  it('maps an empty list to an empty list', () => {
    expect(mapScreenerResults([])).toEqual([])
  })
})

describe('formatScreenerPrice', () => {
  it('formats a price with two fraction digits using the given locale', () => {
    expect(formatScreenerPrice(232.5, 'en', 'Unavailable')).toBe('232.50')
  })

  it('falls back to the unavailable label for null', () => {
    expect(formatScreenerPrice(null, 'en', 'Unavailable')).toBe('Unavailable')
  })
})

describe('formatScreenerMarketCap', () => {
  it('formats a market cap using compact notation', () => {
    expect(formatScreenerMarketCap(3_000_000_000_000, 'en', 'Unavailable')).toBe('3T')
  })

  it('falls back to the unavailable label for null', () => {
    expect(formatScreenerMarketCap(null, 'en', 'Unavailable')).toBe('Unavailable')
  })
})

describe('mergeCompanyInfo', () => {
  const quote = {
    change: 1.23, changePercent: 0.45, currency: null, marketState: 'open' as const, name: null,
    price: 232.5, source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const }, symbol: 'AAPL',
    timestamp: '2026-08-10T10:00:00.000Z', volume: 1000,
  }
  const companyInfo = {
    beta: null, ceo: null, changePercentage: null, country: 'US', currency: 'USD', description: null,
    employees: null, exchange: 'NASDAQ', image: null, industry: null, name: 'Apple Inc.', price: null,
    sector: null, symbol: 'AAPL', website: null,
  }

  it('fills in name and currency from company info without touching other fields', () => {
    expect(mergeCompanyInfo(quote, companyInfo)).toEqual({ ...quote, name: 'Apple Inc.', currency: 'USD' })
  })

  it('passes the quote through unchanged when company info is unavailable', () => {
    expect(mergeCompanyInfo(quote, null)).toEqual(quote)
  })

  it('never overwrites a quote field that is already non-null', () => {
    const namedQuote = { ...quote, name: 'Already named', currency: 'EUR' }
    expect(mergeCompanyInfo(namedQuote, companyInfo)).toEqual(namedQuote)
  })
})

describe('mapHistoricalPrice', () => {
  it('converts close prices to index-positioned chart points, dropping null closes', () => {
    const points = mapHistoricalPrice([
      { adjClose: null, close: 100, date: '2026-07-01', high: null, low: null, open: null, volume: null },
      { adjClose: null, close: null, date: '2026-07-02', high: null, low: null, open: null, volume: null },
      { adjClose: null, close: 110, date: '2026-07-03', high: null, low: null, open: null, volume: null },
    ])
    expect(points).toEqual([{ x: 0, value: 100 }, { x: 1, value: 110 }])
  })

  it('maps an empty list to an empty list', () => {
    expect(mapHistoricalPrice([])).toEqual([])
  })
})

describe('formatDateOnly', () => {
  it('formats an ISO date-only string using the given locale', () => {
    expect(formatDateOnly('2026-09-15', 'en', 'Unavailable')).toBe('Sep 15, 2026')
  })

  it('falls back to the unavailable label for null', () => {
    expect(formatDateOnly(null, 'en', 'Unavailable')).toBe('Unavailable')
  })

  it('falls back to the unavailable label for an unparseable date rather than throwing', () => {
    expect(formatDateOnly('not-a-date', 'en', 'Unavailable')).toBe('Unavailable')
  })
})

describe('mapFundamentals', () => {
  it('passes every fundamentals field through unchanged', () => {
    const dto = {
      avgVolume: 50_000_000,
      beta: 1.2,
      dividendYield: 0.005,
      earningsPerShare: 6.1,
      fiftyTwoWeekHigh: 250,
      fiftyTwoWeekLow: 150,
      marketCap: 3_000_000_000_000,
      nextEarningsDate: '2026-09-15',
      pegRatio: 2.1,
      peRatio: 30.5,
      priceToBook: 40,
      priceToSales: 8,
      roe: 1.5,
      source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const },
      symbol: 'AAPL',
    }
    expect(mapFundamentals(dto)).toEqual(dto)
  })
})

describe('mapFinancialsChart', () => {
  it('reverses then takes the 5 most recent periods, projecting only period/revenue/netIncome', () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      grossProfit: 1,
      netIncome: index,
      operatingIncome: 1,
      period: `FY${2018 + index}`,
      revenue: index * 10,
    }))
    const points = mapFinancialsChart(entries)
    expect(points).toEqual([
      { period: 'FY2024', revenue: 60, netIncome: 6 },
      { period: 'FY2023', revenue: 50, netIncome: 5 },
      { period: 'FY2022', revenue: 40, netIncome: 4 },
      { period: 'FY2021', revenue: 30, netIncome: 3 },
      { period: 'FY2020', revenue: 20, netIncome: 2 },
    ])
  })

  it('defaults a null period to an empty string', () => {
    const points = mapFinancialsChart([{ grossProfit: null, netIncome: 1, operatingIncome: null, period: null, revenue: 2 }])
    expect(points).toEqual([{ period: '', revenue: 2, netIncome: 1 }])
  })

  it('maps an empty list to an empty list', () => {
    expect(mapFinancialsChart([])).toEqual([])
  })
})

describe('mapEarningsChart', () => {
  it('reverses then takes the 6 most recent quarters, projecting only quarter/actual/estimated', () => {
    const entries = [
      { date: '2024-01-31', eps: 0, epsEstimated: 0.1, revenue: 1, revenueEstimated: 1 },
      { date: '2024-04-30', eps: 1, epsEstimated: 1.1, revenue: 1, revenueEstimated: 1 },
      { date: '2024-07-31', eps: 2, epsEstimated: 2.1, revenue: 1, revenueEstimated: 1 },
      { date: '2024-10-31', eps: 3, epsEstimated: 3.1, revenue: 1, revenueEstimated: 1 },
      { date: '2025-01-31', eps: 4, epsEstimated: 4.1, revenue: 1, revenueEstimated: 1 },
      { date: '2025-04-30', eps: 5, epsEstimated: 5.1, revenue: 1, revenueEstimated: 1 },
      { date: '2025-07-31', eps: 6, epsEstimated: 6.1, revenue: 1, revenueEstimated: 1 },
    ]
    const points = mapEarningsChart(entries)
    expect(points).toHaveLength(6)
    expect(points.map((p) => p.actual)).toEqual([6, 5, 4, 3, 2, 1])
    expect(points[0]).toEqual({ quarter: 'Q2 25', actual: 6, estimated: 6.1 })
  })

  it('shifts the report date back one quarter before reading the fiscal quarter/year, without a date-fns dependency', () => {
    expect(mapEarningsChart([{ date: '2025-07-31', eps: 1, epsEstimated: 1, revenue: 1, revenueEstimated: 1 }])[0]?.quarter).toBe('Q2 25')
    expect(mapEarningsChart([{ date: '2025-01-15', eps: 1, epsEstimated: 1, revenue: 1, revenueEstimated: 1 }])[0]?.quarter).toBe('Q4 24')
  })

  it('labels a null date with a dash rather than throwing', () => {
    expect(mapEarningsChart([{ date: null, eps: 1, epsEstimated: 1, revenue: 1, revenueEstimated: 1 }])[0]?.quarter).toBe('-')
  })

  it('maps an empty list to an empty list', () => {
    expect(mapEarningsChart([])).toEqual([])
  })
})
