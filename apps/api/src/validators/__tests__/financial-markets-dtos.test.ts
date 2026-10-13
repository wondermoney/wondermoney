import { describe, expect, it } from 'vitest'

import {
  companyInformationResponseSchema,
  earningsResponseSchema,
  financialsResponseSchema,
  fundamentalsResponseSchema,
  historicalDividendResponseSchema,
  historicalPriceResponseSchema,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
  newsResponseSchema,
  quoteResponseSchema,
  searchTickerResponseSchema,
} from '../financial-markets-dtos'

const SOURCE = { asOf: null, provider: 'eodhd' } as const

describe('financial-markets stable DTO schemas (RAD-228)', () => {
  it('search: accepts a valid result, rejects unknown fields, accepts an empty list', () => {
    expect(
      searchTickerResponseSchema.safeParse({
        results: [{ currency: 'USD', exchange: 'NASDAQ', name: 'Apple', symbol: 'AAPL', type: 'stock' }],
        source: SOURCE,
      }).success,
    ).toBe(true)
    expect(
      searchTickerResponseSchema.safeParse({
        results: [{ lastAnnualDividend: 0.5, symbol: 'AAPL' }],
        source: SOURCE,
      }).success,
    ).toBe(false)
    expect(searchTickerResponseSchema.safeParse({ results: [], source: SOURCE }).success).toBe(true)
  })

  it('quote: requires the documented nulls and rejects FMP passthrough fields', () => {
    expect(
      quoteResponseSchema.safeParse({
        change: 1.5,
        changePercent: 0.79,
        currency: 'USD',
        marketState: 'open',
        name: 'Apple Inc.',
        price: 190,
        source: SOURCE,
        symbol: 'AAPL',
        timestamp: '2026-07-31T12:00:00.000Z',
        volume: 1000,
      }).success,
    ).toBe(true)
    expect(
      quoteResponseSchema.safeParse({
        change: 1.5,
        changePercent: 0.79,
        currency: 'USD',
        marketState: 'open',
        name: 'Apple Inc.',
        price: 190,
        source: SOURCE,
        symbol: 'AAPL',
        timestamp: '2026-07-31T12:00:00.000Z',
        volume: 1000,
        // Forbidden passthrough field from the raw FMP shape.
        changesPercentage: 0.79,
      }).success,
    ).toBe(false)
  })

  it('company: rejects FMP passthrough fields but accepts the documented DTO', () => {
    expect(
      companyInformationResponseSchema.safeParse({
        beta: 1.2,
        ceo: 'Tim Cook',
        changePercentage: 0.53,
        country: 'US',
        currency: 'USD',
        description: 'Apple Inc.',
        employees: 164000,
        exchange: 'NASDAQ',
        image: 'https://images.financialmodelingprep.com/AAPL.png',
        industry: 'Consumer Electronics',
        name: 'Apple Inc.',
        price: 190,
        sector: 'Technology',
        symbol: 'AAPL',
        website: 'https://apple.com',
      }).success,
    ).toBe(true)
    // A non-https logo URL is not a valid image and must be rejected.
    expect(
      companyInformationResponseSchema.safeParse({
        beta: 1.2,
        ceo: 'Tim Cook',
        changePercentage: 0.53,
        country: 'US',
        currency: 'USD',
        description: 'Apple Inc.',
        employees: 164000,
        exchange: 'NASDAQ',
        image: 'http://images.financialmodelingprep.com/AAPL.png',
        industry: 'Consumer Electronics',
        name: 'Apple Inc.',
        price: 190,
        sector: 'Technology',
        symbol: 'AAPL',
        website: 'https://apple.com',
      }).success,
    ).toBe(false)
    expect(
      companyInformationResponseSchema.safeParse({
        beta: 1.2,
        ceo: 'Tim Cook',
        changePercentage: 0.53,
        country: 'US',
        currency: 'USD',
        description: 'Apple Inc.',
        employees: 164000,
        exchange: 'NASDAQ',
        image: null,
        industry: 'Consumer Electronics',
        name: 'Apple Inc.',
        price: 190,
        sector: 'Technology',
        symbol: 'AAPL',
        website: 'https://apple.com',
        // Forbidden FMP keys must not leak through.
        cik: '0000320193',
        isin: 'US0378331005',
      }).success,
    ).toBe(false)
  })

  it('historical-price: enforces ISO date and finite numbers', () => {
    expect(
      historicalPriceResponseSchema.safeParse({
        prices: [
          { adjClose: null, close: 100, date: '2026-01-01', high: 101, low: 99, open: 100, volume: 1000 },
        ],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
    expect(
      historicalPriceResponseSchema.safeParse({
        prices: [{ adjClose: null, close: 100, date: '01/01/2026', high: 101, low: 99, open: 100, volume: 1000 }],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(false)
  })

  it('historical-dividend: requires an explicit date and a numeric amount (zero allowed)', () => {
    expect(
      historicalDividendResponseSchema.safeParse({
        dividends: [{ adjAmount: null, amount: 0.24, date: '2026-01-15' }],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
  })

  it('earnings: keeps the four DTO fields and rejects raw FMP keys', () => {
    expect(
      earningsResponseSchema.safeParse({
        earnings: [
          { date: '2026-01-30', eps: 1.5, epsEstimated: 1.4, revenue: 100000000000, revenueEstimated: 95000000000 },
        ],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
    expect(
      earningsResponseSchema.safeParse({
        earnings: [
          { date: '2026-01-30', eps: 1.5, epsEstimated: 1.4, revenue: 100000000000, revenueEstimated: 95000000000, time: 'AMC' },
        ],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(false)
  })

  it('financials: accepts the documented DTO with YYYY or YYYY-MM-DD periods', () => {
    expect(
      financialsResponseSchema.safeParse({
        financials: [
          { grossProfit: 500, netIncome: 100, operatingIncome: 80, period: '2025', revenue: 1000 },
        ],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
    expect(
      financialsResponseSchema.safeParse({
        financials: [
          { grossProfit: 500, netIncome: 100, operatingIncome: 80, period: '2025-12-31', revenue: 1000 },
        ],
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
  })

  it('fundamentals: keeps the DTO metrics and requires explicit nulls for missing ratios', () => {
    expect(
      fundamentalsResponseSchema.safeParse({
        avgVolume: 50000000,
        beta: 1.2,
        dividendYield: 0.0078,
        earningsPerShare: 6.5,
        fiftyTwoWeekHigh: 220,
        fiftyTwoWeekLow: 160,
        marketCap: 1000000000,
        nextEarningsDate: '2026-10-30',
        pegRatio: null,
        peRatio: 29.2,
        priceToBook: 12.3,
        priceToSales: 7.8,
        roe: 0.5,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
    expect(
      fundamentalsResponseSchema.safeParse({
        avgVolume: null,
        beta: null,
        dividendYield: null,
        earningsPerShare: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        marketCap: 1000000000,
        nextEarningsDate: null,
        pegRatio: null,
        peRatio: null,
        priceToBook: null,
        priceToSales: null,
        roe: null,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
  })

  it('news: accepts the documented item, rejects raw FMP passthrough and a non-https url', () => {
    expect(
      newsResponseSchema.safeParse({
        hasMore: true,
        news: [
          {
            image: 'https://images.example.com/aapl.png',
            publishedAt: '2026-07-31T12:00:00.000Z',
            site: 'Example Wire',
            summary: 'Apple reported record revenue.',
            symbol: 'AAPL',
            title: 'Apple hits new high',
            url: 'https://example.com/aapl',
          },
        ],
        page: 0,
        pageSize: 20,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(true)
    // A non-https article URL is not valid and must be coerced upstream, not accepted here.
    expect(
      newsResponseSchema.safeParse({
        hasMore: false,
        news: [
          {
            image: null,
            publishedAt: null,
            site: 'Example Wire',
            summary: 'Apple reported record revenue.',
            symbol: 'AAPL',
            title: 'Apple hits new high',
            url: 'http://example.com/aapl',
          },
        ],
        page: 0,
        pageSize: 20,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(false)
    // Raw FMP news keys (e.g. `text`) must not leak through the strict item schema.
    expect(
      newsResponseSchema.safeParse({
        hasMore: false,
        news: [
          {
            image: null,
            publishedAt: null,
            site: 'Example Wire',
            summary: 'Apple reported record revenue.',
            symbol: 'AAPL',
            text: 'Apple reported record revenue.',
            title: 'Apple hits new high',
            url: 'https://example.com/aapl',
          },
        ],
        page: 0,
        pageSize: 20,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(false)
    // Over-long title / summary blow the length bound the projection is required to enforce.
    expect(
      newsResponseSchema.safeParse({
        hasMore: false,
        news: [
          {
            image: null,
            publishedAt: null,
            site: 'Example Wire',
            summary: 'x'.repeat(NEWS_SUMMARY_MAX_LENGTH + 1),
            symbol: 'AAPL',
            title: 'x'.repeat(NEWS_TITLE_MAX_LENGTH + 1),
            url: null,
          },
        ],
        page: 0,
        pageSize: 20,
        source: SOURCE,
        symbol: 'AAPL',
      }).success,
    ).toBe(false)
  })
})
