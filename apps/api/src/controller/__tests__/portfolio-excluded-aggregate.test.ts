import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// The calendar asks the market data provider for each held symbol's upcoming dividends: answer
// every symbol with one, so the calendar lists exactly the symbols it asked about.
vi.mock('@service/market-data/registry', () => ({
  marketData: () => ({
    dividends: (_symbol: string) => {
      const date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      return Promise.resolve({ value: [{ date, value: 1 }] });
    },
  }),
}));
vi.mock('@service/portfolio/asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { getBenchmarkHistoricalPrices: vi.fn().mockResolvedValue([]) }) };
});

import type { EntityManager } from '@mikro-orm/postgresql';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import portfolioRoutes from '@route/portfolio';

/*
 * "Exclude from aggregate dashboard" (`Portfolio.excluded`): the combined view of the household's
 * portfolios leaves the portfolio out of every figure, while the portfolio's own page reads it in
 * full. One household, all in euros; ALPHA rose from 100 to 130, BETA fell from 200 to 180 and
 * GAMMA rose from 50 to 60 since 60 days ago.
 *
 *   Owner shares (owner):      10 ALPHA bought, 2 sold at 150 (+100), a 20 dividend → 8 ALPHA: 1040
 *   Side pot (owner):          5 BETA bought, 1 sold at 210 (+10), a 10 dividend    → 4 BETA:   720
 *   Partner shares (partner):  2 GAMMA bought, a 5 dividend                          → 2 GAMMA:  120
 *
 * Daily history: Owner shares 1000 → 1100, Side pot 700 → 720, Partner shares 100 → 120.
 */
describe('a portfolio excluded from the aggregate dashboard', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  const daysAgo = (days: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
  };
  const dayBefore = daysAgo(2);
  const yesterday = daysAgo(1);

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, name: string, history: [number, number]) {
    const portfolio = em.create(Portfolio, { currencyKey: household.currency, name, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    for (const [date, value] of [[dayBefore, history[0]], [yesterday, history[1]]] as const) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: household.currency, appuserCurrencyTotalValue: value, currencyKey: household.currency, portfolioKey: portfolio, snapshotDate: new Date(`${date}T00:00:00Z`), totalValue: value }, { partial: true });
    }
    await em.flush();
    return portfolio;
  }

  let sequence = 0;
  async function trade(em: EntityManager, household: Household, portfolio: Portfolio, owner: Appuser, asset: FinancialAsset, type: number, day: string, quantity: number, unitPrice: number) {
    em.create(FinancialTransaction, {
      appuserKey: owner,
      financialAssetKey: asset,
      financialTransactionTypeKey: await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: type }),
      internalTransactionId: `excluded-${++sequence}`,
      portfolioKey: portfolio,
      quantity,
      settlementAmount: quantity * unitPrice,
      settlementCurrencyKey: household.currency,
      settlementUnitAmount: unitPrice,
      tenantKey: household.tenant,
      transactionDate: new Date(`${day}T00:00:00Z`),
    }, { partial: true });
    await em.flush();
  }

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const owner = household.appuser;
    const partner = await addPartner(em, household);

    // seedPortfolio brings the transaction types; its portfolio is not needed.
    const { portfolio: unused } = await seedPortfolio(em, household);
    unused.deletedAt = new Date();
    const stock = await em.findOneOrFail(FinancialAssetType, { name: 'Stock' });
    const asset = (symbol: string) => em.create(FinancialAsset, { currencyKey: household.currency, financialAssetTypeKey: stock, name: symbol, symbol }, { partial: true });
    const assets = { ALPHA: asset('ALPHA'), BETA: asset('BETA'), GAMMA: asset('GAMMA') };
    await em.flush();
    for (const [symbol, then, now] of [['ALPHA', 100, 130], ['BETA', 200, 180], ['GAMMA', 50, 60]] as const) {
      await addAssetPrice(em, assets[symbol], daysAgo(60), then);
      await addAssetPrice(em, assets[symbol], daysAgo(0), now);
    }

    const { BUY, DIVIDEND, SELL } = FINANCIAL_TRANSACTION_TYPES;
    const bought = daysAgo(90);
    const sold = daysAgo(45);
    const paid = daysAgo(40);

    const ownerShares = await addPortfolio(em, household, owner, 'Owner shares', [1000, 1100]);
    await trade(em, household, ownerShares, owner, assets.ALPHA, BUY, bought, 10, 100);
    await trade(em, household, ownerShares, owner, assets.ALPHA, SELL, sold, 2, 150);
    await trade(em, household, ownerShares, owner, assets.ALPHA, DIVIDEND, paid, 1, 20);

    const sidePot = await addPortfolio(em, household, owner, 'Side pot', [700, 720]);
    await trade(em, household, sidePot, owner, assets.BETA, BUY, bought, 5, 200);
    await trade(em, household, sidePot, owner, assets.BETA, SELL, sold, 1, 210);
    await trade(em, household, sidePot, owner, assets.BETA, DIVIDEND, paid, 1, 10);

    const partnerShares = await addPortfolio(em, household, partner, 'Partner shares', [100, 120]);
    await trade(em, household, partnerShares, partner, assets.GAMMA, BUY, bought, 2, 50);
    await trade(em, household, partnerShares, partner, assets.GAMMA, DIVIDEND, paid, 1, 5);

    return { owner, partner, sidePot };
  }

  /** Switches "Exclude from aggregate dashboard" through the portfolio settings, as the apps do. */
  async function setExcluded(who: Appuser, portfolio: Portfolio, excluded: boolean) {
    const response = await http.as(who).put(`/v1/portfolio/${portfolio.portfolioKey}`).send({ excluded });
    expect(response.status).toBe(200);
    expect(response.body.portfolio.excluded).toBe(excluded);
  }

  /** Every combined read of the portfolios overview, as `who` sees it, for `memberKeys` (none: the whole household). */
  async function overview(who: Appuser, memberKeys?: string) {
    const query = (extra: string) => `?${[extra, memberKeys === undefined ? '' : `memberKeys=${memberKeys}`].filter(Boolean).join('&')}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each endpoint's body, read field by field below
    const get = async (path: string): Promise<any> => {
      const response = await http.as(who).get(`/v1/portfolio${path}`);
      expect(response.status).toBe(200);
      return response.body;
    };
    const [dashboard, metrics, allocation, topMovers, holdings, calendar, dividends, realized, performance] = await Promise.all([
      get(`/dashboard${query('period=1M')}`),
      get(`/metrics${query('')}`),
      get(`/allocation${query('')}`),
      get(`/top-movers${query('period=1M')}`),
      get(`/holdings${query('')}`),
      get(`/calendar${query('')}`),
      get(`/dividend-income${query('')}`),
      get(`/realized-gains${query('')}`),
      get(`/performance${query('period=1M')}`),
    ]);
    return {
      allocation: Object.fromEntries((allocation.byAsset as { type: string; value: number }[]).map((item) => [item.type, item.value])),
      calendar: [...new Set((calendar.dividends as { symbol: string }[]).map((row) => row.symbol))].toSorted(),
      dividends: dividends.totalDividends as number,
      metricsValue: metrics.metrics.currentValue as number,
      movers: [...topMovers.gainers, ...topMovers.losers].map((mover: { ticker: string }) => mover.ticker).toSorted(),
      performance: (performance.dataPoints as { value: number }[]).map((point) => point.value),
      portfolioCount: dashboard.summary.portfolioCount as number,
      quantities: Object.fromEntries((holdings.holdings as { financialAssetSymbol: string; quantity: number }[]).map((holding) => [holding.financialAssetSymbol, holding.quantity])),
      realizedGains: dashboard.summary.realizedGains as number,
      realizedReport: realized.totals.realizedGain as number,
      totalValue: dashboard.summary.totalValue as number,
    };
  }

  const WHOLE_HOUSEHOLD = {
    allocation: { ALPHA: 1040, BETA: 720, GAMMA: 120 },
    calendar: ['ALPHA', 'BETA', 'GAMMA'],
    dividends: 35,
    metricsValue: 1880,
    movers: ['ALPHA', 'BETA', 'GAMMA'],
    performance: [1800, 1940],
    portfolioCount: 3,
    quantities: { ALPHA: 8, BETA: 4, GAMMA: 2 },
    realizedGains: 110,
    realizedReport: 110,
    totalValue: 1880,
  };

  const WITHOUT_SIDE_POT = {
    allocation: { ALPHA: 1040, GAMMA: 120 },
    calendar: ['ALPHA', 'GAMMA'],
    dividends: 25,
    metricsValue: 1160,
    movers: ['ALPHA', 'GAMMA'],
    performance: [1100, 1220],
    portfolioCount: 2,
    quantities: { ALPHA: 8, GAMMA: 2 },
    realizedGains: 100,
    realizedReport: 100,
    totalValue: 1160,
  };

  it('is left out of every combined figure once switched on, and counts again once switched off', async () => {
    const { owner, partner, sidePot } = await seed();
    expect(await overview(owner)).toEqual(WHOLE_HOUSEHOLD);

    await setExcluded(owner, sidePot, true);

    expect(await overview(owner)).toEqual(WITHOUT_SIDE_POT);
    // A household setting: every member's combined view leaves it out.
    expect(await overview(partner)).toEqual(WITHOUT_SIDE_POT);

    await setExcluded(partner, sidePot, false);

    expect(await overview(owner)).toEqual(WHOLE_HOUSEHOLD);
  });

  it('stays listed in the breakdown, marked and outside the weights, so its page can still be opened', async () => {
    const { owner, sidePot } = await seed();
    await setExcluded(owner, sidePot, true);

    const response = await http.as(owner).get('/v1/portfolio/dashboard?period=1M');

    const rows = response.body.portfolios as { excluded: boolean; name: string; value: number; weight: number }[];
    expect(rows.map(({ excluded, name, value }) => ({ excluded, name, value }))).toEqual([
      { excluded: false, name: 'Owner shares', value: 1040 },
      { excluded: false, name: 'Partner shares', value: 120 },
      { excluded: true, name: 'Side pot', value: 720 },
    ]);
    expect(rows.find((row) => row.excluded)?.weight).toBe(0);
    expect(rows.filter((row) => !row.excluded).reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(100, 6);
  });

  it('stays out under the member filter: its owner sees their other portfolios, and the row', async () => {
    const { owner, partner, sidePot } = await seed();
    await setExcluded(owner, sidePot, true);

    const owners = await overview(owner, String(owner.appuserKey));
    const partners = await overview(owner, String(partner.appuserKey));

    expect(owners).toEqual({
      allocation: { ALPHA: 1040 },
      calendar: ['ALPHA'],
      dividends: 20,
      metricsValue: 1040,
      // Top movers needs two holdings to rank.
      movers: [],
      performance: [1000, 1100],
      portfolioCount: 1,
      quantities: { ALPHA: 8 },
      realizedGains: 100,
      realizedReport: 100,
      totalValue: 1040,
    });
    expect(partners).toMatchObject({ dividends: 5, metricsValue: 120, performance: [100, 120], portfolioCount: 1, quantities: { GAMMA: 2 }, totalValue: 120 });

    const ownersRows = await http.as(owner).get(`/v1/portfolio/dashboard?period=1M&memberKeys=${owner.appuserKey}`);
    const partnersRows = await http.as(owner).get(`/v1/portfolio/dashboard?period=1M&memberKeys=${partner.appuserKey}`);
    expect((ownersRows.body.portfolios as { excluded: boolean; name: string }[]).map(({ excluded, name }) => ({ excluded, name }))).toEqual([
      { excluded: false, name: 'Owner shares' },
      { excluded: true, name: 'Side pot' },
    ]);
    expect((partnersRows.body.portfolios as { name: string }[]).map((row) => row.name)).toEqual(['Partner shares']);
  });

  it('keeps its own page whole: dashboard, holdings, chart, allocation, top movers, dividends and realized gains', async () => {
    const { owner, sidePot } = await seed();
    await setExcluded(owner, sidePot, true);
    const id = sidePot.portfolioKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each endpoint's body, read field by field below
    const get = async (path: string): Promise<any> => {
      const response = await http.as(owner).get(`/v1/portfolio${path}`);
      expect(response.status).toBe(200);
      return response.body;
    };

    const [detail, dashboard, holdings, performance, allocation, dividends, realized, realizedForOwner] = await Promise.all([
      get(`/${id}`),
      get(`/${id}/dashboard?period=1M`),
      get(`/${id}/holdings`),
      get(`/${id}/performance?period=1M`),
      get(`/${id}/allocation`),
      get(`/${id}/dividend-income`),
      get(`/realized-gains?portfolioId=${id}`),
      get(`/realized-gains?portfolioId=${id}&memberKeys=${owner.appuserKey}`),
    ]);

    expect(detail.portfolio).toMatchObject({ excluded: true, name: 'Side pot' });
    expect(dashboard.summary).toMatchObject({ realizedGains: 10, totalValue: 720 });
    expect((holdings.holdings as { financialAssetSymbol: string; quantity: number }[]).map((holding) => [holding.financialAssetSymbol, holding.quantity])).toEqual([['BETA', 4]]);
    expect((performance.dataPoints as { value: number }[]).map((point) => point.value)).toEqual([700, 720]);
    expect((allocation.byAsset as { type: string; value: number }[]).map((item) => [item.type, item.value])).toEqual([['BETA', 720]]);
    expect(dividends.totalDividends).toBe(10);
    expect(realized.totals.realizedGain).toBe(10);
    expect(realizedForOwner.totals.realizedGain).toBe(10);
  });
});
