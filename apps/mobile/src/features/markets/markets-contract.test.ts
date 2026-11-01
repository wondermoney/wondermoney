import {
  companyInformationResponseSchema,
  createAddToWatchlistEndpoint,
  createCompanyInfoEndpoint,
  createEarningsEndpoint,
  createFinancialsEndpoint,
  createFundamentalsEndpoint,
  createHistoricalPriceEndpoint,
  createQuoteEndpoint,
  createRemoveFromWatchlistEndpoint,
  createScreenerEndpoint,
  createSearchTickersEndpoint,
  createWatchlistEndpoint,
  earningsResponseSchema,
  financialsResponseSchema,
  fundamentalsResponseSchema,
  historicalPriceRange,
  historicalPriceResponseSchema,
  isValidSymbol,
  parseSymbol,
  quoteResponseSchema,
  screenerResponseSchema,
  tickerSearchResponseSchema,
  watchlistResponseSchema,
} from './markets-contract'

const searchResult = {
  currency: 'USD',
  exchange: 'NASDAQ',
  name: 'Apple Inc',
  symbol: 'AAPL',
  type: 'Common Stock',
}

const searchResponse = {
  results: [searchResult],
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
}

const quote = {
  change: 1.23,
  changePercent: 0.45,
  currency: 'USD',
  marketState: 'open',
  name: 'Apple Inc',
  price: 232.5,
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
  symbol: 'AAPL',
  timestamp: '2026-08-10T10:00:00.000Z',
  volume: 1000000,
}

describe('markets ticker search contract', () => {
  it('pins the exact search endpoint with an encoded query string', () => {
    const endpoint = createSearchTickersEndpoint('apple inc')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/search?searchTerm=apple%20inc')
    expect(endpoint.schema).toBe(tickerSearchResponseSchema)
  })

  it('accepts a full search result and an empty results list', () => {
    expect(tickerSearchResponseSchema.parse(searchResponse)).toEqual(searchResponse)
    expect(tickerSearchResponseSchema.parse({ ...searchResponse, results: [] }).results).toEqual([])
  })

  it('keeps every nullable search-result field explicit', () => {
    const parsed = tickerSearchResponseSchema.parse({
      ...searchResponse,
      results: [{ ...searchResult, currency: null, exchange: null, name: null, type: null }],
    })
    expect(parsed.results[0]).toEqual({
      currency: null,
      exchange: null,
      name: null,
      symbol: 'AAPL',
      type: null,
    })
  })

  it.each([
    ['missing symbol', { ...searchResult, symbol: undefined }],
    ['empty symbol', { ...searchResult, symbol: '' }],
    ['symbol over 20 chars', { ...searchResult, symbol: 'A'.repeat(21) }],
    ['null symbol', { ...searchResult, symbol: null }],
  ])('rejects a malformed result: %s', (_label, candidate) => {
    expect(
      tickerSearchResponseSchema.safeParse({ ...searchResponse, results: [candidate] }).success,
    ).toBe(false)
  })

  it('strips fields the API adds, on a result and at the top level', () => {
    const parsed = tickerSearchResponseSchema.parse({
      ...searchResponse,
      results: [{ ...searchResult, marketCap: 1_000_000 }],
      generatedAt: 'now',
    })
    expect(parsed).toEqual(searchResponse)
  })

  it('accepts a different market-data provider (not rendered)', () => {
    expect(tickerSearchResponseSchema.parse({ ...searchResponse, source: { asOf: null, provider: 'iex' } }).source.provider).toBe('iex')
    expect(tickerSearchResponseSchema.safeParse({ ...searchResponse, source: { asOf: null, provider: '' } }).success).toBe(false)
  })
})

describe('markets quote contract', () => {
  it('pins the exact quote endpoint with an encoded symbol path segment', () => {
    const endpoint = createQuoteEndpoint('BRK.B')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/BRK.B/quote')
    expect(endpoint.schema).toBe(quoteResponseSchema)
  })

  it('encodes symbols containing reserved URL characters', () => {
    const endpoint = createQuoteEndpoint('^GSPC/TEST')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/%5EGSPC%2FTEST/quote')
  })

  it('accepts a full quote and preserves every explicit null', () => {
    expect(quoteResponseSchema.parse(quote)).toEqual(quote)
    const allNull = {
      ...quote,
      change: null,
      changePercent: null,
      currency: null,
      marketState: null,
      name: null,
      price: null,
      timestamp: null,
      volume: null,
    }
    expect(quoteResponseSchema.parse(allNull)).toEqual(allNull)
  })

  it.each(['closed', 'open', 'pre-market', 'after-hours', 'unknown'] as const)(
    'accepts market state %s',
    (marketState) => {
      expect(quoteResponseSchema.parse({ ...quote, marketState }).marketState).toBe(marketState)
    },
  )

  it('reads a market state this build does not know as unknown', () => {
    expect(quoteResponseSchema.parse({ ...quote, marketState: 'suspended' }).marketState).toBe('unknown')
    expect(quoteResponseSchema.safeParse({ ...quote, marketState: 3 }).success).toBe(false)
  })

  it('strips fields the API adds', () => {
    expect(quoteResponseSchema.parse({ ...quote, high52Week: 240 })).toEqual(quote)
  })

  it('rejects a missing symbol', () => {
    expect(quoteResponseSchema.safeParse({ ...quote, symbol: undefined }).success).toBe(false)
  })
})

describe('markets watchlist contract', () => {
  it('pins the exact list endpoint', () => {
    const endpoint = createWatchlistEndpoint()
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/watchlist')
    expect(endpoint.schema).toBe(watchlistResponseSchema)
  })

  it('accepts a list of symbols and an empty list', () => {
    expect(watchlistResponseSchema.parse({ symbols: ['AAPL', 'MSFT'] })).toEqual({ symbols: ['AAPL', 'MSFT'] })
    expect(watchlistResponseSchema.parse({ symbols: [] })).toEqual({ symbols: [] })
  })

  it('rejects a symbol over 20 chars or blank', () => {
    expect(watchlistResponseSchema.safeParse({ symbols: ['A'.repeat(21)] }).success).toBe(false)
    expect(watchlistResponseSchema.safeParse({ symbols: [''] }).success).toBe(false)
  })

  it('strips fields the API adds', () => {
    expect(watchlistResponseSchema.parse({ symbols: [], generatedAt: 'now' })).toEqual({ symbols: [] })
  })

  it('pins the exact add endpoint, uppercasing and encoding the symbol path segment', () => {
    const endpoint = createAddToWatchlistEndpoint('brk.b')
    expect(endpoint.method).toBe('PUT')
    expect(endpoint.path).toBe('/v1/financial-markets/watchlist/BRK.B')
    expect(endpoint.successStatuses).toEqual([204])
    expect(endpoint.schema.parse(undefined)).toBeUndefined()
  })

  it('pins the exact remove endpoint, uppercasing and encoding the symbol path segment', () => {
    const endpoint = createRemoveFromWatchlistEndpoint('aapl')
    expect(endpoint.method).toBe('DELETE')
    expect(endpoint.path).toBe('/v1/financial-markets/watchlist/AAPL')
    expect(endpoint.successStatuses).toEqual([204])
    expect(endpoint.schema.parse(undefined)).toBeUndefined()
  })

  it('encodes reserved URL characters in add/remove symbol paths', () => {
    expect(createAddToWatchlistEndpoint('^gspc/test').path).toBe('/v1/financial-markets/watchlist/%5EGSPC%2FTEST')
    expect(createRemoveFromWatchlistEndpoint('^gspc/test').path).toBe('/v1/financial-markets/watchlist/%5EGSPC%2FTEST')
  })
})

const screenerEntry = {
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
}

const screenerResponse = {
  hasMore: true,
  page: 0,
  pageSize: 25,
  results: [screenerEntry],
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
}

describe('markets screener contract', () => {
  it('always includes isEtf and isActivelyTrading, even with no other filters set', () => {
    const endpoint = createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, page: 0, limit: 25 })
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&page=0&limit=25')
    expect(endpoint.schema).toBe(screenerResponseSchema)
  })

  it('omits unset numeric filters from the query string, including only the ones provided', () => {
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, priceMoreThan: 10, page: 0, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&priceMoreThan=10&page=0&limit=25',
    )
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, priceLowerThan: 100, page: 2, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&priceLowerThan=100&page=2&limit=25',
    )
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, marketCapMoreThan: 1_000_000, page: 0, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&marketCapMoreThan=1000000&page=0&limit=25',
    )
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, marketCapLowerThan: 2_000_000, page: 0, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&marketCapLowerThan=2000000&page=0&limit=25',
    )
  })

  it('includes every set filter together with page and limit, in a stable order', () => {
    const endpoint = createScreenerEndpoint({
      isEtf: true,
      isActivelyTrading: false,
      priceMoreThan: 10,
      priceLowerThan: 500,
      marketCapMoreThan: 1_000_000,
      marketCapLowerThan: 5_000_000_000,
      sector: 'Technology',
      industry: 'Biotechnology',
      country: 'US',
      exchange: 'nyse',
      page: 3,
      limit: 25,
    })
    expect(endpoint.path).toBe(
      '/v1/financial-markets/screener'
      + '?isEtf=true&isActivelyTrading=false&priceMoreThan=10&priceLowerThan=500'
      + '&marketCapMoreThan=1000000&marketCapLowerThan=5000000000'
      + '&sector=Technology&industry=Biotechnology&country=US&exchange=nyse&page=3&limit=25',
    )
  })

  it('omits unset canonical filters (sector/industry/country/exchange), including only the ones provided', () => {
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, sector: 'Technology', page: 0, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&sector=Technology&page=0&limit=25',
    )
    expect(createScreenerEndpoint({ isEtf: false, isActivelyTrading: true, country: 'US', page: 0, limit: 25 }).path).toBe(
      '/v1/financial-markets/screener?isEtf=false&isActivelyTrading=true&country=US&page=0&limit=25',
    )
  })

  it('accepts a full screener entry and preserves every explicit null', () => {
    expect(screenerResponseSchema.parse(screenerResponse)).toEqual(screenerResponse)
    const allNull = {
      ...screenerResponse,
      results: [{
        ...screenerEntry,
        beta: null,
        country: null,
        dividendYield: null,
        industry: null,
        marketCap: null,
        name: null,
        peRatio: null,
        price: null,
        sector: null,
        volume: null,
      }],
    }
    expect(screenerResponseSchema.parse(allNull)).toEqual(allNull)
  })

  it('accepts an empty results list', () => {
    expect(screenerResponseSchema.parse({ ...screenerResponse, results: [] }).results).toEqual([])
  })

  it('strips fields the API adds, on a result and at the top level', () => {
    expect(screenerResponseSchema.parse({
      ...screenerResponse,
      results: [{ ...screenerEntry, exchange: 'NASDAQ' }],
      total: 100,
    })).toEqual(screenerResponse)
  })

  it('rejects a missing hasMore, page, or pageSize', () => {
    const { hasMore: _hasMore, ...withoutHasMore } = screenerResponse
    expect(screenerResponseSchema.safeParse(withoutHasMore).success).toBe(false)
    const { page: _page, ...withoutPage } = screenerResponse
    expect(screenerResponseSchema.safeParse(withoutPage).success).toBe(false)
    const { pageSize: _pageSize, ...withoutPageSize } = screenerResponse
    expect(screenerResponseSchema.safeParse(withoutPageSize).success).toBe(false)
  })

  it('rejects a malformed symbol on a result', () => {
    expect(screenerResponseSchema.safeParse({
      ...screenerResponse,
      results: [{ ...screenerEntry, symbol: '' }],
    }).success).toBe(false)
  })
})

describe('symbol route-param parsing', () => {
  it('accepts a trimmed non-empty symbol up to 20 chars', () => {
    expect(parseSymbol('AAPL')).toBe('AAPL')
    expect(parseSymbol('  AAPL  ')).toBe('AAPL')
    expect(isValidSymbol('A'.repeat(20))).toBe(true)
  })

  it('rejects arrays, empty strings, non-strings, and overlong symbols', () => {
    expect(parseSymbol(['AAPL', 'MSFT'])).toBeNull()
    expect(parseSymbol('')).toBeNull()
    expect(parseSymbol('   ')).toBeNull()
    expect(parseSymbol(undefined)).toBeNull()
    expect(parseSymbol('A'.repeat(21))).toBeNull()
    expect(isValidSymbol('A'.repeat(21))).toBe(false)
  })
})

describe('company information', () => {
  const companyInfo = {
    beta: null, ceo: null, changePercentage: null, country: 'US', currency: 'USD', description: null,
    employees: null, exchange: 'NASDAQ', image: null, industry: null, name: 'Apple Inc.', price: null,
    sector: null, symbol: 'AAPL', website: null,
  }

  it('builds the exact info path', () => {
    expect(createCompanyInfoEndpoint('AAPL')).toMatchObject({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/info' })
  })

  it('parses a real company-info payload and an explicit null (unmatched ticker)', () => {
    expect(companyInformationResponseSchema.parse({ companyInformation: companyInfo })).toEqual({ companyInformation: companyInfo })
    expect(companyInformationResponseSchema.parse({ companyInformation: null })).toEqual({ companyInformation: null })
  })

  it('strips fields the API adds', () => {
    expect(companyInformationResponseSchema.parse({ companyInformation: { ...companyInfo, extra: true }, extra: true })).toEqual({ companyInformation: companyInfo })
  })
})

describe('historical price', () => {
  const priceResponse = {
    prices: [{ adjClose: null, close: 232.5, date: '2026-08-10', high: 235, low: 230, open: 231, volume: 1_000_000 }],
    source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
    symbol: 'AAPL',
  }

  it('computes the correct from/to range per period', () => {
    const today = new Date('2026-08-10T00:00:00.000Z')
    expect(historicalPriceRange('1M', today)).toEqual({ from: '2026-07-10', to: '2026-08-10' })
    expect(historicalPriceRange('3M', today)).toEqual({ from: '2026-05-10', to: '2026-08-10' })
    expect(historicalPriceRange('1Y', today)).toEqual({ from: '2025-08-10', to: '2026-08-10' })
    expect(historicalPriceRange('YTD', today)).toEqual({ from: '2026-01-01', to: '2026-08-10' })
    expect(historicalPriceRange('ALL', today)).toEqual({})
  })

  it('builds the historical-price path with a computed range, and no query string for ALL', () => {
    const today = new Date('2026-08-10T00:00:00.000Z')
    expect(createHistoricalPriceEndpoint('AAPL', '1M', today)).toMatchObject({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/historical-price?from=2026-07-10&to=2026-08-10' })
    expect(createHistoricalPriceEndpoint('AAPL', 'ALL', today)).toMatchObject({ method: 'GET', path: '/v1/financial-markets/ticker/AAPL/historical-price' })
  })

  it('parses a full historical price response and rejects malformed dates', () => {
    expect(historicalPriceResponseSchema.parse(priceResponse)).toEqual(priceResponse)
    expect(historicalPriceResponseSchema.safeParse({ ...priceResponse, prices: [{ ...priceResponse.prices[0], date: '2026/08/10' }] }).success).toBe(false)
  })

  it('accepts an empty prices list', () => {
    expect(historicalPriceResponseSchema.parse({ ...priceResponse, prices: [] }).prices).toEqual([])
  })
})

describe('ticker fundamentals contract', () => {
  const fundamentals = {
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
    source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
    symbol: 'AAPL',
  }

  it('pins the exact fundamentals endpoint with an encoded symbol path segment', () => {
    const endpoint = createFundamentalsEndpoint('BRK.B')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/BRK.B/fundamentals')
    expect(endpoint.schema).toBe(fundamentalsResponseSchema)
  })

  it('accepts a full fundamentals response and preserves every explicit null', () => {
    expect(fundamentalsResponseSchema.parse(fundamentals)).toEqual(fundamentals)
    const allNull = {
      ...fundamentals,
      avgVolume: null,
      beta: null,
      dividendYield: null,
      earningsPerShare: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      marketCap: null,
      nextEarningsDate: null,
      pegRatio: null,
      peRatio: null,
      priceToBook: null,
      priceToSales: null,
      roe: null,
    }
    expect(fundamentalsResponseSchema.parse(allNull)).toEqual(allNull)
  })

  it('rejects a malformed nextEarningsDate', () => {
    expect(fundamentalsResponseSchema.safeParse({ ...fundamentals, nextEarningsDate: '2026/09/15' }).success).toBe(false)
  })

  it('strips fields the API adds', () => {
    expect(fundamentalsResponseSchema.parse({ ...fundamentals, high52Week: 240 })).toEqual(fundamentals)
  })

  it('rejects a missing symbol', () => {
    expect(fundamentalsResponseSchema.safeParse({ ...fundamentals, symbol: undefined }).success).toBe(false)
  })
})

describe('ticker financials contract', () => {
  const financials = {
    financials: [
      { grossProfit: 180_683_000_000, netIncome: 93_736_000_000, operatingIncome: 123_216_000_000, period: 'FY2024', revenue: 391_035_000_000 },
    ],
    source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
    symbol: 'AAPL',
  }

  it('pins the exact financials endpoint with an encoded symbol path segment', () => {
    const endpoint = createFinancialsEndpoint('BRK.B')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/BRK.B/financials')
    expect(endpoint.schema).toBe(financialsResponseSchema)
  })

  it('accepts a full financials response and preserves every explicit null', () => {
    expect(financialsResponseSchema.parse(financials)).toEqual(financials)
    const allNull = {
      ...financials,
      financials: [{ grossProfit: null, netIncome: null, operatingIncome: null, period: null, revenue: null }],
    }
    expect(financialsResponseSchema.parse(allNull)).toEqual(allNull)
  })

  it('accepts an empty financials list', () => {
    expect(financialsResponseSchema.parse({ ...financials, financials: [] }).financials).toEqual([])
  })

  it('strips fields the API adds, on an entry and at the top level', () => {
    expect(financialsResponseSchema.parse({
      ...financials,
      financials: [{ ...financials.financials[0], ebitda: 1 }],
      generatedAt: 'now',
    })).toEqual(financials)
  })
})

describe('ticker earnings contract', () => {
  const earnings = {
    earnings: [
      { date: '2025-07-31', eps: 1.64, epsEstimated: 1.6, revenue: 94_036_000_000, revenueEstimated: 89_500_000_000 },
    ],
    source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
    symbol: 'AAPL',
  }

  it('pins the exact earnings endpoint with an encoded symbol path segment', () => {
    const endpoint = createEarningsEndpoint('BRK.B')
    expect(endpoint.method).toBe('GET')
    expect(endpoint.path).toBe('/v1/financial-markets/ticker/BRK.B/earnings')
    expect(endpoint.schema).toBe(earningsResponseSchema)
  })

  it('accepts a full earnings response and preserves every explicit null', () => {
    expect(earningsResponseSchema.parse(earnings)).toEqual(earnings)
    const allNull = {
      ...earnings,
      earnings: [{ date: null, eps: null, epsEstimated: null, revenue: null, revenueEstimated: null }],
    }
    expect(earningsResponseSchema.parse(allNull)).toEqual(allNull)
  })

  it('rejects a malformed date on an entry', () => {
    expect(
      earningsResponseSchema.safeParse({ ...earnings, earnings: [{ ...earnings.earnings[0], date: '2025/07/31' }] }).success,
    ).toBe(false)
  })

  it('accepts an empty earnings list', () => {
    expect(earningsResponseSchema.parse({ ...earnings, earnings: [] }).earnings).toEqual([])
  })

  it('strips fields the API adds, on an entry and at the top level', () => {
    expect(earningsResponseSchema.parse({
      ...earnings,
      earnings: [{ ...earnings.earnings[0], surprisePercent: 2.5 }],
      generatedAt: 'now',
    })).toEqual(earnings)
  })
})
