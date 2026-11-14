import type { Request, Response } from 'express';

import {
  getCompanyInfoRequestSchema,
  getEarningsRequestSchema,
  getFinancialsRequestSchema,
  getFundamentalsRequestSchema,
  getHistoricalDividendRequestSchema,
  getHistoricalPriceRequestSchema,
  getNewsRequestSchema,
  getQuoteRequestSchema,
  searchTickerRequestSchema,
} from '@app/validators/financial-markets';
import {
  type CompanyInformationResponseDto,
  companyInformationResponseSchema,
  type HistoricalDividendResponseDto,
  historicalDividendResponseSchema,
  type HistoricalPriceResponseDto,
  historicalPriceResponseSchema,
  type QuoteResponseDto,
  quoteResponseSchema,
  type SearchTickerResponseDto,
  searchTickerResponseSchema,
} from '@app/validators/financial-markets-dtos';
import { zParse } from '@app/validators/parser';
import type { MarketDataProviderId } from '@config/market-data-providers';
import { handleMarketDataError } from '@service/market-data/errors';
import { marketData } from '@service/market-data/registry';
import { FeatureDisabledError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

/** Which provider answered (`MARKET_DATA_PROVIDERS`, in order; EODHD by default). */
const sourceMetadata = (provider: MarketDataProviderId) => ({ asOf: null, provider })

export async function getCompanyInformation(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getCompanyInfoRequestSchema, req)
  try {
    const { value: results } = await marketData().search(ticker)
    // search() is a fuzzy/fielded lookup — take the first exact symbol match,
    // falling back to the first result so a near-miss ticker still resolves.
    const profile = results.find((row) => readSymbol(row.Code) === readSymbol(ticker)) ?? results[0]
    if (!profile) {
      return res.json({ companyInformation: null })
    }
    // Fundamentals-tier fields (beta, ceo, description, employees, industry,
    // sector, website, image) are unavailable without EODHD's Fundamentals
    // tier (not in our plan) and stay null. Price and
    // changePercentage are NOT fundamentals-gated — they come from the same
    // real-time quote call `getQuote` uses below, so Explorer's header and
    // the Watchlist row show the same "current price" concept from one
    // source of truth instead of one live and one derived from EOD history
    // (which can disagree, sometimes by a lot, mid-session).
    const { changePercentage, price } = await fetchQuoteSnapshot(ticker)
    const dto: CompanyInformationResponseDto = {
      beta: null,
      ceo: null,
      changePercentage,
      country: stringValue(profile.Country),
      currency: upperCurrency(profile.Currency),
      description: null,
      employees: null,
      exchange: stringValue(profile.Exchange),
      image: null,
      industry: null,
      name: stringValue(profile.Name),
      price,
      sector: null,
      symbol: readSymbol(profile.Code),
      website: null,
    }
    return res.json({ companyInformation: companyInformationResponseSchema.parse(dto) })
  } catch (error) {
    handleMarketDataError(error)
  }
}

export async function getEarnings(req: Request, _res: Response) {
  await zParse(getEarningsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated).
  throw new NotFoundError('Earnings data is not covered by the current market-data plan')
}

export async function getFinancials(req: Request, _res: Response) {
  await zParse(getFinancialsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated).
  throw new NotFoundError('Financials data is not covered by the current market-data plan')
}

export async function getFundamentals(req: Request, _res: Response) {
  await zParse(getFundamentalsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated).
  throw new NotFoundError('Fundamentals data is not covered by the current market-data plan')
}

export async function getHistoricalDividend(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getHistoricalDividendRequestSchema, req)
  try {
    const { provider, value: rows } = await marketData().dividends(ticker)
    const dto: HistoricalDividendResponseDto = {
      dividends: rows
        .map((row) => ({
          // EODHD's dividend value is already the per-share cash amount (not an
          // adjusted-close price). There is no
          // separate "unadjusted price on that date" concept here, so both DTO
          // fields carry the same value — this is the correct, direct mapping,
          // not a fallback.
          adjAmount: numeric(row.value),
          amount: numeric(row.value),
          date: dateString(row.date) ?? '',
        }))
        .filter((entry) => Boolean(entry.date)),
      source: sourceMetadata(provider),
      symbol: readSymbol(ticker),
    }
    return res.json(historicalDividendResponseSchema.parse(dto))
  } catch (error) {
    handleMarketDataError(error)
  }
}

export async function getHistoricalPrice(req: Request, res: Response) {
  const {
    params: { ticker },
    query: { from, includeDividends, to },
  } = await zParse(getHistoricalPriceRequestSchema, req)
  try {
    const [{ provider, value: companyHistoricalPrice }, companyHistoricalDividends] = await Promise.all([
      marketData().dailyHistory(ticker, { from, to }),
      // Without a provider that has dividends here, the prices still come back, without them.
      includeDividends ? marketData().dividends(ticker, { from, to }).then((answer) => answer.value, ignoreDisabled) : Promise.resolve(null),
    ])
    const dividendByDate = new Map(
      (companyHistoricalDividends ?? []).map((row) => [
        dateString(row.date) ?? '',
        numeric(row.value),
      ]),
    )
    const dto: HistoricalPriceResponseDto = {
      prices: companyHistoricalPrice
        .map((row) => {
          const date = dateString(row.date) ?? ''
          if (!date) return null
          return {
            // NOTE: `adjClose` here is "dividend amount paid on that date",
            // not a split/dividend-adjusted closing price. This DTO field
            // means "dividend value on this date if includeDividends was
            // requested" — a naming quirk kept for DTO compatibility.
            adjClose: includeDividends ? dividendByDate.get(date) ?? null : null,
            close: numeric(row.close),
            date,
            high: numeric(row.high),
            low: numeric(row.low),
            open: numeric(row.open),
            volume: numeric(row.volume),
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      source: sourceMetadata(provider),
      symbol: readSymbol(ticker),
    }
    return res.json(historicalPriceResponseSchema.parse(dto))
  } catch (error) {
    handleMarketDataError(error)
  }
}

export async function getNews(req: Request, _res: Response) {
  await zParse(getNewsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated).
  throw new NotFoundError('News data is not covered by the current market-data plan')
}

export async function getQuote(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getQuoteRequestSchema, req)
  try {
    const [{ provider, value: quote }, currency] = await Promise.all([marketData().quote(ticker), listingCurrency(ticker)])
    const price = numeric(quote.close)
    const change = numeric(quote.change)
    const changePercent = roundPercent(numeric(quote.change_p))
    const dto: QuoteResponseDto = {
      change,
      changePercent,
      // A provider's quote carries no currency, so it comes from the search
      // listing (null when unknown or ambiguous). The company name is left out:
      // EODHD's needs the Fundamentals tier this plan doesn't cover.
      currency,
      marketState: null,
      name: null,
      price,
      source: sourceMetadata(provider),
      symbol: readSymbol(quote.code || ticker),
      timestamp: quote.timestamp ? new Date(quote.timestamp * 1000).toISOString() : null,
      volume: numeric(quote.volume),
    }
    return res.json(quoteResponseSchema.parse(dto))
  } catch (error) {
    handleMarketDataError(error)
  }
}

export async function searchTicker(req: Request, res: Response) {
  const {
    query: { searchTerm },
  } = await zParse(searchTickerRequestSchema, req)

  // Blank query → empty results (the search box fires before the user types).
  if (!searchTerm) {
    const empty: SearchTickerResponseDto = { results: [], source: sourceMetadata(marketData().providers[0]?.id ?? 'eodhd') }
    return res.json(searchTickerResponseSchema.parse(empty))
  }

  try {
    const { provider, value: results } = await marketData().search(searchTerm)
    const dto: SearchTickerResponseDto = {
      results: results.map((row) => ({
        currency: upperCurrency(row.Currency),
        exchange: stringValue(row.Exchange),
        name: stringValue(row.Name),
        symbol: readSymbol(row.Code),
        // EODHD's search results carry an instrument type (e.g. "Common Stock",
        // "ETF"); the DTO field is a nullable string.
        type: stringValue(row.Type),
      })),
      source: sourceMetadata(provider),
    }
    return res.json(searchTickerResponseSchema.parse(dto))
  } catch (error) {
    handleMarketDataError(error)
  }
}

function dateString(value: unknown): null | string {
  const s = stringValue(value)
  if (!s) return null
  // Accept YYYY-MM-DD (history / events) or YYYY (fiscal year from income
  // statement / calendarYear). Anything else is treated as missing.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{4}$/.test(s)) return s
  return null
}

/**
 * Real-time price + daily change for `ticker`, from the exact same
 * registry quote call `getQuote` above uses. Shared so company-information
 * (Explorer) and quote (Watchlist) can never derive "current price" from two
 * different provider calls.
 *
 * Best-effort: a quote hiccup returns nulls rather than throwing, so it
 * doesn't take down the rest of the company-profile response — the caller
 * already resolved that independently via the registry's search. The frontend
 * knows how to render a null price/changePercentage (its last-close
 * fallback), same as it already does for a quote-only failure.
 */
async function fetchQuoteSnapshot(ticker: string): Promise<{ changePercentage: null | number; price: null | number }> {
  try {
    const { value: quote } = await marketData().quote(ticker)
    return {
      changePercentage: roundPercent(numeric(quote.change_p)),
      price: numeric(quote.close),
    }
  } catch (error) {
    logger.warn({ error, ticker }, 'Failed to fetch real-time quote for company-information price snapshot')
    return { changePercentage: null, price: null }
  }
}

/**
 * The currency `ticker` trades in, from the provider's search: the listings whose code (and,
 * for `CODE.EXCHANGE`, exchange) match exactly. Null when none match, when they disagree (one
 * symbol on exchanges in different currencies) or when the search fails, so a client shows
 * the bare number rather than a wrong currency. Never fails the quote.
 */
function ignoreDisabled(error: unknown): null {
  if (error instanceof FeatureDisabledError) return null
  throw error
}

async function listingCurrency(ticker: string): Promise<null | string> {
  const symbol = readSymbol(ticker)
  const dot = symbol.lastIndexOf('.')
  const code = dot > 0 ? symbol.slice(0, dot) : symbol
  const exchange = dot > 0 ? symbol.slice(dot + 1) : null
  try {
    const { value: results } = await marketData().search(symbol)
    const currencies = new Set(
      results
        .filter((row) => readSymbol(row.Code) === code && (exchange === null || readSymbol(row.Exchange) === exchange))
        .map((row) => upperCurrency(row.Currency)),
    )
    const [only] = currencies
    return currencies.size === 1 ? only ?? null : null
  } catch (error) {
    logger.warn({ error, ticker }, 'Failed to look up the listing currency for a quote')
    return null
  }
}

function numeric(value: unknown): null | number {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function readSymbol(value: unknown): string {
  const s = stringValue(value)
  return s ? s.trim().toUpperCase() : ''
}

function roundPercent(value: null | number): null | number {
  return value === null ? null : Number(value.toFixed(4))
}

function stringValue(value: unknown): null | string {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return null
}

function upperCurrency(value: unknown): null | string {
  const s = stringValue(value)
  if (!s) return null
  return /^[A-Z]{3}$/.test(s) ? s : null
}
