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
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import portfolioRoutes from '@route/portfolio';
import portfolioTransactionService from '@service/portfolio/portfolio-transaction.service';

/*
 * GET /v1/portfolio/realized-gains over HTTP. A household's sales are visible to both members
 * and never to another household: naming its portfolio is a 404, and the aggregate read holds
 * only the caller's household.
 */
describe('GET /v1/portfolio/realized-gains', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  let household: Household;
  let outsider: Household;
  let partner: Appuser;
  let setup: PortfolioSetup;

  beforeEach(async () => {
    household = await seedHousehold(db.em());
    partner = await addPartner(db.em(), household);
    outsider = await seedHousehold(db.em());
    setup = await seedPortfolio(db.em(), household);
    await addExchangeRate(DI.em, setup.usd, household.currency, '2025-01-01', 1);
    const trade = (type: number, day: string, quantity: number, unitPrice: number) =>
      portfolioTransactionService.createPortfolioTransaction(setup.appuser, {
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
    await trade(FINANCIAL_TRANSACTION_TYPES.BUY, '2025-01-10', 10, 100);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2025-03-10', 4, 150);
    await trade(FINANCIAL_TRANSACTION_TYPES.SELL, '2026-03-10', 6, 90);
  });

  const path = (query = '') => `/v1/portfolio/realized-gains${query}`;

  it('returns the household’s sales for a member, filtered by year', async () => {
    const response = await http.as(partner).get(path(`?portfolioId=${setup.portfolio.portfolioKey}&year=2025`));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ currencyCode: 'EUR', totals: { realizedGain: 200, sales: 1 }, year: 2025 });
    expect(response.body.disposals).toHaveLength(1);
    expect(response.body.byYear).toHaveLength(2);
    expect(response.body.closedPositions).toEqual([expect.objectContaining({ realizedGain: 140, symbol: 'AAPL' })]);
  });

  it('returns the aggregate across the household’s portfolios', async () => {
    const response = await http.as(household.appuser).get(path());

    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({ realizedGain: 140, sales: 2 });
  });

  it("returns 404 for another household's portfolio", async () => {
    const response = await http.as(outsider.appuser).get(path(`?portfolioId=${setup.portfolio.portfolioKey}`));

    expect(response.status).toBe(404);
  });

  it("leaves another household's sales out of the aggregate", async () => {
    const response = await http.as(outsider.appuser).get(path());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ byYear: [], closedPositions: [], disposals: [], totals: { sales: 0 } });
  });

  it('returns 404 for a deleted portfolio', async () => {
    await DI.em.nativeUpdate(Portfolio, { portfolioKey: setup.portfolio.portfolioKey }, { deletedAt: new Date() });

    const response = await http.as(household.appuser).get(path(`?portfolioId=${setup.portfolio.portfolioKey}`));

    expect(response.status).toBe(404);
  });

  it.each(['?year=25', '?year=abcd', '?portfolioId=0'])('rejects a malformed query %s', async (query) => {
    const response = await http.as(household.appuser).get(path(query));

    expect(response.status).toBe(400);
  });
});
