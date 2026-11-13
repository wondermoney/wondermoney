import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ getDividends: vi.fn(), getEndOfDayPrices: vi.fn(), getQuote: vi.fn(), getSplits: vi.fn(), search: vi.fn() }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: client }));

import { createEodhdProvider } from '../providers/eodhd.provider';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the EODHD adapter', () => {
  it('passes every call to the EODHD client as before and its answer back untouched', async () => {
    const eodhd = createEodhdProvider();
    const quote = { change: 1, change_p: 0.5, close: 201, code: 'AAPL', gmtoffset: 0, high: 202, low: 199, open: 200, previousClose: 200, timestamp: 1_772_582_400, volume: 10 };
    client.getQuote.mockResolvedValue(quote);
    client.getDividends.mockResolvedValue([{ date: '2026-02-10', value: 0.26 }]);
    client.getSplits.mockResolvedValue([{ date: '2020-08-31', split: '4/1' }]);

    await expect(eodhd.quote?.('AAPL')).resolves.toBe(quote);
    await eodhd.dividends?.('AAPL');
    await eodhd.dividends?.('AAPL', { from: '2026-01-01', to: '2026-05-01' });
    await eodhd.splits?.('AAPL');

    expect(client.getQuote).toHaveBeenCalledWith('AAPL');
    expect(client.getDividends.mock.calls).toEqual([['AAPL'], ['AAPL', { from: '2026-01-01', to: '2026-05-01' }]]);
    expect(client.getSplits.mock.calls).toEqual([['AAPL']]);
  });

  it('asks for an index by EODHD\'s .INDX name', async () => {
    client.getEndOfDayPrices.mockResolvedValue([]);
    const eodhd = createEodhdProvider();

    await eodhd.dailyHistory?.('^GSPC', { from: '2026-01-01' });
    await eodhd.dailyHistory?.('SPY', { from: '2026-01-01' });

    expect(client.getEndOfDayPrices.mock.calls.map(([symbol]) => symbol as string)).toEqual(['GSPC.INDX', 'SPY']);
  });

  it('is set up only with an EODHD key', () => {
    vi.stubEnv('EODHD_API_KEY', '');
    expect(createEodhdProvider().isConfigured()).toBe(false);
    vi.stubEnv('EODHD_API_KEY', 'key');
    expect(createEodhdProvider().isConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });
});
