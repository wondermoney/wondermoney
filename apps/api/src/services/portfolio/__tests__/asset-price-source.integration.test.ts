import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eodhdClient = vi.hoisted(() => ({ getEndOfDayPrices: vi.fn(), getQuote: vi.fn() }));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/market-data/eodhd.service', () => ({ default: eodhdClient, handleEodhdError: (error: unknown) => { throw error; } }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import portfolioRoutes from '@route/portfolio';
import { STOOQ_DAILY_CSV } from '@service/market-data/__tests__/__fixtures__/provider-responses';
import { getMarketDataSources } from '@service/market-data/price-sources.service';

import assetPriceService from '../asset-price.service';
import historicalAssetPriceBackfillService from '../historical-asset-price-backfill.service';

const fetchMock = vi.fn<typeof fetch>();
const storedPrices = async (financialAssetKey: number) => (await DI.em.fork().find(FinancialAssetPrice, { financialAssetKey: { financialAssetKey } }, { orderBy: { date: 'asc' } }))
  .map((row) => ({ day: row.date.toISOString().slice(0, 10), price: row.price, source: row.source ?? null }));

describe('the source of a stored price', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const enqueue = { send: vi.fn().mockResolvedValue('queued-job'), sendAfter: vi.fn().mockResolvedValue('queued-job') };
  const http = tenantHttp('/v1/portfolio', portfolioRoutes, { enqueue });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('records EODHD for a quote under the default configuration', async () => {
    const { asset } = await seedPortfolio(DI.em, await seedHousehold(DI.em));
    eodhdClient.getQuote.mockResolvedValue({ change: 1, change_p: 1, close: 101, code: 'AAPL', gmtoffset: 0, high: 101, low: 99, open: 100, previousClose: 100, timestamp: Date.parse('2026-03-04T21:00:00Z') / 1000, volume: 5 });

    await assetPriceService.fetchAndSaveAssetPrice(asset);

    expect(await storedPrices(asset.financialAssetKey)).toEqual([{ day: '2026-03-04', price: 101, source: 'eodhd' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records the free provider that answered when EODHD could not', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDERS', 'eodhd,stooq');
    vi.stubEnv('EODHD_API_KEY', 'key');
    const { asset, portfolio } = await seedPortfolio(DI.em, await seedHousehold(DI.em));
    eodhdClient.getQuote.mockResolvedValue({ close: null, code: 'AAPL', timestamp: null });
    eodhdClient.getEndOfDayPrices.mockRejectedValue(Object.assign(new Error('Not found'), { code: 'client_error', status: 404 }));
    fetchMock.mockImplementation(() => Promise.resolve(new Response(STOOQ_DAILY_CSV)));

    await assetPriceService.fetchAndSaveAssetPrice(asset);
    await historicalAssetPriceBackfillService.backfillHistoricalAssetPrices(
      { items: [{ financialAssetKey: asset.financialAssetKey, symbol: asset.symbol, transactionDate: '2026-03-02' }], portfolioId: portfolio.portfolioKey },
      { now: new Date('2026-03-05T12:00:00Z') },
    );

    // The quote stored 2026-03-04; the backfill added the two days before and left that one alone.
    expect(await storedPrices(asset.financialAssetKey)).toEqual([
      { day: '2026-03-02', price: 101.25, source: 'stooq' },
      { day: '2026-03-03', price: 103, source: 'stooq' },
      { day: '2026-03-04', price: 102, source: 'stooq' },
    ]);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('s')).toBe('aapl.us');
  });

  it('shows each market price with its provider beside the household manual prices', async () => {
    const household = await seedHousehold(DI.em);
    const { appuser, asset } = await seedPortfolio(DI.em, household, { portfolioCurrency: 'USD' });
    await addAssetPrice(DI.em, asset, '2026-01-01', 10);
    await addAssetPrice(DI.em, asset, '2026-01-02', 11, 'eodhd');
    await addAssetPrice(DI.em, asset, '2026-01-03', 12, 'stooq');
    const pricePath = (day: string) => `/v1/portfolio/holding/${asset.financialAssetKey}/prices/${day}`;
    expect((await http.as(appuser).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 30 })).status).toBe(200);

    const history = await http.as(appuser).get(`/v1/portfolio/holding/${asset.financialAssetKey}/prices`);
    expect(history.body.prices).toEqual([
      { date: '2026-01-01', price: 10, provider: null, source: 'market' },
      { date: '2026-01-02', price: 30, provider: null, source: 'manual' },
      { date: '2026-01-03', price: 12, provider: 'stooq', source: 'market' },
    ]);
    expect((await http.as(appuser).get(pricePath('2026-01-02'))).body).toMatchObject({ price: 30, provider: null, source: 'manual' });
    expect((await http.as(appuser).get(pricePath('2026-01-03'))).body).toMatchObject({ price: 12, provider: 'stooq', source: 'market' });

    // Removing the manual price brings back the market price, with its provider.
    expect((await http.as(appuser).delete(pricePath('2026-01-02'))).status).toBe(204);
    expect((await http.as(appuser).get(pricePath('2026-01-02'))).body).toMatchObject({ price: 11, provider: 'eodhd', source: 'market' });
  });

  it('counts the recent prices per source for operators', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDERS', 'stooq,eodhd');
    vi.stubEnv('EODHD_API_KEY', '');
    const { asset } = await seedPortfolio(DI.em, await seedHousehold(DI.em));
    await addAssetPrice(DI.em, asset, '2026-03-01', 9);
    await addAssetPrice(DI.em, asset, '2026-03-02', 10, 'stooq');
    await addAssetPrice(DI.em, asset, '2026-03-03', 11, 'stooq');
    await addAssetPrice(DI.em, asset, '2026-02-01', 8, 'eodhd');

    const report = await getMarketDataSources(DI.em, { days: 7, now: new Date('2026-03-05T00:00:00Z') });

    expect(report.providers).toEqual([
      { capabilities: ['quote', 'dailyHistory'], configured: true, id: 'stooq', label: 'Stooq' },
      { capabilities: ['search', 'quote', 'dailyHistory', 'dividends', 'splits'], configured: false, id: 'eodhd', label: 'EODHD' },
    ]);
    expect(report.recent).toEqual({
      days: 7,
      sources: [
        { assets: 1, latest: new Date('2026-03-03T00:00:00Z'), prices: 2, source: 'stooq' },
        { assets: 1, latest: new Date('2026-03-01T00:00:00Z'), prices: 1, source: null },
      ],
    });
  });
});
