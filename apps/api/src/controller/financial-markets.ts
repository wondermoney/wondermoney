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
import eodhd, { handleEodhdError } from '@service/market-data/eodhd.service';
import { NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

const PROVIDER = 'eodhd' as const

const SOURCE_METADATA = { asOf: null, provider: PROVIDER } as const

export async function getCompanyInformation(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getCompanyInfoRequestSchema, req)
  try {
    // Row type is inferred rather than annotated explicitly: see the
    // searchTicker comment above on why `EodhdTypes.SearchResult` can't be
    // referenced in a type position (TS2749). eodhd.search()'s own return
    // type is unaffected and correctly infers this shape.
    const results = await eodhd.search(ticker)
    // search() is a fuzzy/fielded lookup — take the first exact symbol match,
    // falling back to the first result so a near-miss ticker still resolves.
    const profile = results.find((row) => readSymbol(row.Code) === readSymbol(ticker)) ?? results[0]
    if (!profile) {
      return res.json({ companyInformation: null })
    }
    // Fundamentals-tier fields (beta, ceo, description, employees, industry,
    // sector, website, image) are unavailable without EODHD's Fundamentals
    // tier (not in this plan — see RAD-449 spec) and stay null. Price and
    // changePercentage are NOT fundamentals-gated — they come from the same
    // real-time quote call `getQuote` uses below, so Explorer's header and
    // the Watchlist row show the same "current price" concept from one
    // source of truth instead of one live and one derived from EOD history
    // (RAD-649 — the two used to disagree, sometimes by a lot, mid-session).
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
    handleEodhdError(error)
  }
}

export async function getEarnings(req: Request, _res: Response) {
  await zParse(getEarningsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated). See RAD-449.
  throw new NotFoundError('Earnings data is temporarily unavailable')
}

export async function getFinancials(req: Request, _res: Response) {
  await zParse(getFinancialsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated). See RAD-449.
  throw new NotFoundError('Financials data is temporarily unavailable')
}

export async function getFundamentals(req: Request, _res: Response) {
  await zParse(getFundamentalsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated). See RAD-449.
  throw new NotFoundError('Fundamentals data is temporarily unavailable')
}

export async function getHistoricalDividend(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getHistoricalDividendRequestSchema, req)
  try {
    // Row type is inferred rather than annotated explicitly: see the
    // searchTicker comment above on why `EodhdTypes.DividendDataPoint` can't
    // be referenced in a type position (TS2749). eodhd.getDividends()'s own
    // return type is unaffected and correctly infers this shape.
    const rows = await eodhd.getDividends(ticker)
    const dto: HistoricalDividendResponseDto = {
      dividends: rows
        .map((row) => ({
          // EODHD's dividend value is already the per-share cash amount (not an
          // adjusted-close price like FMP's getDividendAdjusted was). There is no
          // separate "unadjusted price on that date" concept here, so both DTO
          // fields carry the same value — this is the correct, direct mapping,
          // not a fallback.
          adjAmount: numeric(row.value),
          amount: numeric(row.value),
          date: dateString(row.date) ?? '',
        }))
        .filter((entry) => Boolean(entry.date)),
      source: { ...SOURCE_METADATA },
      symbol: readSymbol(ticker),
    }
    return res.json(historicalDividendResponseSchema.parse(dto))
  } catch (error) {
    handleEodhdError(error)
  }
}

export async function getHistoricalPrice(req: Request, res: Response) {
  const {
    params: { ticker },
    query: { from, includeDividends, to },
  } = await zParse(getHistoricalPriceRequestSchema, req)
  try {
    // Row types below are inferred rather than annotated explicitly: see the
    // searchTicker comment above on why `EodhdTypes.EodDataPoint` /
    // `EodhdTypes.DividendDataPoint` can't be referenced in a type position
    // (TS2749). eodhd.getEndOfDayPrices()/getDividends()'s own return types
    // are unaffected and correctly infer these shapes.
    const [companyHistoricalPrice, companyHistoricalDividends] = await Promise.all([
      eodhd.getEndOfDayPrices(ticker, { from, to }),
      includeDividends ? eodhd.getDividends(ticker, { from, to }) : Promise.resolve(null),
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
            // has always meant "dividend value on this date if
            // includeDividends was requested" — a pre-existing naming quirk
            // inherited from FMP, not something this migration changes.
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
      source: { ...SOURCE_METADATA },
      symbol: readSymbol(ticker),
    }
    return res.json(historicalPriceResponseSchema.parse(dto))
  } catch (error) {
    handleEodhdError(error)
  }
}

export async function getNews(req: Request, _res: Response) {
  await zParse(getNewsRequestSchema, req)
  // Not covered by the current EODHD plan tier (Fundamentals-gated). See RAD-449.
  throw new NotFoundError('News data is temporarily unavailable')
}

export async function getQuote(req: Request, res: Response) {
  const {
    params: { ticker },
  } = await zParse(getQuoteRequestSchema, req)
  try {
    const quote = await eodhd.getQuote(ticker)
    const price = numeric(quote.close)
    const change = numeric(quote.change)
    const changePercent = roundPercent(numeric(quote.change_p))
    const dto: QuoteResponseDto = {
      change,
      changePercent,
      // EODHD's RealTimeQuote has no currency or company-name field — both
      // require the Fundamentals tier this plan doesn't cover.
      currency: null,
      marketState: null,
      name: null,
      price,
      source: { ...SOURCE_METADATA },
      symbol: readSymbol(quote.code || ticker),
      timestamp: quote.timestamp ? new Date(quote.timestamp * 1000).toISOString() : null,
      volume: numeric(quote.volume),
    }
    return res.json(quoteResponseSchema.parse(dto))
  } catch (error) {
    handleEodhdError(error)
  }
}

export async function searchTicker(req: Request, res: Response) {
  const {
    query: { searchTerm },
  } = await zParse(searchTickerRequestSchema, req)

  // Blank query → empty results (the search box fires before the user types).
  if (!searchTerm) {
    const empty: SearchTickerResponseDto = { results: [], source: { ...SOURCE_METADATA } }
    return res.json(searchTickerResponseSchema.parse(empty))
  }

  try {
    // Row type is inferred (EodhdTypes.SearchResult) rather than annotated
    // explicitly: @wondermoney/shared@8.1.0's bundled .d.ts re-exports the
    // eodhd package's SearchResult *interface* as a namespaced value
    // (`declare const types_SearchResult: typeof SearchResult`), so
    // `EodhdTypes.SearchResult` cannot be referenced in a type position
    // (TS2749). `eodhd.search()`'s own return type is unaffected and
    // correctly infers this shape.
    const results = await eodhd.search(searchTerm)
    const dto: SearchTickerResponseDto = {
      results: results.map((row) => ({
        currency: upperCurrency(row.Currency),
        exchange: stringValue(row.Exchange),
        name: stringValue(row.Name),
        symbol: readSymbol(row.Code),
        // EODHD's search results carry an instrument type (e.g. "Common Stock",
        // "ETF"), unlike FMP's search which never populated it (previously null
        // here). The DTO field was always typed `nullable string`, so this is
        // compatible — just newly populated.
        type: stringValue(row.Type),
      })),
      source: { ...SOURCE_METADATA },
    }
    return res.json(searchTickerResponseSchema.parse(dto))
  } catch (error) {
    handleEodhdError(error)
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
 * Real-time price + daily change for `ticker`, from the exact same EODHD
 * real-time quote call `getQuote` above uses. Shared so company-information
 * (Explorer) and quote (Watchlist) can never derive "current price" from two
 * different provider calls again (RAD-649).
 *
 * Best-effort: a quote hiccup returns nulls rather than throwing, so it
 * doesn't take down the rest of the company-profile response — the caller
 * already resolved that independently via `eodhd.search()`. The frontend
 * knows how to render a null price/changePercentage (RAD-608's last-close
 * fallback), same as it already does for a quote-only failure.
 */
async function fetchQuoteSnapshot(ticker: string): Promise<{ changePercentage: null | number; price: null | number }> {
  try {
    const quote = await eodhd.getQuote(ticker)
    return {
      changePercentage: roundPercent(numeric(quote.change_p)),
      price: numeric(quote.close),
    }
  } catch (error) {
    logger.warn({ error, ticker }, 'Failed to fetch real-time quote for company-information price snapshot')
    return { changePercentage: null, price: null }
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
