import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import { FinancialAssetPriceOverride } from '@entity/FinancialAssetPriceOverride';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import portfolioRoutes from '@route/portfolio';

import assetPriceService, { pickNewerPrice } from '../asset-price.service';
import portfolioSnapshotService from '../portfolio-snapshot.service';
import portfolioTransactionService from '../portfolio-transaction.service';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('pickNewerPrice', () => {
  const market = (day: string, time = '00:00:00') => ({ date: new Date(`${day}T${time}.000Z`), price: 10, source: 'market' as const });
  const manual = (day: string) => ({ date: date(day), price: 30, source: 'manual' as const });

  it('takes the override on its own day, even against a quote stamped later that day', () => {
    expect(pickNewerPrice(market('2026-01-02', '21:00:00'), manual('2026-01-02'))?.source).toBe('manual');
  });

  it('takes a newer market price over an older override', () => {
    expect(pickNewerPrice(market('2026-01-03'), manual('2026-01-02'))?.source).toBe('market');
  });

  it('takes a newer override over an older market price, and whichever exists when one is missing', () => {
    expect(pickNewerPrice(market('2026-01-01'), manual('2026-01-02'))?.source).toBe('manual');
    expect(pickNewerPrice(undefined, manual('2026-01-02'))?.source).toBe('manual');
    expect(pickNewerPrice(market('2026-01-01'), undefined)?.source).toBe('market');
    expect(pickNewerPrice(undefined, undefined)).toBeUndefined();
  });
});

interface RebuildPayload {
  portfolioId: number;
  startDate: string;
}

describe('household price overrides', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const enqueue = { send: vi.fn().mockResolvedValue('queued-job'), sendAfter: vi.fn().mockResolvedValue('queued-job') };
  /** The snapshot rebuilds the requests queued so far. */
  const queuedRebuilds = () => enqueue.send.mock.calls.map(([queue, payload]) => ({ queue: queue as string, ...(payload as RebuildPayload) }));
  const http = tenantHttp('/v1/portfolio', portfolioRoutes, { enqueue });

  /** Two households holding the same USD stock (2 and 3 shares), priced 10 then 11 by the market. */
  async function twoHouseholdsHoldingOneStock() {
    enqueue.send.mockClear();
    const em = DI.em;
    const householdA = await seedHousehold(em);
    const { appuser: userA, asset, portfolio: portfolioA, usd } = await seedPortfolio(em, householdA, { portfolioCurrency: 'USD' });
    const householdB = await seedHousehold(em);
    await addExchangeRate(em, usd, householdA.currency, '2026-01-01', 1);
    const userB = await em.findOneOrFail(Appuser, { appuserKey: householdB.appuser.appuserKey }, { filters: false });
    const portfolioB = em.create(Portfolio, { currencyKey: usd, name: 'Other shares', portfolioOwnerAppuserKey: userB, tenantKey: householdB.tenant }, { partial: true });
    await em.flush();
    await addAssetPrice(em, asset, '2026-01-01', 10);
    await addAssetPrice(em, asset, '2026-01-02', 11);
    for (const [user, portfolio, quantity] of [[userA, portfolioA, 2], [userB, portfolioB, 3]] as const) {
      await portfolioTransactionService.createPortfolioTransaction(user, {
        assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.BUY,
        portfolioId: portfolio.portfolioKey, quantity, settlementCurrencyId: usd.currencyKey,
        skipMaintenance: true, transactionDate: date('2026-01-01'), unitPrice: 10,
      }, em);
    }
    const pricePath = (day: string) => `/v1/portfolio/holding/${asset.financialAssetKey}/prices/${day}`;
    return { asset, em, householdA, householdB, portfolioA, portfolioB, pricePath, userA, userB };
  }

  const snapshotValues = async (portfolio: Portfolio) => (await DI.em.find(
    PortfolioSnapshot,
    { portfolioKey: portfolio, snapshotDate: { $gte: date('2026-01-01'), $lte: date('2026-01-03') } },
    { orderBy: { snapshotDate: 'asc' } },
  )).map((snapshot) => snapshot.totalValue);

  /** Runs the rebuilds the requests queued, as the worker would. */
  async function runQueuedRebuilds() {
    for (const payload of queuedRebuilds()) {
      await portfolioSnapshotService.backfillSnapshotsForPortfolio(payload.portfolioId, date(payload.startDate), date('2026-01-03'));
    }
    enqueue.send.mockClear();
  }

  it('values the household holding and its snapshots from the override day on, and no other household', async () => {
    const { householdA, householdB, portfolioA, portfolioB, pricePath, userA, userB } = await twoHouseholdsHoldingOneStock();
    await portfolioSnapshotService.backfillSnapshotsForPortfolio(portfolioA.portfolioKey, date('2026-01-01'), date('2026-01-03'));
    await portfolioSnapshotService.backfillSnapshotsForPortfolio(portfolioB.portfolioKey, date('2026-01-01'), date('2026-01-03'));

    const put = await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'usd', note: 'manual close', price: 30 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ currency: 'USD', date: '2026-01-02', override: { note: 'manual close', price: 30 }, price: 30, source: 'manual' });

    // Only household A's portfolio is rebuilt, from the override's day.
    expect(queuedRebuilds()).toMatchObject([{ portfolioId: portfolioA.portfolioKey, queue: 'portfolio.snapshot.manual', startDate: '2026-01-02' }]);
    expect(queuedRebuilds()).toHaveLength(1);
    await runQueuedRebuilds();
    expect(await snapshotValues(portfolioA)).toEqual([20, 60, 60]);
    expect(await snapshotValues(portfolioB)).toEqual([30, 33, 33]);

    expect((await http.as(userA).get(`/v1/portfolio/${portfolioA.portfolioKey}/holdings`)).body.holdings[0]).toMatchObject({ currentPrice: 30, currentValue: 60 });
    expect((await http.as(userA).get('/v1/portfolio/holdings')).body.holdings[0]).toMatchObject({ currentPrice: 30, currentValue: 60 });
    expect((await http.as(userB).get(`/v1/portfolio/${portfolioB.portfolioKey}/holdings`)).body.holdings[0]).toMatchObject({ currentPrice: 11, currentValue: 33 });
    expect((await http.as(userB).get(pricePath('2026-01-02'))).body).toMatchObject({ override: null, price: 11, source: 'market' });
    expect((await assetPriceService.getCurrentAssetPrices(householdB.tenant.tenantKey)).map((row) => row.price)).toEqual([11]);
    expect((await assetPriceService.getCurrentAssetPrices(householdA.tenant.tenantKey)).map((row) => row.price)).toEqual([30]);
  });

  it('keeps an override in effect on later days until a newer market price replaces it', async () => {
    const { asset, em, householdA, pricePath, userA } = await twoHouseholdsHoldingOneStock();
    await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 30 });

    expect((await http.as(userA).get(pricePath('2026-01-03'))).body).toMatchObject({ override: null, price: 30, source: 'manual' });
    expect((await http.as(userA).get(pricePath('2026-01-01'))).body).toMatchObject({ price: 10, source: 'market' });

    // The feed stamps a quote with its trading time; a later quote on the override's own day loses.
    em.create(FinancialAssetPrice, { date: new Date('2026-01-02T21:00:00.000Z'), financialAssetKey: asset, price: 12, volume: 0 });
    await em.flush();
    expect((await assetPriceService.getCurrentAssetPrices(householdA.tenant.tenantKey)).map((row) => row.price)).toEqual([30]);

    em.create(FinancialAssetPrice, { date: new Date('2026-01-04T21:00:00.000Z'), financialAssetKey: asset, price: 40, volume: 0 });
    await em.flush();
    expect(await assetPriceService.getCurrentAssetPrices(householdA.tenant.tenantKey)).toEqual([
      { date: new Date('2026-01-04T21:00:00.000Z'), financial_asset_key: asset.financialAssetKey, price: 40 },
    ]);
    expect((await http.as(userA).get(pricePath('2026-01-04'))).body).toMatchObject({ price: 40, source: 'market' });
  });

  it('restores the market price and rebuilds the snapshots when the override is deleted', async () => {
    const { em, householdA, portfolioA, pricePath, userA } = await twoHouseholdsHoldingOneStock();
    await portfolioSnapshotService.backfillSnapshotsForPortfolio(portfolioA.portfolioKey, date('2026-01-01'), date('2026-01-03'));
    await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 30 });
    await runQueuedRebuilds();
    expect(await snapshotValues(portfolioA)).toEqual([20, 60, 60]);

    expect((await http.as(userA).delete(pricePath('2026-01-02'))).status).toBe(204);
    expect(queuedRebuilds()).toMatchObject([{ portfolioId: portfolioA.portfolioKey, startDate: '2026-01-02' }]);
    await runQueuedRebuilds();
    expect(await snapshotValues(portfolioA)).toEqual([20, 22, 22]);
    expect((await http.as(userA).get(pricePath('2026-01-02'))).body).toMatchObject({ override: null, price: 11, source: 'market' });
    expect((await assetPriceService.getCurrentAssetPrices(householdA.tenant.tenantKey)).map((row) => row.price)).toEqual([11]);
    const removed = await em.findOneOrFail(FinancialAssetPriceOverride, { tenantKey: householdA.tenant }, { filters: false });
    expect(removed.deletedAt).toBeInstanceOf(Date);

    // The day is free again.
    expect((await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 31 })).status).toBe(200);
    expect(await em.count(FinancialAssetPriceOverride, { deletedAt: null, tenantKey: householdA.tenant }, { filters: false })).toBe(1);
  });

  it('replaces the household override for a day instead of adding a second one', async () => {
    const { em, householdA, pricePath, userA } = await twoHouseholdsHoldingOneStock();
    await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', note: 'first', price: 30 });
    const second = await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 32 });
    expect(second.body).toMatchObject({ override: { note: null, price: 32 }, price: 32 });
    expect(await em.count(FinancialAssetPriceOverride, { deletedAt: null, tenantKey: householdA.tenant }, { filters: false })).toBe(1);
  });

  it("never reads or removes another household's override", async () => {
    const { asset, householdA, pricePath, userA, userB } = await twoHouseholdsHoldingOneStock();
    await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 30 });

    expect((await http.as(userB).delete(pricePath('2026-01-02'))).status).toBe(404);
    expect((await http.as(userB).get(`/v1/portfolio/holding/${asset.financialAssetKey}/prices`)).body.prices)
      .toEqual([{ date: '2026-01-01', price: 10, provider: null, source: 'market' }, { date: '2026-01-02', price: 11, provider: null, source: 'market' }]);

    // Household B's own override for the same day leaves household A's alone.
    expect((await http.as(userB).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 50 })).status).toBe(200);
    expect((await assetPriceService.getCurrentAssetPrices(householdA.tenant.tenantKey)).map((row) => row.price)).toEqual([30]);
    expect((await http.as(userA).get(pricePath('2026-01-02'))).body).toMatchObject({ price: 30 });
  });

  it('lists the price history with the household overrides marked manual', async () => {
    const { asset, pricePath, userA } = await twoHouseholdsHoldingOneStock();
    await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 30 });
    await http.as(userA).put(pricePath('2026-01-05')).send({ currency: 'USD', price: 33 });

    const history = await http.as(userA).get(`/v1/portfolio/holding/${asset.financialAssetKey}/prices`);
    expect(history.body).toEqual({
      currency: 'USD',
      prices: [
        { date: '2026-01-01', price: 10, provider: null, source: 'market' },
        { date: '2026-01-02', price: 30, provider: null, source: 'manual' },
        { date: '2026-01-05', price: 33, provider: null, source: 'manual' },
      ],
    });
    const ranged = await http.as(userA).get(`/v1/portfolio/holding/${asset.financialAssetKey}/prices?from=2026-01-02&to=2026-01-04`);
    expect(ranged.body.prices).toEqual([{ date: '2026-01-02', price: 30, provider: null, source: 'manual' }]);
  });

  it('rejects a price in another currency, a future day, a non-positive price and an unknown security', async () => {
    const { pricePath, userA } = await twoHouseholdsHoldingOneStock();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    expect((await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'EUR', price: 30 })).status).toBe(400);
    expect((await http.as(userA).put(pricePath(future)).send({ currency: 'USD', price: 30 })).status).toBe(400);
    expect((await http.as(userA).put(pricePath('2026-01-02')).send({ currency: 'USD', price: 0 })).status).toBe(400);
    expect((await http.as(userA).put(pricePath('2026-02-30')).send({ currency: 'USD', price: 30 })).status).toBe(400);
    expect((await http.as(userA).put('/v1/portfolio/holding/999999/prices/2026-01-02').send({ currency: 'USD', price: 30 })).status).toBe(404);
    expect(enqueue.send).not.toHaveBeenCalled();
  });

  it('prices the nightly snapshot with the household override', async () => {
    const { portfolioA, portfolioB, pricePath, userA } = await twoHouseholdsHoldingOneStock();
    const today = new Date().toISOString().slice(0, 10);
    // The stored prices stand in for the feed, which tests never call.
    vi.spyOn(assetPriceService, 'ensureRecentAssetPrice').mockResolvedValue();
    expect((await http.as(userA).put(pricePath(today)).send({ currency: 'USD', price: 50 })).status).toBe(200);

    const snapshotA = await portfolioSnapshotService.updateSnapshotForToday(portfolioA.portfolioKey);
    const snapshotB = await portfolioSnapshotService.updateSnapshotForToday(portfolioB.portfolioKey);
    // Valued in the owner's currency, at the stored USD rate of 1.
    expect(snapshotA.appuserCurrencyTotalValue).toBe(100);
    expect(snapshotB.appuserCurrencyTotalValue).toBe(33);
  });
});
