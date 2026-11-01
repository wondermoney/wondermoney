import type { CompanyInformationDto, EarningsEntryDto, FinancialsEntryDto, FundamentalsResponseDto, HistoricalPricePointDto, QuoteResponseDto, ScreenerEntryDto, TickerSearchResultDto } from './markets-contract'

/**
 * Projection-only view models, mirroring
 * institutions-view-model's convention: same fields the contract returns,
 * nothing added or renamed.
 */
export type SearchResultRow = Readonly<{
  currency: string | null
  exchange: string | null
  name: string | null
  symbol: string
  type: string | null
}>

function asSearchResultRow(dto: TickerSearchResultDto): SearchResultRow {
  return {
    currency: dto.currency,
    exchange: dto.exchange,
    name: dto.name,
    symbol: dto.symbol,
    type: dto.type,
  }
}

export function mapSearchResults(dtos: readonly TickerSearchResultDto[]): readonly SearchResultRow[] {
  return dtos.map(asSearchResultRow)
}

export type QuoteViewModel = Readonly<QuoteResponseDto>

export const mapQuote = (dto: QuoteResponseDto): QuoteViewModel => ({ ...dto })

/**
 * `/quote`'s name/currency are always null (see markets-contract.ts's companyInformationSchema
 * comment); this merges in the real values from `/info` without touching any other field, so
 * price/change/volume/marketState still come from the live quote.
 */
export function mergeCompanyInfo(quote: QuoteViewModel, companyInfo: CompanyInformationDto | null): QuoteViewModel {
  if (!companyInfo) return quote
  return {
    ...quote,
    name: quote.name ?? companyInfo.name,
    currency: quote.currency ?? companyInfo.currency,
  }
}

export type AssetPriceChartPoint = Readonly<{ x: number; value: number }>

export function mapHistoricalPrice(points: readonly HistoricalPricePointDto[]): readonly AssetPriceChartPoint[] {
  return points
    .filter((point): point is HistoricalPricePointDto & { close: number } => point.close !== null)
    .map((point, index) => ({ x: index, value: point.close }))
}

export function formatAsOfTimestamp(value: string | null, locale: string, unavailable: string): string {
  if (value === null) return unavailable
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/** Positive values get an explicit "+"; negatives already carry Intl's native minus sign. */
export const signPrefix = (value: number): string => (value > 0 ? '+' : '')

export function formatDateOnly(value: string | null, locale: string, unavailable: string): string {
  if (value === null) return unavailable
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return unavailable
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

/** Projection-only view model, same convention as QuoteViewModel: nothing added or renamed. */
export type FundamentalsViewModel = Readonly<FundamentalsResponseDto>

export const mapFundamentals = (dto: FundamentalsResponseDto): FundamentalsViewModel => ({ ...dto })

/** Last 5 reporting periods, reversed then sliced, mirroring the web client's selector. */
export type FinancialsChartPoint = Readonly<{
  period: string
  revenue: number | null
  netIncome: number | null
}>

export function mapFinancialsChart(entries: readonly FinancialsEntryDto[]): readonly FinancialsChartPoint[] {
  return entries.slice().reverse().slice(0, 5).map((entry) => ({
    period: entry.period ?? '',
    revenue: entry.revenue,
    netIncome: entry.netIncome,
  }))
}

/**
 * Last 6 quarters, reversed then sliced, mirroring the web client's selector. The
 * earnings `date` is the report date, which typically lands one quarter after the quarter it
 * covers, so the label shifts back 3 months before reading the quarter/year — same rule as the
 * web client's `subQuarters(date, 1)`, reimplemented without a date-fns dependency (mobile has
 * none, see report-date-presets.ts).
 */
export type EarningsChartPoint = Readonly<{
  quarter: string
  actual: number | null
  estimated: number | null
}>

function quarterLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  const shiftedMonth = parsed.getUTCMonth() - 3
  const shifted = new Date(Date.UTC(parsed.getUTCFullYear(), shiftedMonth, 1))
  const quarter = Math.floor(shifted.getUTCMonth() / 3) + 1
  const yearSuffix = String(shifted.getUTCFullYear()).slice(-2)
  return `Q${quarter} ${yearSuffix}`
}

export function mapEarningsChart(entries: readonly EarningsEntryDto[]): readonly EarningsChartPoint[] {
  return entries.slice().reverse().slice(0, 6).map((entry) => ({
    quarter: entry.date ? quarterLabel(entry.date) : '-',
    actual: entry.eps,
    estimated: entry.epsEstimated,
  }))
}

/**
 * One row per watchlisted symbol, decoupled from
 * react-query's `UseQueryResult` shape so this stays a plain, pure mapper.
 * A missing or still-pending quote result never hides the symbol: the row
 * stays present in a 'loading' or 'error' state so one bad per-symbol quote
 * fetch cannot blank an otherwise-successful list load.
 */
export type WatchlistRow = Readonly<{
  symbol: string
  quote: QuoteViewModel | null
  quoteStatus: 'loading' | 'loaded' | 'error'
}>

export type WatchlistQuoteResult = Readonly<{
  data: QuoteResponseDto | undefined
  isPending: boolean
  isError: boolean
}>

export function buildWatchlistRows(
  symbols: readonly string[],
  quoteResults: readonly WatchlistQuoteResult[],
): readonly WatchlistRow[] {
  return symbols.map((symbol, index) => {
    const result = quoteResults[index]
    if (!result || result.isPending) return { symbol, quote: null, quoteStatus: 'loading' }
    if (result.data) return { symbol, quote: mapQuote(result.data), quoteStatus: 'loaded' }
    return { symbol, quote: null, quoteStatus: 'error' }
  })
}

/**
 * The screener only filters and renders sector, price,
 * and market cap, so the row only carries those fields: beta, dividend
 * yield, PE ratio, volume, country, and industry stay unused here even
 * though the contract (and the API response) still carries them.
 */
export type ScreenerRow = Readonly<{
  marketCap: number | null
  name: string | null
  price: number | null
  sector: string | null
  symbol: string
}>

function asScreenerRow(dto: ScreenerEntryDto): ScreenerRow {
  return {
    marketCap: dto.marketCap,
    name: dto.name,
    price: dto.price,
    sector: dto.sector,
    symbol: dto.symbol,
  }
}

export function mapScreenerResults(dtos: readonly ScreenerEntryDto[]): readonly ScreenerRow[] {
  return dtos.map(asScreenerRow)
}

/** No currency accompanies screener prices, so this is a plain formatted number, not formatCurrency. */
export function formatScreenerPrice(price: number | null, locale: string, unavailable: string): string {
  if (price === null) return unavailable
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price)
}

/** Compact notation (e.g. "3T") keeps large market caps readable in a narrow row. */
export function formatScreenerMarketCap(marketCap: number | null, locale: string, unavailable: string): string {
  if (marketCap === null) return unavailable
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(marketCap)
}
