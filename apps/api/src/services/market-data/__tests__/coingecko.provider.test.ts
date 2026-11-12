import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoinGeckoProvider, parseCryptoPair } from '../providers/coingecko.provider';

import { COINGECKO_MARKET_CHART, COINGECKO_SEARCH, COINGECKO_SIMPLE_PRICE } from './__fixtures__/provider-responses';

const fetchMock = vi.fn<typeof fetch>();
const respond = (body: unknown, init: ResponseInit = {}) => fetchMock.mockResolvedValueOnce(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init }));
const requestedUrl = (call = 0) => new URL(String(fetchMock.mock.calls[call]?.[0]));
const NOW = new Date('2026-03-05T00:00:00Z');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CoinGecko symbols', () => {
  it('reads crypto pairs in the catalogue form, with or without the .CC suffix', () => {
    expect(parseCryptoPair('BTC-USD')).toEqual({ base: 'BTC', quote: 'USD' });
    expect(parseCryptoPair('eth-eur.cc')).toEqual({ base: 'ETH', quote: 'EUR' });
  });

  it('covers no equities and no quote currency it cannot price in', () => {
    const coingecko = createCoinGeckoProvider();
    expect(coingecko.covers('AAPL')).toBe(false);
    expect(coingecko.covers('BRK-B')).toBe(false);
    expect(coingecko.covers('BTC-XYZ')).toBe(false);
    expect(coingecko.covers('BTC-USD.CC')).toBe(true);
  });
});

describe('CoinGecko quote', () => {
  it('parses the simple-price answer, deriving the previous close from the 24-hour change', async () => {
    respond(COINGECKO_SIMPLE_PRICE);
    const quote = await createCoinGeckoProvider().quote?.('BTC-EUR');

    expect(quote).toEqual({ change: 10_000, change_p: 25, close: 50_000, code: 'BTC-EUR', high: null, low: null, open: null, previousClose: 40_000, timestamp: 1_772_582_400, volume: 1_250_000 });
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v3/simple/price');
    expect(url.searchParams.get('ids')).toBe('bitcoin');
    expect(url.searchParams.get('vs_currencies')).toBe('eur');
  });

  it('has no price when the coin is missing from the answer', async () => {
    respond({});
    await expect(createCoinGeckoProvider().quote?.('BTC-USD')).resolves.toMatchObject({ close: null });
  });

  it('finds an unlisted coin by search, picking the most valuable exact symbol match, once', async () => {
    respond(COINGECKO_SEARCH);
    respond({ 'wm-coin': { usd: 2.5 } });
    respond({ 'wm-coin': { usd: 2.75 } });
    const coingecko = createCoinGeckoProvider();

    await expect(coingecko.quote?.('WMC-USD')).resolves.toMatchObject({ close: 2.5 });
    await expect(coingecko.quote?.('WMC-USD')).resolves.toMatchObject({ close: 2.75 });
    expect(requestedUrl(0).pathname).toBe('/api/v3/search');
    expect(requestedUrl(1).searchParams.get('ids')).toBe('wm-coin');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a rate limit with the provider hint', async () => {
    respond('{"status":{"error_code":429}}', { headers: { 'Retry-After': '45' }, status: 429 });
    await expect(createCoinGeckoProvider().quote?.('BTC-USD')).rejects.toMatchObject({ code: 'rate_limit', provider: 'coingecko', retryAfter: 45 });
  });

  it('reports a body that is not JSON as a parse failure', async () => {
    respond('<html>');
    await expect(createCoinGeckoProvider().quote?.('BTC-USD')).rejects.toMatchObject({ code: 'parse_error' });
  });
});

describe('CoinGecko daily history', () => {
  it('keeps the last price of each UTC day', async () => {
    respond(COINGECKO_MARKET_CHART);
    const bars = await createCoinGeckoProvider({ now: () => NOW }).dailyHistory?.('BTC-USD', { from: '2026-03-03', to: '2026-03-04' });

    expect(bars).toEqual([
      { adjusted_close: 41_000, close: 41_000, date: '2026-03-03', high: null, low: null, open: null, volume: 950 },
      { adjusted_close: 42_000.5, close: 42_000.5, date: '2026-03-04', high: null, low: null, open: null, volume: 1000 },
    ]);
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v3/coins/bitcoin/market_chart/range');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: String(Date.parse('2026-03-03T00:00:00Z') / 1000), to: String(Date.parse('2026-03-04T23:59:59Z') / 1000), vs_currency: 'usd' });
  });

  it('asks no further back than the keyless tier serves', async () => {
    respond({ prices: [] });
    await createCoinGeckoProvider({ now: () => NOW }).dailyHistory?.('BTC-USD', { from: '2020-01-01' });

    const from = Number(requestedUrl().searchParams.get('from'));
    expect(NOW.getTime() / 1000 - from).toBeLessThanOrEqual(365 * 86_400);
  });

  it('reports an answer without prices as a parse failure', async () => {
    respond({ error: 'coin not found' });
    await expect(createCoinGeckoProvider({ now: () => NOW }).dailyHistory?.('BTC-USD', { from: '2026-03-01' })).rejects.toMatchObject({ code: 'parse_error' });
  });
});

describe('CoinGecko search', () => {
  it('returns coins as catalogue matches, most valuable first', async () => {
    respond(COINGECKO_SEARCH);
    const matches = await createCoinGeckoProvider().search?.('wmcoin');

    expect(matches?.map((match) => [match.Code, match.Name, match.Exchange, match.Currency, match.Type])).toEqual([
      ['WMC-USD', 'WM Coin', 'CC', 'USD', 'Crypto'],
      ['WMC-USD', 'Small WM Coin', 'CC', 'USD', 'Crypto'],
      ['WMO-USD', 'WM Other', 'CC', 'USD', 'Crypto'],
    ]);
    expect(requestedUrl().searchParams.get('query')).toBe('wmcoin');
  });
});
