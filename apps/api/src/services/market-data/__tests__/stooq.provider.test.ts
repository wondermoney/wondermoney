import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketDataProviderError } from '../errors';
import { createStooqProvider, toStooqSymbol } from '../providers/stooq.provider';

import { STOOQ_DAILY_CSV, STOOQ_INDEX_CSV, STOOQ_LIMIT_REACHED, STOOQ_NO_DATA } from './__fixtures__/provider-responses';

const fetchMock = vi.fn<typeof fetch>();
const respond = (body: string, init: ResponseInit = {}) => fetchMock.mockResolvedValueOnce(new Response(body, { status: 200, ...init }));
const requestedUrl = (call = 0) => new URL(String(fetchMock.mock.calls[call]?.[0]));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Stooq symbols', () => {
  it('maps catalogue symbols onto the Stooq markets it lists', () => {
    expect(toStooqSymbol('AAPL')).toBe('aapl.us');
    expect(toStooqSymbol('BRK-B')).toBe('brk-b.us');
    expect(toStooqSymbol('MSFT.US')).toBe('msft.us');
    expect(toStooqSymbol('VOD.LSE')).toBe('vod.uk');
    expect(toStooqSymbol('SAP.XETRA')).toBe('sap.de');
    expect(toStooqSymbol('7203.TSE')).toBe('7203.jp');
    expect(toStooqSymbol('^GSPC')).toBe('^spx');
    expect(toStooqSymbol('GSPC.INDX')).toBe('^spx');
  });

  it('leaves out what Stooq does not list: other markets, crypto pairs, unknown indices', () => {
    expect(toStooqSymbol('SHOP.TO')).toBeNull();
    expect(toStooqSymbol('BTC-USD')).toBeNull();
    expect(toStooqSymbol('ETH-EUR.CC')).toBeNull();
    expect(toStooqSymbol('^STOXX50E')).toBeNull();
    expect(toStooqSymbol('CA-SERIE-E')).toBeNull();
  });

  it('covers only the symbols it can map', () => {
    const stooq = createStooqProvider();
    expect(stooq.covers('AAPL')).toBe(true);
    expect(stooq.covers('BTC-USD')).toBe(false);
  });
});

describe('Stooq daily history', () => {
  it('parses the daily CSV into bars, oldest first, within the asked range', async () => {
    respond(STOOQ_DAILY_CSV);
    const bars = await createStooqProvider().dailyHistory?.('VOD.LSE', { from: '2026-03-03', to: '2026-03-04' });

    expect(bars).toEqual([
      { adjusted_close: 103, close: 103, date: '2026-03-03', high: 103.5, low: 100, open: 101.25, volume: 98_000 },
      { adjusted_close: 102, close: 102, date: '2026-03-04', high: 103.25, low: 101, open: 103, volume: 87_500 },
    ]);
    const url = requestedUrl();
    expect(url.origin + url.pathname).toBe('https://stooq.com/q/d/l/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ d1: '20260303', d2: '20260304', i: 'd', s: 'vod.uk' });
  });

  it('reads an index CSV, which has no volume column', async () => {
    respond(STOOQ_INDEX_CSV);
    const bars = await createStooqProvider().dailyHistory?.('^GSPC', { from: '2026-03-01' });

    expect(bars?.map((bar) => [bar.date, bar.close, bar.volume])).toEqual([['2026-03-03', 5040.5, null], ['2026-03-04', 5020, null]]);
    expect(requestedUrl().searchParams.get('s')).toBe('^spx');
  });

  it('has nothing for a symbol Stooq does not know, and asks nothing for one it cannot map', async () => {
    respond(STOOQ_NO_DATA);
    await expect(createStooqProvider().dailyHistory?.('ZZZZ', {})).resolves.toEqual([]);
    await expect(createStooqProvider().dailyHistory?.('SHOP.TO', {})).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the daily limit and HTTP failures as provider errors', async () => {
    respond(STOOQ_LIMIT_REACHED);
    await expect(createStooqProvider().dailyHistory?.('AAPL', {})).rejects.toMatchObject({ code: 'rate_limit', provider: 'stooq' });

    respond('busy', { headers: { 'Retry-After': '120' }, status: 429 });
    await expect(createStooqProvider().dailyHistory?.('AAPL', {})).rejects.toMatchObject({ code: 'rate_limit', retryAfter: 120 });

    respond('down', { status: 503 });
    await expect(createStooqProvider().dailyHistory?.('AAPL', {})).rejects.toMatchObject({ code: 'server_error', status: 503 });

    respond('<html>maintenance</html>');
    await expect(createStooqProvider().dailyHistory?.('AAPL', {})).rejects.toBeInstanceOf(MarketDataProviderError);

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(createStooqProvider().dailyHistory?.('AAPL', {})).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('Stooq quote', () => {
  it('is the latest close, with its change from the close before', async () => {
    respond(STOOQ_DAILY_CSV);
    const quote = await createStooqProvider({ now: () => new Date('2026-03-05T10:00:00Z') }).quote?.('AAPL');

    expect(quote).toEqual({
      change: -1,
      change_p: expect.closeTo(-0.9709, 4) as number,
      close: 102,
      code: 'AAPL',
      high: 103.25,
      low: 101,
      open: 103,
      previousClose: 103,
      timestamp: Date.parse('2026-03-04T00:00:00Z') / 1000,
      volume: 87_500,
    });
    expect(Object.fromEntries(requestedUrl().searchParams)).toMatchObject({ d1: '20260219', d2: '20260305', s: 'aapl.us' });
  });

  it('has no price when Stooq has no data', async () => {
    respond(STOOQ_NO_DATA);
    await expect(createStooqProvider().quote?.('AAPL')).resolves.toMatchObject({ close: null, timestamp: null });
  });
});
