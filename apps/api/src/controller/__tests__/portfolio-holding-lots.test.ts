import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/portfolio/stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('@service/portfolio/portfolio-snapshot.service', () => ({ default: { backfillSnapshotsForPortfolio: vi.fn() } }));
vi.mock('@service/portfolio/asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import portfolioRoutes from '@route/portfolio';
import portfolioTransactionService from '@service/portfolio/portfolio-transaction.service';

/*
 * The lots endpoint and the cost-basis method setting. Lots are the individual purchase rows a
 * sale relieves; under AVERAGE they collapse into one pooled position. Another household's
 * portfolio is a 404, as everywhere on this router.
 */
describe('portfolio holding lots', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const send = vi.fn().mockResolvedValue('job-1');
  const withEnqueue = express.Router();
  withEnqueue.use((req, _res, next) => {
    req.enqueue = { send, sendAfter: vi.fn().mockResolvedValue('job-1') };
    next();
  });
  withEnqueue.use(portfolioRoutes);
  const http = tenantHttp('/v1/portfolio', withEnqueue);

  let household: Household;
  let outsider: Appuser;
  let partner: Appuser;
  let setup: PortfolioSetup;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    partner = await addPartner(db.em(), household);
    outsider = (await seedHousehold(db.em())).appuser;
    setup = await seedPortfolio(db.em(), household);
    await addExchangeRate(DI.em, setup.usd, household.currency, '2026-07-17', 1);
    send.mockClear();
  });

  const trade = (type: number, day: string, quantity: number, unitPrice: number, appuser: Appuser = setup.appuser) =>
    portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: setup.asset.symbol,
      financialAsset: setup.asset,
      financialTransactionTypeId: type,
      portfolioId: setup.portfolio.portfolioKey,
      quantity,
      settlementCurrencyId: setup.usd.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date(`${day}T00:00:00Z`),
      unitPrice,
    }, setup.em);

  const seedTwoLotsAndSell = async () => {
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-17', 10, 100);
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2026-07-18', 10, 200);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2026-07-19', 10, 250);
  };

  const setMethod = (method: PortfolioCostBasisMethod) =>
    DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { costBasisMethod: method });

  const lotsPath = () => `/v1/portfolio/${setup.portfolio.portfolioKey}/holding/${setup.asset.financialAssetKey}/lots`;

  it('lists the open and closed FIFO lots a sale relieved', async () => {
    await seedTwoLotsAndSell();

    const response = await http.as(household.appuser).get(lotsPath());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      costBasisMethod: 'FIFO',
      openQuantity: 10,
      realizedCostBasis: 1000,
    });
    expect(response.body.lots).toHaveLength(2);
    expect(response.body.lots[0]).toMatchObject({ quantity: 10, remainingQuantity: 0, status: 'CLOSED', unitCost: 100 });
    expect(response.body.lots[1]).toMatchObject({ quantity: 10, remainingQuantity: 10, status: 'OPEN', unitCost: 200 });
  });

  it('returns one pooled position under AVERAGE', async () => {
    await setMethod(PortfolioCostBasisMethod.AVERAGE);
    await seedTwoLotsAndSell();

    const response = await http.as(household.appuser).get(lotsPath());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      averageUnitCost: 150,
      costBasisMethod: 'AVERAGE',
      openQuantity: 10,
      realizedCostBasis: 1500,
    });
    expect(response.body.lots).toEqual([
      expect.objectContaining({
        quantity: 10,
        remainingQuantity: 10,
        status: 'OPEN',
        transactionKey: null,
        unitCost: 150,
      }),
    ]);
  });

  it("returns 404 for another household's portfolio", async () => {
    await seedTwoLotsAndSell();

    const response = await http.as(outsider).get(lotsPath());

    expect(response.status).toBe(404);
  });

  it('returns 404 for an asset the portfolio never traded', async () => {
    await seedTwoLotsAndSell();

    const response = await http.as(household.appuser).get(`/v1/portfolio/${setup.portfolio.portfolioKey}/holding/999999/lots`);

    expect(response.status).toBe(404);
  });

  it('stores a method change and queues the full snapshot rebuild', async () => {
    await seedTwoLotsAndSell();

    const response = await http.as(household.appuser).put(`/v1/portfolio/${setup.portfolio.portfolioKey}`).send({ costBasisMethod: 'AVERAGE' });

    expect(response.status).toBe(200);
    expect(response.body.portfolio.costBasisMethod).toBe('AVERAGE');
    await expect(db.em().findOneOrFail(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { filters: false }))
      .resolves.toMatchObject({ costBasisMethod: 'AVERAGE' });
    expect(send).toHaveBeenCalledWith(
      'portfolio.snapshot.manual',
      expect.objectContaining({ portfolioId: setup.portfolio.portfolioKey }),
      expect.objectContaining({ singletonKey: expect.any(String) }),
    );
  });

  it('lets a partner read the lots and change the method', async () => {
    await seedTwoLotsAndSell();

    expect((await http.as(partner).get(lotsPath())).status).toBe(200);
    expect((await http.as(partner).put(`/v1/portfolio/${setup.portfolio.portfolioKey}`).send({ costBasisMethod: 'AVERAGE' })).status).toBe(200);
  });
});
