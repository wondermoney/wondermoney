import { MarketDataProviderError } from '../errors';

import { getJson, utcDay } from './http';
import type { DailyBar, DateRange, MarketDataProvider, MarketQuote, SecurityMatch } from './types';

/**
 * CoinGecko's public API (`api.coingecko.com/api/v3`), keyless: crypto search, latest prices and
 * daily history for pairs written `BTC-USD` or `BTC-USD.CC` (EODHD's form). The keyless tier has a
 * low request budget and serves at most the last 365 days of history.
 *
 * Opt-in only (`MARKET_DATA_PROVIDERS`). CoinGecko's terms are the operator's to accept.
 */
const BASE_URL = 'https://api.coingecko.com/api/v3';

/** The currencies the app keeps exchange rates for, which CoinGecko also quotes in. */
const QUOTE_CURRENCIES = new Set(['AUD', 'BRL', 'CAD', 'CHF', 'DKK', 'EUR', 'GBP', 'JPY', 'NOK', 'SEK', 'USD']);

/** Well-known coins, so the common case needs no lookup. Anything else is found by search. */
const KNOWN_COINS: Readonly<Record<string, string>> = {
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  BCH: 'bitcoin-cash',
  BNB: 'binancecoin',
  BTC: 'bitcoin',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  ETC: 'ethereum-classic',
  ETH: 'ethereum',
  LINK: 'chainlink',
  LTC: 'litecoin',
  SOL: 'solana',
  USDC: 'usd-coin',
  USDT: 'tether',
  XLM: 'stellar',
  XMR: 'monero',
  XRP: 'ripple',
};

/** The keyless tier answers history up to a year back. */
const HISTORY_LIMIT_DAYS = 365;
const SEARCH_RESULT_LIMIT = 10;

export interface CryptoPair {
  base: string;
  quote: string;
}

interface SearchCoin {
  id: string;
  market_cap_rank: null | number;
  name: string;
  symbol: string;
}

export function createCoinGeckoProvider(deps: { now?: () => Date } = {}): MarketDataProvider {
  const now = deps.now ?? (() => new Date());
  const coinIds = new Map<string, null | string>(Object.entries(KNOWN_COINS));

  const searchCoins = async (query: string) => parseSearchCoins(await getJson('coingecko', `${BASE_URL}/search?${new URLSearchParams({ query }).toString()}`));

  /** The CoinGecko id of a coin symbol: the known list, else the most valuable exact match. */
  const coinId = async (base: string): Promise<null | string> => {
    if (coinIds.has(base)) return coinIds.get(base) ?? null;
    const match = (await searchCoins(base)).find((coin) => coin.symbol === base);
    const id = match?.id ?? null;
    coinIds.set(base, id);
    return id;
  };

  return {
    capabilities: ['search', 'quote', 'dailyHistory'],
    covers: (symbol) => parseCryptoPair(symbol) !== null,
    async dailyHistory(symbol: string, range: DateRange): Promise<DailyBar[]> {
      const pair = parseCryptoPair(symbol);
      const id = pair ? await coinId(pair.base) : null;
      if (!pair || !id) return [];
      const nowSeconds = Math.floor(now().getTime() / 1000);
      const earliest = nowSeconds - HISTORY_LIMIT_DAYS * 86_400 + 3600;
      const from = Math.max(earliest, range.from ? Date.parse(`${range.from}T00:00:00Z`) / 1000 : earliest);
      const to = Math.min(nowSeconds, range.to ? Date.parse(`${range.to}T23:59:59Z`) / 1000 : nowSeconds);
      if (from > to) return [];
      const params = new URLSearchParams({ from: String(from), to: String(to), vs_currency: pair.quote.toLowerCase() });
      const bars = parseMarketChart(await getJson('coingecko', `${BASE_URL}/coins/${encodeURIComponent(id)}/market_chart/range?${params.toString()}`));
      return bars.filter((bar) => (!range.from || bar.date >= range.from) && (!range.to || bar.date <= range.to));
    },
    id: 'coingecko',
    isConfigured: () => true,
    label: 'CoinGecko',
    async quote(symbol: string): Promise<MarketQuote> {
      const pair = parseCryptoPair(symbol);
      const id = pair ? await coinId(pair.base) : null;
      if (!pair || !id) return parseSimplePrice({}, symbol, '', 'usd');
      const params = new URLSearchParams({ ids: id, include_24hr_change: 'true', include_24hr_vol: 'true', include_last_updated_at: 'true', vs_currencies: pair.quote.toLowerCase() });
      return parseSimplePrice(await getJson('coingecko', `${BASE_URL}/simple/price?${params.toString()}`), symbol, id, pair.quote);
    },
    async search(query: string): Promise<SecurityMatch[]> {
      return (await searchCoins(query)).slice(0, SEARCH_RESULT_LIMIT).map((coin) => ({
        Code: `${coin.symbol}-USD`,
        Country: '',
        Currency: 'USD',
        Exchange: 'CC',
        ISIN: '',
        Name: coin.name,
        Type: 'Crypto',
      }));
    },
  };
}

/** `BTC-USD` or `BTC-USD.CC` → `{ base: 'BTC', quote: 'USD' }`; null for anything else. */
export function parseCryptoPair(symbol: string): CryptoPair | null {
  const match = /^([A-Z0-9]+)-([A-Z]{3})(?:\.CC)?$/u.exec(symbol.trim().toUpperCase());
  if (!match?.[1] || !match[2] || !QUOTE_CURRENCIES.has(match[2])) return null;
  return { base: match[1], quote: match[2] };
}

/** The coins of a `/search` answer, most valuable first. */
export function parseSearchCoins(body: unknown): SearchCoin[] {
  const coins = isRecord(body) && Array.isArray(body['coins']) ? body['coins'] : null;
  if (!coins) throw new MarketDataProviderError('coingecko', 'parse_error', 'Search answer has no coins');
  return coins
    .filter(isRecord)
    .flatMap((coin) => {
      const { id, market_cap_rank: rank, name, symbol } = coin;
      if (typeof id !== 'string' || typeof symbol !== 'string' || typeof name !== 'string') return [];
      return [{ id, market_cap_rank: typeof rank === 'number' ? rank : null, name, symbol: symbol.toUpperCase() }];
    })
    .sort((a, b) => (a.market_cap_rank ?? Number.MAX_SAFE_INTEGER) - (b.market_cap_rank ?? Number.MAX_SAFE_INTEGER));
}

/** A `/simple/price` answer for one coin as a quote; a quote without a price when it is absent. */
export function parseSimplePrice(body: unknown, symbol: string, coinId: string, quoteCurrency: string): MarketQuote {
  if (!isRecord(body)) throw new MarketDataProviderError('coingecko', 'parse_error', 'Price answer is not an object');
  const entry = body[coinId];
  const vs = quoteCurrency.toLowerCase();
  const field = (name: string) => (isRecord(entry) && typeof entry[name] === 'number' && Number.isFinite(entry[name]) ? entry[name] : null);
  const close = field(vs);
  const changePercent = field(`${vs}_24h_change`);
  const previousClose = close !== null && changePercent !== null && changePercent !== -100 ? close / (1 + changePercent / 100) : null;
  return {
    change: close !== null && previousClose !== null ? close - previousClose : null,
    change_p: changePercent,
    close,
    code: symbol,
    high: null,
    low: null,
    open: null,
    previousClose,
    timestamp: field('last_updated_at'),
    volume: field(`${vs}_24h_vol`),
  };
}

/**
 * A `/market_chart/range` answer as one bar per UTC day: the day's last price, and the day's last
 * 24-hour volume. CoinGecko trades around the clock, so there is no open, high or low here.
 */
export function parseMarketChart(body: unknown): DailyBar[] {
  if (!isRecord(body) || !Array.isArray(body['prices'])) throw new MarketDataProviderError('coingecko', 'parse_error', 'Chart answer has no prices');
  const lastByDay = (series: unknown): Map<string, number> => {
    const byDay = new Map<string, { at: number; value: number }>();
    for (const point of Array.isArray(series) ? series : []) {
      if (!Array.isArray(point)) continue;
      const [at, value] = point;
      if (typeof at !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue;
      const day = utcDay(at);
      const current = byDay.get(day);
      if (!current || at >= current.at) byDay.set(day, { at, value });
    }
    return new Map([...byDay].map(([day, { value }]) => [day, value]));
  };
  const prices = lastByDay(body['prices']);
  const volumes = lastByDay(body['total_volumes']);
  return [...prices]
    .map(([date, close]) => ({ adjusted_close: close, close, date, high: null, low: null, open: null, volume: volumes.get(date) ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
