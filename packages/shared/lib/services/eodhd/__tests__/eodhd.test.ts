import { EODHDAuthError, EODHDClient, EODHDRateLimitError } from 'eodhd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Eodhd, EodhdError } from '../index';

vi.mock('eodhd', async () => {
  const actual = await vi.importActual<typeof import('eodhd')>('eodhd');
  return {
    ...actual,
    EODHDClient: vi.fn(),
  };
});

describe('Eodhd', () => {
  const originalEnv = process.env.EODHD_API_KEY;

  beforeEach(() => {
    process.env.EODHD_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.EODHD_API_KEY = originalEnv;
    vi.clearAllMocks();
  });

  it('throws EodhdError with code NO_API_KEY when no key is configured and none is in env', () => {
    delete process.env.EODHD_API_KEY;
    expect(() => new Eodhd({})).toThrowError(EodhdError);
    try {
      new Eodhd({});
    } catch (error) {
      expect((error as EodhdError).code).toBe('NO_API_KEY');
    }
  });

  it('constructs the underlying EODHDClient with the configured apiKey as apiToken', () => {
    new Eodhd({ apiKey: 'explicit-key' });
    expect(EODHDClient).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'explicit-key' }));
  });

  it('falls back to process.env.EODHD_API_KEY when no apiKey is passed', () => {
    new Eodhd({});
    expect(EODHDClient).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'test-key' }));
  });

  it('getEndOfDayPrices delegates to client.eod and returns its result', async () => {
    const eod = vi.fn().mockResolvedValue([{ close: 185.64, date: '2026-01-02' }]);
    (EODHDClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ eod }));

    const client = new Eodhd({ apiKey: 'test-key' });
    const result = await client.getEndOfDayPrices('AAPL.US', { from: '2026-01-01' });

    expect(eod).toHaveBeenCalledWith('AAPL.US', { from: '2026-01-01' });
    expect(result).toEqual([{ close: 185.64, date: '2026-01-02' }]);
  });

  it('wraps a thrown EODHDError into EodhdError, preserving code/status/original', async () => {
    const upstream = new EODHDAuthError('bad token', 401);
    const eod = vi.fn().mockRejectedValue(upstream);
    (EODHDClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ eod }));

    const client = new Eodhd({ apiKey: 'test-key' });
    await expect(client.getEndOfDayPrices('AAPL.US')).rejects.toMatchObject({
      code: 'auth_error',
      name: 'EodhdError',
      original: upstream,
      status: 401,
    });
  });

  it('carries retryAfter through from an EODHDRateLimitError', async () => {
    const upstream = new EODHDRateLimitError('slow down', 42);
    const search = vi.fn().mockRejectedValue(upstream);
    (EODHDClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ search }));

    const client = new Eodhd({ apiKey: 'test-key' });
    await expect(client.search('Apple')).rejects.toMatchObject({ retryAfter: 42 });
  });

  it('getScreener delegates to client.screener and unwraps the data array', async () => {
    const screener = vi.fn().mockResolvedValue({
      data: [{ code: 'AAPL.US', exchange: 'US', industry: 'Consumer Electronics', market_capitalization: 2_800_000_000_000, name: 'Apple Inc.', sector: 'Technology' }],
      meta: { limit: 5, offset: 0, total: 1 },
    });
    (EODHDClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ screener }));

    const client = new Eodhd({ apiKey: 'test-key' });
    const params = { filters: '[["market_capitalization",">",1000000000]]', limit: 5, sort: 'market_capitalization.desc' };
    const result = await client.getScreener(params);

    expect(screener).toHaveBeenCalledWith(params);
    expect(result).toEqual([
      { code: 'AAPL.US', exchange: 'US', industry: 'Consumer Electronics', market_capitalization: 2_800_000_000_000, name: 'Apple Inc.', sector: 'Technology' },
    ]);
  });
});
