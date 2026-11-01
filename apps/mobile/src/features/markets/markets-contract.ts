import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Ticker search + quote. Every nullable value stays an
 * explicit null rather than an inferred one. Fields the API adds later are
 * stripped, not rejected (see `tolerantEnum` in runtime-schema.ts), so a
 * shipped build keeps working after an additive API change.
 */

const marketSourceSchema = z.object({
  asOf: z.iso.datetime().nullable(),
  // Not rendered. A change of market-data provider must not break the markets screens.
  provider: z.string().min(1),
})

export const tickerSearchResultSchema = z.object({
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
  name: z.string().nullable(),
  symbol: z.string().trim().min(1).max(20),
  type: z.string().nullable(),
})

export const tickerSearchResponseSchema = z.object({
  results: z.array(tickerSearchResultSchema),
  source: marketSourceSchema,
})

export type TickerSearchResultDto = z.infer<typeof tickerSearchResultSchema>

export function createSearchTickersEndpoint(searchTerm: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/search?searchTerm=${encodeURIComponent(searchTerm)}`,
    schema: tickerSearchResponseSchema,
  })
}

const marketStateSchema = tolerantEnum(['closed', 'open', 'pre-market', 'after-hours', 'unknown'], 'unknown')
  .nullable()

export const quoteResponseSchema = z.object({
  change: z.number().nullable(),
  changePercent: z.number().nullable(),
  currency: z.string().nullable(),
  marketState: marketStateSchema,
  name: z.string().nullable(),
  price: z.number().nullable(),
  source: marketSourceSchema,
  symbol: z.string(),
  timestamp: z.iso.datetime().nullable(),
  volume: z.number().nullable(),
})

export type QuoteResponseDto = z.infer<typeof quoteResponseSchema>

export function createQuoteEndpoint(symbol: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/quote`,
    schema: quoteResponseSchema,
  })
}

/**
 * `/quote`'s `name`/`currency` are permanently null server-side — EODHD's real-time quote has
 * neither field, both requiring the Fundamentals tier the API doesn't have (see
 * getQuote in core/api's financial-markets controller). `/info` sources name/currency/country/
 * exchange from a different, unrestricted EODHD call (`eodhd.search()`), so those four fields are
 * real today; the rest (price, sector, description, etc.) stay null.
 */
export const companyInformationSchema = z.object({
  beta: z.number().nullable(),
  ceo: z.string().nullable(),
  changePercentage: z.number().nullable(),
  country: z.string().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  employees: z.number().nullable(),
  exchange: z.string().nullable(),
  image: z.string().nullable(),
  industry: z.string().nullable(),
  name: z.string().nullable(),
  price: z.number().nullable(),
  sector: z.string().nullable(),
  symbol: z.string().trim().min(1).max(20),
  website: z.string().nullable(),
})

export const companyInformationResponseSchema = z.object({
  companyInformation: companyInformationSchema.nullable(),
})

export type CompanyInformationDto = z.infer<typeof companyInformationSchema>

export function createCompanyInfoEndpoint(symbol: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/info`,
    schema: companyInformationResponseSchema,
  })
}

const isoDatePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const isoDateOnlySchema = z.string().regex(isoDatePattern)

export const historicalPricePointSchema = z.object({
  adjClose: z.number().nullable(),
  close: z.number().nullable(),
  date: isoDateOnlySchema,
  high: z.number().nullable(),
  low: z.number().nullable(),
  open: z.number().nullable(),
  volume: z.number().nullable(),
})

export const historicalPriceResponseSchema = z.object({
  prices: z.array(historicalPricePointSchema),
  source: marketSourceSchema,
  symbol: z.string(),
})

export type HistoricalPricePointDto = z.infer<typeof historicalPricePointSchema>

export const HISTORICAL_PRICE_PERIODS = ['1M', '3M', '1Y', 'YTD', 'ALL'] as const
export type HistoricalPricePeriod = typeof HISTORICAL_PRICE_PERIODS[number]

/**
 * Unlike the portfolio performance endpoint, this one has no named-period query param — the
 * caller computes from/to itself. Omitting both (the 'ALL' case) returns the provider's full
 * available history rather than a capped range.
 */
export function historicalPriceRange(period: HistoricalPricePeriod, today: Date): { from?: string; to?: string } {
  if (period === 'ALL') return {}
  const to = today.toISOString().slice(0, 10)
  const from = new Date(today)
  if (period === 'YTD') from.setUTCMonth(0, 1)
  else if (period === '1M') from.setUTCMonth(from.getUTCMonth() - 1)
  else if (period === '3M') from.setUTCMonth(from.getUTCMonth() - 3)
  else if (period === '1Y') from.setUTCFullYear(from.getUTCFullYear() - 1)
  return { from: from.toISOString().slice(0, 10), to }
}

export function createHistoricalPriceEndpoint(symbol: string, period: HistoricalPricePeriod, today: Date = new Date()) {
  const range = historicalPriceRange(period, today)
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const query = params.toString()
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/historical-price${query ? `?${query}` : ''}`,
    schema: historicalPriceResponseSchema,
  })
}

/**
 * Tenant-owned watchlist. The add/remove writes are `204 No Content`,
 * mirroring account-deletion-contract's `z.undefined()` / `successStatuses`
 * pattern. The API uppercases symbols on write, so the request path is
 * uppercased here too, keeping a lowercase-typed symbol comparable against
 * the case-sensitive list `GET` returns.
 */
export const watchlistResponseSchema = z.object({
  symbols: z.array(z.string().trim().min(1).max(20)),
})

export function createWatchlistEndpoint() {
  return readEndpoint({
    method: 'GET',
    path: '/v1/financial-markets/watchlist',
    schema: watchlistResponseSchema,
  })
}

export function createAddToWatchlistEndpoint(symbol: string) {
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/financial-markets/watchlist/${encodeURIComponent(symbol.toUpperCase())}`,
    schema: z.undefined(),
    successStatuses: [204],
  })
}

export function createRemoveFromWatchlistEndpoint(symbol: string) {
  return writeEndpoint({
    method: 'DELETE',
    path: `/v1/financial-markets/watchlist/${encodeURIComponent(symbol.toUpperCase())}`,
    schema: z.undefined(),
    successStatuses: [204],
  })
}

/**
 * Key-metrics TTM. Every field mirrors the API's own
 * `fundamentalsResponseSchema` (financial-markets-dtos.ts) exactly, including
 * field order and the explicit-null convention: the provider (EODHD)
 * currently has no plan tier covering this endpoint, so it 404s for every
 * ticker today (see the API's `getFundamentals` controller), but the
 * contract and caching window are already real — the same shape live data
 * will fill.
 */
export const fundamentalsResponseSchema = z.object({
  avgVolume: z.number().nullable(),
  beta: z.number().nullable(),
  dividendYield: z.number().nullable(),
  earningsPerShare: z.number().nullable(),
  fiftyTwoWeekHigh: z.number().nullable(),
  fiftyTwoWeekLow: z.number().nullable(),
  marketCap: z.number().nullable(),
  nextEarningsDate: isoDateOnlySchema.nullable(),
  pegRatio: z.number().nullable(),
  peRatio: z.number().nullable(),
  priceToBook: z.number().nullable(),
  priceToSales: z.number().nullable(),
  roe: z.number().nullable(),
  source: marketSourceSchema,
  symbol: z.string().trim().min(1).max(20),
})

export type FundamentalsResponseDto = z.infer<typeof fundamentalsResponseSchema>

export function createFundamentalsEndpoint(symbol: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/fundamentals`,
    schema: fundamentalsResponseSchema,
  })
}

/** Periodic income statement, same 404 caveat as fundamentals above. */
export const financialsEntrySchema = z.object({
  grossProfit: z.number().nullable(),
  netIncome: z.number().nullable(),
  operatingIncome: z.number().nullable(),
  period: z.string().nullable(),
  revenue: z.number().nullable(),
})

export const financialsResponseSchema = z.object({
  financials: z.array(financialsEntrySchema),
  source: marketSourceSchema,
  symbol: z.string().trim().min(1).max(20),
})

export type FinancialsEntryDto = z.infer<typeof financialsEntrySchema>

export function createFinancialsEndpoint(symbol: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/financials`,
    schema: financialsResponseSchema,
  })
}

/** Past + scheduled earnings, same 404 caveat as fundamentals above. */
export const earningsEntrySchema = z.object({
  date: isoDateOnlySchema.nullable(),
  eps: z.number().nullable(),
  epsEstimated: z.number().nullable(),
  revenue: z.number().nullable(),
  revenueEstimated: z.number().nullable(),
})

export const earningsResponseSchema = z.object({
  earnings: z.array(earningsEntrySchema),
  source: marketSourceSchema,
  symbol: z.string().trim().min(1).max(20),
})

export type EarningsEntryDto = z.infer<typeof earningsEntrySchema>

export function createEarningsEndpoint(symbol: string) {
  return readEndpoint({
    method: 'GET',
    path: `/v1/financial-markets/ticker/${encodeURIComponent(symbol)}/earnings`,
    schema: earningsResponseSchema,
  })
}

/**
 * Paginated screener. Deliberately scoped to numeric
 * min/max filters (price, market cap) plus the isEtf/isActivelyTrading
 * toggles, per this ticket's own acceptance criteria ("numeric min/max, ETF
 * and active-trading filters ship first"). Sector/country/exchange are
 * explicitly deferred until a canonical value list exists — a free-text
 * filter against an uncontrolled vocabulary would silently return zero
 * results for any value that doesn't exactly match the provider's spelling.
 * Beta/dividend yield/volume are deferred to a follow-up slice. `hasMore`
 * is the only authoritative pagination signal — the API gives no reliable
 * total count, so nothing here invents one.
 */
export const screenerEntrySchema = z.object({
  beta: z.number().nullable(),
  country: z.string().nullable(),
  dividendYield: z.number().nullable(),
  industry: z.string().nullable(),
  marketCap: z.number().nullable(),
  name: z.string().nullable(),
  peRatio: z.number().nullable(),
  price: z.number().nullable(),
  sector: z.string().nullable(),
  symbol: z.string().trim().min(1).max(20),
  volume: z.number().nullable(),
})

export const screenerResponseSchema = z.object({
  hasMore: z.boolean(),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  results: z.array(screenerEntrySchema),
  source: marketSourceSchema,
})

export type ScreenerEntryDto = z.infer<typeof screenerEntrySchema>
export type ScreenerResponseDto = z.infer<typeof screenerResponseSchema>

export type ScreenerFilters = Readonly<{
  isEtf: boolean
  isActivelyTrading: boolean
  priceMoreThan?: number
  priceLowerThan?: number
  marketCapMoreThan?: number
  marketCapLowerThan?: number
  sector?: string
  industry?: string
  country?: string
  exchange?: string
  page: number
  limit: number
}>

function screenerPath(filters: ScreenerFilters): string {
  const params = new URLSearchParams()
  params.set('isEtf', String(filters.isEtf))
  params.set('isActivelyTrading', String(filters.isActivelyTrading))
  if (filters.priceMoreThan !== undefined) params.set('priceMoreThan', String(filters.priceMoreThan))
  if (filters.priceLowerThan !== undefined) params.set('priceLowerThan', String(filters.priceLowerThan))
  if (filters.marketCapMoreThan !== undefined) params.set('marketCapMoreThan', String(filters.marketCapMoreThan))
  if (filters.marketCapLowerThan !== undefined) params.set('marketCapLowerThan', String(filters.marketCapLowerThan))
  if (filters.sector !== undefined) params.set('sector', filters.sector)
  if (filters.industry !== undefined) params.set('industry', filters.industry)
  if (filters.country !== undefined) params.set('country', filters.country)
  if (filters.exchange !== undefined) params.set('exchange', filters.exchange)
  params.set('page', String(filters.page))
  params.set('limit', String(filters.limit))
  return `/v1/financial-markets/screener?${params.toString()}`
}

export function createScreenerEndpoint(filters: ScreenerFilters) {
  return readEndpoint({
    method: 'GET',
    path: screenerPath(filters),
    schema: screenerResponseSchema,
  })
}

export function isValidSymbol(symbol: string): boolean {
  const trimmed = symbol.trim()
  return trimmed.length > 0 && trimmed.length <= 20
}

/** Mirrors accounts-contract's parseAccountId: route params can arrive as an array. */
export function parseSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isValidSymbol(trimmed) ? trimmed : null
}
