import { earningsKey, financialsKey, fundamentalsKey, quoteKey, screenerKey, tickerSearchKey, watchlistKey } from './query-keys'

describe('markets query keys', () => {
  it('scopes search results by namespace, term, and authenticated epoch', () => {
    expect(tickerSearchKey(7, 'aapl')).toEqual(['markets', 7, 'search', 'aapl'])
    expect(tickerSearchKey(8, 'aapl')).not.toEqual(tickerSearchKey(7, 'aapl'))
    expect(tickerSearchKey(7, 'msft')).not.toEqual(tickerSearchKey(7, 'aapl'))
  })

  it('scopes a quote by namespace, symbol, and authenticated epoch', () => {
    expect(quoteKey(7, 'AAPL')).toEqual(['markets', 7, 'quote', 'AAPL'])
    expect(quoteKey(8, 'AAPL')).not.toEqual(quoteKey(7, 'AAPL'))
    expect(quoteKey(7, 'MSFT')).not.toEqual(quoteKey(7, 'AAPL'))
  })

  it('scopes the watchlist by namespace and authenticated epoch, with no per-symbol variance', () => {
    expect(watchlistKey(7)).toEqual(['markets', 7, 'watchlist'])
    expect(watchlistKey(8)).not.toEqual(watchlistKey(7))
  })

  it('scopes fundamentals by namespace, symbol, and authenticated epoch', () => {
    expect(fundamentalsKey(7, 'AAPL')).toEqual(['markets', 7, 'fundamentals', 'AAPL'])
    expect(fundamentalsKey(8, 'AAPL')).not.toEqual(fundamentalsKey(7, 'AAPL'))
    expect(fundamentalsKey(7, 'MSFT')).not.toEqual(fundamentalsKey(7, 'AAPL'))
  })

  it('scopes financials by namespace, symbol, and authenticated epoch', () => {
    expect(financialsKey(7, 'AAPL')).toEqual(['markets', 7, 'financials', 'AAPL'])
    expect(financialsKey(8, 'AAPL')).not.toEqual(financialsKey(7, 'AAPL'))
    expect(financialsKey(7, 'MSFT')).not.toEqual(financialsKey(7, 'AAPL'))
  })

  it('scopes earnings by namespace, symbol, and authenticated epoch', () => {
    expect(earningsKey(7, 'AAPL')).toEqual(['markets', 7, 'earnings', 'AAPL'])
    expect(earningsKey(8, 'AAPL')).not.toEqual(earningsKey(7, 'AAPL'))
    expect(earningsKey(7, 'MSFT')).not.toEqual(earningsKey(7, 'AAPL'))
  })

  it('scopes the screener by namespace, every filter, page, limit, and authenticated epoch', () => {
    const base = { isEtf: false, isActivelyTrading: true, page: 0, limit: 25 }
    expect(screenerKey(7, base)).toEqual(['markets', 7, 'screener', false, true, null, null, null, null, null, null, null, null, 0, 25])
    expect(screenerKey(8, base)).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, isEtf: true })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, isActivelyTrading: false })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, priceMoreThan: 10 })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, priceLowerThan: 100 })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, marketCapMoreThan: 1 })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, marketCapLowerThan: 1 })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, sector: 'Technology' })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, industry: 'Biotechnology' })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, country: 'US' })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, exchange: 'nyse' })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, page: 1 })).not.toEqual(screenerKey(7, base))
    expect(screenerKey(7, { ...base, limit: 50 })).not.toEqual(screenerKey(7, base))
  })
})
