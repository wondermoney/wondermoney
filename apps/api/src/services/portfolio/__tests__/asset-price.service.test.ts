import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';

const emMocks = vi.hoisted(() => ({
  getKysely: vi.fn(),
  upsert: vi.fn(),
}));
const eodhdMocks = vi.hoisted(() => ({
  getEndOfDayPrices: vi.fn(),
  getQuote: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: emMocks } }));
vi.mock('@service/market-data/eodhd.service', () => ({
  default: {
    getEndOfDayPrices: eodhdMocks.getEndOfDayPrices,
    getQuote: eodhdMocks.getQuote,
  },
}));

import { DI } from '@app/database/di';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';

import assetPriceService from '../asset-price.service';

const mockedEm = DI.em as unknown as typeof emMocks;
const mockedGetQuote = eodhdMocks.getQuote;
const mockedGetEndOfDayPrices = eodhdMocks.getEndOfDayPrices;

describe('fetchAndSaveAssetPrice', () => {
  const financialAsset = { financialAssetKey: 7, symbol: 'AAPL' } as FinancialAsset;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts price data and returns the upserted entity', async () => {
    const returned = { ok: true } as unknown as FinancialAssetPrice;
    mockedGetQuote.mockResolvedValueOnce({
      change: 1.11,
      change_p: 0.91,
      close: 123.45,
      code: 'AAPL',
      gmtoffset: 0,
      high: 124,
      low: 122,
      open: 122.5,
      previousClose: 122.34,
      timestamp: 1714521600,
      volume: 6789,
    });
    mockedEm.upsert.mockResolvedValueOnce(returned);

    const result = await assetPriceService.fetchAndSaveAssetPrice(financialAsset);

    expect(mockedEm.upsert).toHaveBeenCalledTimes(1);
    expect(mockedEm.upsert).toHaveBeenCalledWith(FinancialAssetPrice, {
      date: new Date(1714521600 * 1000),
      financialAssetKey: financialAsset,
      price: 123.45,
      volume: 6789,
    });
    expect(result).toBe(returned);
  });

  it('can upsert repeated provider data for the same asset/date', async () => {
    const firstReturned = { pass: 1 } as unknown as FinancialAssetPrice;
    const secondReturned = { pass: 2 } as unknown as FinancialAssetPrice;
    mockedGetQuote
      .mockResolvedValueOnce({
        change: 1.11,
        change_p: 0.91,
        close: 123.45,
        code: 'AAPL',
        gmtoffset: 0,
        high: 124,
        low: 122,
        open: 122.5,
        previousClose: 122.34,
        timestamp: 1714521600,
        volume: 6789,
      })
      .mockResolvedValueOnce({
        change: 2.22,
        change_p: 1.01,
        close: 222.33,
        code: 'AAPL',
        gmtoffset: 0,
        high: 223,
        low: 221,
        open: 221.5,
        previousClose: 220.11,
        timestamp: 1714521600,
        volume: 4444,
      });
    mockedEm.upsert.mockResolvedValueOnce(firstReturned).mockResolvedValueOnce(secondReturned);

    const first = await assetPriceService.fetchAndSaveAssetPrice(financialAsset);
    const second = await assetPriceService.fetchAndSaveAssetPrice(financialAsset);

    expect(first).toBe(firstReturned);
    expect(second).toBe(secondReturned);
    expect(mockedEm.upsert).toHaveBeenCalledTimes(2);
    expect(mockedEm.upsert).toHaveBeenNthCalledWith(1, FinancialAssetPrice, {
      date: new Date(1714521600 * 1000),
      financialAssetKey: financialAsset,
      price: 123.45,
      volume: 6789,
    });
    expect(mockedEm.upsert).toHaveBeenNthCalledWith(2, FinancialAssetPrice, {
      date: new Date(1714521600 * 1000),
      financialAssetKey: financialAsset,
      price: 222.33,
      volume: 4444,
    });
  });

  it('returns null and does not upsert when the quote close is not finite', async () => {
    mockedGetQuote.mockResolvedValueOnce({
      change: 0,
      change_p: 0,
      close: Number.NaN,
      code: 'AAPL',
      gmtoffset: 0,
      high: 124,
      low: 122,
      open: 122.5,
      previousClose: 122.34,
      timestamp: 1714521600,
      volume: 0,
    });

    await expect(assetPriceService.fetchAndSaveAssetPrice(financialAsset)).resolves.toBeNull();
    expect(mockedEm.upsert).not.toHaveBeenCalled();
  });

  it('returns null and does not upsert when the quote timestamp is missing', async () => {
    mockedGetQuote.mockResolvedValueOnce({
      change: 0,
      change_p: 0,
      close: 123.45,
      code: 'AAPL',
      gmtoffset: 0,
      high: 124,
      low: 122,
      open: 122.5,
      previousClose: 122.34,
      timestamp: null as unknown as number,
      volume: 6789,
    });

    await expect(assetPriceService.fetchAndSaveAssetPrice(financialAsset)).resolves.toBeNull();
    expect(mockedEm.upsert).not.toHaveBeenCalled();
  });

  it('defaults volume to 0 when the quote volume is not finite', async () => {
    const returned = { ok: true } as unknown as FinancialAssetPrice;
    mockedGetQuote.mockResolvedValueOnce({
      change: 0,
      change_p: 0,
      close: 50,
      code: 'AAPL',
      gmtoffset: 0,
      high: 51,
      low: 49,
      open: 49.5,
      previousClose: 49.5,
      timestamp: 1714521600,
      volume: Number.NaN,
    });
    mockedEm.upsert.mockResolvedValueOnce(returned);

    await assetPriceService.fetchAndSaveAssetPrice(financialAsset);

    expect(mockedEm.upsert).toHaveBeenCalledWith(FinancialAssetPrice, {
      date: new Date(1714521600 * 1000),
      financialAssetKey: financialAsset,
      price: 50,
      volume: 0,
    });
  });
});

describe('getRecentlyPricedAssetKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the set of asset keys priced within the window', async () => {
    const database = kyselyDouble(() => [{ financial_asset_key: 1 }, { financial_asset_key: 4 }]);
    mockedEm.getKysely.mockReturnValue(database.db);

    await expect(assetPriceService.getRecentlyPricedAssetKeys(2)).resolves.toEqual(new Set([1, 4]));
    expect(database.queries[0]?.sql).toBe('select distinct "financial_asset_key" from "financial_asset_price" where "date" >= $1');
  });
});

describe('getBenchmarkHistoricalPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates a caret-prefixed index symbol to the EODHD .INDX suffix and returns chronological points', async () => {
    mockedGetEndOfDayPrices.mockResolvedValueOnce([
      { adjusted_close: 101, close: 101, date: '2024-01-02', high: 102, low: 99, open: 100, volume: 1 },
      { adjusted_close: 100, close: 100, date: '2024-01-01', high: 101, low: 98, open: 99, volume: 1 },
    ]);

    await expect(assetPriceService.getBenchmarkHistoricalPrices('^GSPC', '2024-01-01', '2024-01-02')).resolves.toEqual([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 101 },
    ]);
    expect(mockedGetEndOfDayPrices).toHaveBeenCalledWith('GSPC.INDX', { from: '2024-01-01', to: '2024-01-02' });
  });

  it('passes through non-caret symbols unchanged', async () => {
    mockedGetEndOfDayPrices.mockResolvedValueOnce([
      { adjusted_close: 101, close: 101, date: '2024-01-02', high: 102, low: 99, open: 100, volume: 1 },
    ]);

    await assetPriceService.getBenchmarkHistoricalPrices('SPY', '2024-01-01', '2024-01-02');

    expect(mockedGetEndOfDayPrices).toHaveBeenCalledWith('SPY', { from: '2024-01-01', to: '2024-01-02' });
  });

  it('filters out rows with a missing date or non-numeric close', async () => {
    mockedGetEndOfDayPrices.mockResolvedValueOnce([
      { adjusted_close: 101, close: 101, date: '2024-01-02', high: 102, low: 99, open: 100, volume: 1 },
      { adjusted_close: 0, close: null as unknown as number, date: '2024-01-03', high: 0, low: 0, open: 0, volume: 0 },
    ]);

    await expect(assetPriceService.getBenchmarkHistoricalPrices('SPY', '2024-01-01', '2024-01-03')).resolves.toEqual([
      { date: '2024-01-02', value: 101 },
    ]);
  });

  it('returns empty data when the provider call throws', async () => {
    mockedGetEndOfDayPrices.mockRejectedValueOnce(new Error('boom'));

    await expect(assetPriceService.getBenchmarkHistoricalPrices('SPY', '2024-01-01', '2024-01-02')).resolves.toEqual([]);
  });
});
