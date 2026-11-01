import type { HistoricalPricePeriod, ScreenerFilters } from './markets-contract'

const marketsRootKey = (epochId: number) => ['markets', epochId] as const

export const tickerSearchKey = (epochId: number, searchTerm: string) =>
  [...marketsRootKey(epochId), 'search', searchTerm] as const

export const quoteKey = (epochId: number, symbol: string) =>
  [...marketsRootKey(epochId), 'quote', symbol] as const

export const companyInfoKey = (epochId: number, symbol: string) =>
  [...marketsRootKey(epochId), 'company-info', symbol] as const

export const historicalPriceKey = (epochId: number, symbol: string, period: HistoricalPricePeriod) =>
  [...marketsRootKey(epochId), 'historical-price', symbol, period] as const

export const watchlistKey = (epochId: number) =>
  [...marketsRootKey(epochId), 'watchlist'] as const

export const fundamentalsKey = (epochId: number, symbol: string) =>
  [...marketsRootKey(epochId), 'fundamentals', symbol] as const

export const financialsKey = (epochId: number, symbol: string) =>
  [...marketsRootKey(epochId), 'financials', symbol] as const

export const earningsKey = (epochId: number, symbol: string) =>
  [...marketsRootKey(epochId), 'earnings', symbol] as const

/**
 * Every filter plus page and limit are folded into the
 * key (rather than fetched via `useInfiniteQuery`, which would key only by
 * filters): the screener hook fetches one page at a time, like `useQuote`
 * fetches one symbol, so each page needs its own cache entry.
 */
export const screenerKey = (epochId: number, filters: ScreenerFilters) =>
  [
    ...marketsRootKey(epochId),
    'screener',
    filters.isEtf,
    filters.isActivelyTrading,
    filters.priceMoreThan ?? null,
    filters.priceLowerThan ?? null,
    filters.marketCapMoreThan ?? null,
    filters.marketCapLowerThan ?? null,
    filters.sector ?? null,
    filters.industry ?? null,
    filters.country ?? null,
    filters.exchange ?? null,
    filters.page,
    filters.limit,
  ] as const
