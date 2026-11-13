import { MarketDataProviderError } from '../errors';

import { dayStartSeconds, getText } from './http';
import type { DailyBar, DateRange, MarketDataProvider, MarketQuote } from './types';

/**
 * Stooq's free daily CSV (`stooq.com/q/d/l/`): end-of-day prices for US, UK, German and Japanese
 * listings and the main US indices, without a key. It has no search, dividends or splits, and no
 * intraday quote: the quote is the latest daily close, against the close before it.
 *
 * Opt-in only (`MARKET_DATA_PROVIDERS`). Stooq's terms are the operator's to accept.
 */
const BASE_URL = 'https://stooq.com/q/d/l/';

/** EODHD exchange suffixes (the symbol form the catalogue uses) to Stooq's market suffixes. */
const MARKET_SUFFIXES: Readonly<Record<string, string>> = {
  LSE: 'uk',
  TSE: 'jp',
  US: 'us',
  XETRA: 'de',
};

/** Index symbols, in the caret form benchmarks use and in EODHD's `.INDX` form. */
const INDICES: Readonly<Record<string, string>> = {
  DJI: '^dji',
  GSPC: '^spx',
  IXIC: '^ndq',
  NDX: '^ndx',
};

/** A quote reads the latest close and the one before it, so it asks for the last two weeks. */
const QUOTE_LOOKBACK_DAYS = 14;

/** Crypto pairs (`BTC-USD`, `ETH-EUR.CC`) are CoinGecko's, not Stooq's. */
const CRYPTO_PAIR = /^[A-Z0-9]+-[A-Z]{3}(?:\.CC)?$/u;

export function createStooqProvider(deps: { now?: () => Date } = {}): MarketDataProvider {
  const now = deps.now ?? (() => new Date());
  const fetchBars = async (symbol: string, range: DateRange): Promise<DailyBar[]> => {
    const stooqSymbol = toStooqSymbol(symbol);
    if (!stooqSymbol) return [];
    const params = new URLSearchParams({ i: 'd', s: stooqSymbol });
    if (range.from) params.set('d1', range.from.replaceAll('-', ''));
    if (range.to) params.set('d2', range.to.replaceAll('-', ''));
    return parseStooqDailyCsv(await getText('stooq', `${BASE_URL}?${params.toString()}`, 'text/csv'));
  };
  return {
    capabilities: ['quote', 'dailyHistory'],
    covers: (symbol) => toStooqSymbol(symbol) !== null,
    dailyHistory: async (symbol, range) => (await fetchBars(symbol, range)).filter((bar) => (!range.from || bar.date >= range.from) && (!range.to || bar.date <= range.to)),
    id: 'stooq',
    isConfigured: () => true,
    label: 'Stooq',
    quote: async (symbol) => {
      const today = now();
      const from = new Date(today.getTime() - QUOTE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
      return quoteFromBars(symbol, await fetchBars(symbol, { from, to: today.toISOString().slice(0, 10) }));
    },
  };
}

/** The Stooq symbol for a catalogue symbol, or null when Stooq does not list its market. */
export function toStooqSymbol(symbol: string): null | string {
  const upper = symbol.trim().toUpperCase();
  if (upper.startsWith('^')) return INDICES[upper.slice(1)] ?? null;
  if (upper.endsWith('.INDX')) return INDICES[upper.slice(0, -'.INDX'.length)] ?? null;
  if (CRYPTO_PAIR.test(upper)) return null;
  // A ticker, optionally with a share-class suffix (`BRK-B`), then EODHD's exchange suffix.
  const match = /^([A-Z0-9]{1,10}(?:-[A-Z]{1,2})?)(?:\.([A-Z]+))?$/u.exec(upper);
  if (!match) return null;
  const [, code, exchange = 'US'] = match;
  const market = MARKET_SUFFIXES[exchange];
  return code && market ? `${code.toLowerCase()}.${market}` : null;
}

/**
 * Parse Stooq's daily CSV (`Date,Open,High,Low,Close[,Volume]`, oldest first) into bars. "No data"
 * is Stooq's answer for a symbol it does not have; a daily-limit notice is its rate limit.
 */
export function parseStooqDailyCsv(body: string): DailyBar[] {
  const text = body.replace(/^\ufeff/u, '').trim();
  if (text === '' || /^no data/iu.test(text)) return [];
  if (/exceeded the daily hits limit/iu.test(text)) throw new MarketDataProviderError('stooq', 'rate_limit', 'Daily request limit reached');
  const [headerLine = '', ...lines] = text.split(/\r?\n/u);
  const header = headerLine.split(',').map((cell) => cell.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const [date, open, high, low, close, volume] = [column('date'), column('open'), column('high'), column('low'), column('close'), column('volume')];
  if (date === -1 || close === -1) throw new MarketDataProviderError('stooq', 'parse_error', 'Unexpected CSV header');
  const bars: DailyBar[] = [];
  for (const line of lines) {
    const cells = line.split(',').map((cell) => cell.trim());
    const day = cells[date] ?? '';
    const closeValue = toNumber(cells[close]);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || closeValue === null) continue;
    bars.push({
      adjusted_close: closeValue,
      close: closeValue,
      date: day,
      high: toNumber(cells[high]),
      low: toNumber(cells[low]),
      open: toNumber(cells[open]),
      volume: toNumber(cells[volume]),
    });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

/** The quote a run of daily bars implies: the last close, and its change from the one before. */
export function quoteFromBars(symbol: string, bars: readonly DailyBar[]): MarketQuote {
  const last = bars.at(-1);
  const previous = bars.length > 1 ? bars.at(-2) : undefined;
  const change = last && previous ? last.close - previous.close : null;
  return {
    change,
    change_p: change !== null && previous && previous.close !== 0 ? (change / previous.close) * 100 : null,
    close: last?.close ?? null,
    code: symbol,
    high: last?.high ?? null,
    low: last?.low ?? null,
    open: last?.open ?? null,
    previousClose: previous?.close ?? null,
    // A daily close is stamped at 00:00 UTC of its day, as history rows are.
    timestamp: last ? dayStartSeconds(last.date) : null,
    volume: last?.volume ?? null,
  };
}

function toNumber(value: string | undefined): null | number {
  if (value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
