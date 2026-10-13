import { z } from 'zod'

/**
 * RAD-228 — stable DTOs for the Financial Markets module.
 *
 * These endpoints project the provider's response into a strict,
 * mobile-safe allowlist per endpoint — the DTO is the *only* thing the
 * controller may return; the provider response is projected into the DTO,
 * never spread.
 *
 * The schemas are intentionally strict: any extra field on the provider
 * side is dropped silently, and any contract violation (missing field,
 * wrong type) becomes a 502 with a generic error so the mobile UI can
 * distinguish "no data" (empty array) from "the provider is on fire"
 * (a 5xx).
 */

const symbolSchema = z.string().trim().min(1).max(20)
const isoDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
const nullableIsoDateSchema = isoDateSchema.nullable()
const nullableIsoDateTimeSchema = z.string().datetime({ offset: true }).nullable()
const nullableNumberSchema = z.number().finite().nullable()
const nullableStringSchema = z.string().nullable()
const finiteNumberSchema = z.number().finite()
// Logo / media URLs are only ever surfaced to the client as https — an http or
// otherwise malformed provider URL is coerced to null upstream, never rendered.
const nullableHttpsUrlSchema = z.string().url().startsWith('https://').nullable()

/** Provider metadata. Always present so the mobile UI can show "as of when". */
const sourceMetadataSchema = z
  .object({
    asOf: nullableIsoDateTimeSchema,
    provider: z.literal('eodhd'),
  })
  .strict()

/** `GET /v1/financial-markets/ticker/search` — debounced search box. */
export const searchTickerResultSchema = z
  .object({
    currency: nullableStringSchema,
    exchange: nullableStringSchema,
    name: nullableStringSchema,
    symbol: symbolSchema,
    type: nullableStringSchema,
  })
  .strict()

export const searchTickerResponseSchema = z
  .object({
    results: z.array(searchTickerResultSchema),
    source: sourceMetadataSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/quote` — current price + daily change. */
export const quoteResponseSchema = z
  .object({
    change: nullableNumberSchema,
    changePercent: nullableNumberSchema,
    currency: nullableStringSchema,
    marketState: z.enum(['closed', 'open', 'pre-market', 'after-hours', 'unknown']).nullable(),
    // Company display name — the watchlist renders it next to the symbol.
    name: nullableStringSchema,
    price: nullableNumberSchema,
    source: sourceMetadataSchema,
    symbol: symbolSchema,
    timestamp: nullableIsoDateTimeSchema,
    volume: nullableNumberSchema,
  })
  .strict()

/**
 * `GET /v1/financial-markets/ticker/:ticker/info` — company profile plus the
 * lightweight price snapshot the info card renders in its header (price +
 * daily change). Beta is a slow-moving profile attribute (not a live metric),
 * so it lives here rather than on the quote.
 */
export const companyInformationResponseSchema = z
  .object({
    beta: nullableNumberSchema,
    ceo: nullableStringSchema,
    changePercentage: nullableNumberSchema,
    country: nullableStringSchema,
    currency: nullableStringSchema,
    description: nullableStringSchema,
    employees: nullableNumberSchema,
    exchange: nullableStringSchema,
    image: nullableHttpsUrlSchema,
    industry: nullableStringSchema,
    name: nullableStringSchema,
    price: nullableNumberSchema,
    sector: nullableStringSchema,
    symbol: symbolSchema,
    website: nullableStringSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/historical-price` — OHLC history. */
export const historicalPricePointSchema = z
  .object({
    adjClose: nullableNumberSchema,
    close: nullableNumberSchema,
    date: isoDateSchema,
    high: nullableNumberSchema,
    low: nullableNumberSchema,
    open: nullableNumberSchema,
    volume: nullableNumberSchema,
  })
  .strict()

export const historicalPriceResponseSchema = z
  .object({
    prices: z.array(historicalPricePointSchema),
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/historical-dividend` — dividend history. */
export const historicalDividendPointSchema = z
  .object({
    adjAmount: nullableNumberSchema,
    amount: nullableNumberSchema,
    date: isoDateSchema,
  })
  .strict()

export const historicalDividendResponseSchema = z
  .object({
    dividends: z.array(historicalDividendPointSchema),
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/earnings` — past + scheduled earnings. */
export const earningsEntrySchema = z
  .object({
    date: nullableIsoDateSchema,
    eps: nullableNumberSchema,
    epsEstimated: nullableNumberSchema,
    revenue: nullableNumberSchema,
    revenueEstimated: nullableNumberSchema,
  })
  .strict()

export const earningsResponseSchema = z
  .object({
    earnings: z.array(earningsEntrySchema),
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/financials` — periodic income statement. */
export const financialsEntrySchema = z
  .object({
    grossProfit: nullableNumberSchema,
    netIncome: nullableNumberSchema,
    operatingIncome: nullableNumberSchema,
    period: nullableStringSchema,
    revenue: nullableNumberSchema,
  })
  .strict()

export const financialsResponseSchema = z
  .object({
    financials: z.array(financialsEntrySchema),
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

/** `GET /v1/financial-markets/ticker/:ticker/fundamentals` — key-metrics TTM. */
export const fundamentalsResponseSchema = z
  .object({
    avgVolume: nullableNumberSchema,
    beta: nullableNumberSchema,
    dividendYield: nullableNumberSchema,
    earningsPerShare: nullableNumberSchema,
    fiftyTwoWeekHigh: nullableNumberSchema,
    fiftyTwoWeekLow: nullableNumberSchema,
    marketCap: nullableNumberSchema,
    // Soonest scheduled earnings date (YYYY-MM-DD), or null if none is upcoming.
    nextEarningsDate: nullableIsoDateSchema,
    pegRatio: nullableNumberSchema,
    peRatio: nullableNumberSchema,
    priceToBook: nullableNumberSchema,
    priceToSales: nullableNumberSchema,
    roe: nullableNumberSchema,
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

/**
 * `GET /v1/financial-markets/ticker/:ticker/news` — symbol-scoped stock news.
 *
 * FMP's news rows carry provider-authored `title`/`text` that can contain HTML
 * and run arbitrarily long, plus `image`/`url` that may be http or malformed.
 * The controller strips those to bounded plain text and coerces the URLs to
 * https-or-null before they reach this schema; the max-length bounds are shared
 * with the controller so the projection and the contract can't drift.
 */
export const NEWS_SITE_MAX_LENGTH = 200
export const NEWS_SUMMARY_MAX_LENGTH = 1000
export const NEWS_TITLE_MAX_LENGTH = 300

export const newsItemSchema = z
  .object({
    image: nullableHttpsUrlSchema,
    publishedAt: nullableIsoDateTimeSchema,
    site: z.string().max(NEWS_SITE_MAX_LENGTH).nullable(),
    summary: z.string().max(NEWS_SUMMARY_MAX_LENGTH).nullable(),
    symbol: symbolSchema,
    title: z.string().max(NEWS_TITLE_MAX_LENGTH).nullable(),
    url: nullableHttpsUrlSchema,
  })
  .strict()

export const newsResponseSchema = z
  .object({
    // FMP's stock-news feed takes only a `limit` (no offset), so we fetch a
    // bounded window and slice it here.
    hasMore: z.boolean(),
    news: z.array(newsItemSchema),
    page: z.number().int().min(0),
    pageSize: finiteNumberSchema,
    source: sourceMetadataSchema,
    symbol: symbolSchema,
  })
  .strict()

export type CompanyInformationResponseDto = z.infer<typeof companyInformationResponseSchema>
export type EarningsEntryDto = z.infer<typeof earningsEntrySchema>
export type EarningsResponseDto = z.infer<typeof earningsResponseSchema>
export type FinancialsEntryDto = z.infer<typeof financialsEntrySchema>
export type FinancialsResponseDto = z.infer<typeof financialsResponseSchema>
export type FundamentalsResponseDto = z.infer<typeof fundamentalsResponseSchema>
export type HistoricalDividendPointDto = z.infer<typeof historicalDividendPointSchema>
export type HistoricalDividendResponseDto = z.infer<typeof historicalDividendResponseSchema>
export type HistoricalPricePointDto = z.infer<typeof historicalPricePointSchema>
export type HistoricalPriceResponseDto = z.infer<typeof historicalPriceResponseSchema>
export type NewsItemDto = z.infer<typeof newsItemSchema>
export type NewsResponseDto = z.infer<typeof newsResponseSchema>
export type QuoteResponseDto = z.infer<typeof quoteResponseSchema>
export type SearchTickerResponseDto = z.infer<typeof searchTickerResponseSchema>
export type SearchTickerResultDto = z.infer<typeof searchTickerResultSchema>
export type SourceMetadataDto = z.infer<typeof sourceMetadataSchema>
