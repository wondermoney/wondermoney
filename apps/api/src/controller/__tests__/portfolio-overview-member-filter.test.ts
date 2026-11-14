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

import type { EntityManager } from '@mikro-orm/postgresql';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addAssetPrice, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import portfolioRoutes from '@route/portfolio';

/*
 * The portfolios overview under the member filter: every figure on the screen (the summary and
 * breakdown, metrics, allocation, top movers, holdings, the calendar, dividend income and realized
 * gains) keeps the portfolios the chosen members own, and a former member's under Shared, by the
 * rule the performance chart follows (`portfoliosOfMembers`). One household, all in euros; ALPHA
 * rose from 100 to 130, BETA fell from 200 to 180 and GAMMA rose from 50 to 60 since 60 days ago.
 *
 *   Owner:          10 ALPHA and 2 BETA bought, 2 ALPHA sold at 150 (+100), a 20 dividend
 *                   → 8 ALPHA (1040) and 2 BETA (360): 1400
 *   Partner:        5 ALPHA and 5 BETA bought, 1 BETA sold at 210 (+10), a 10 dividend
 *                   → 5 ALPHA (650) and 4 BETA (720): 1370
 *   Kid:            no portfolio
 *   Former member:  1 GAMMA and 1 BETA bought, a 5 dividend (Shared) → 60 + 180: 240
 *   Another household holds 100 of each and was paid 1000, which never counts.
 */
describe('the portfolios overview, filtered by member', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  const daysAgo = (days: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
  };

  type Assets = Record<'ALPHA' | 'BETA' | 'GAMMA', FinancialAsset>;

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, name: string) {
    const portfolio = em.create(Portfolio, { currencyKey: household.currency, name, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return portfolio;
  }

  let sequence = 0;
  async function trade(em: EntityManager, household: Household, portfolio: Portfolio, owner: Appuser, asset: FinancialAsset, type: number, day: string, quantity: number, unitPrice: number) {
    em.create(FinancialTransaction, {
      appuserKey: owner,
      financialAssetKey: asset,
      financialTransactionTypeKey: await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: type }),
      internalTransactionId: `overview-${++sequence}`,
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
    const kid = await addPartner(em, household);
    const former = await addPartner(em, household);

    // seedPortfolio brings the transaction types; its (empty) portfolio is one more of the owner's.
    const { portfolio: ownerEmpty } = await seedPortfolio(em, household);
    ownerEmpty.name = 'Owner empty';
    const stock = await em.findOneOrFail(FinancialAssetType, { name: 'Stock' });
    const asset = (symbol: string) => em.create(FinancialAsset, { currencyKey: household.currency, financialAssetTypeKey: stock, name: symbol, symbol }, { partial: true });
    const assets: Assets = { ALPHA: asset('ALPHA'), BETA: asset('BETA'), GAMMA: asset('GAMMA') };
    await em.flush();
    for (const [symbol, then, now] of [['ALPHA', 100, 130], ['BETA', 200, 180], ['GAMMA', 50, 60]] as const) {
      await addAssetPrice(em, assets[symbol], daysAgo(60), then);
      await addAssetPrice(em, assets[symbol], daysAgo(0), now);
    }

    const { BUY, DIVIDEND, SELL } = FINANCIAL_TRANSACTION_TYPES;
    const bought = daysAgo(90);
    const sold = daysAgo(45);
    const paid = daysAgo(40);

    const ownerShares = await addPortfolio(em, household, owner, 'Owner shares');
    await trade(em, household, ownerShares, owner, assets.ALPHA, BUY, bought, 10, 100);
    await trade(em, household, ownerShares, owner, assets.BETA, BUY, bought, 2, 200);
    await trade(em, household, ownerShares, owner, assets.ALPHA, SELL, sold, 2, 150);
    await trade(em, household, ownerShares, owner, assets.ALPHA, DIVIDEND, paid, 1, 20);

    const partnerShares = await addPortfolio(em, household, partner, 'Partner shares');
    await trade(em, household, partnerShares, partner, assets.ALPHA, BUY, bought, 5, 100);
    await trade(em, household, partnerShares, partner, assets.BETA, BUY, bought, 5, 200);
    await trade(em, household, partnerShares, partner, assets.BETA, SELL, sold, 1, 210);
    await trade(em, household, partnerShares, partner, assets.BETA, DIVIDEND, paid, 1, 10);

    const formerShares = await addPortfolio(em, household, former, 'Former member shares');
    await trade(em, household, formerShares, former, assets.GAMMA, BUY, bought, 1, 50);
    await trade(em, household, formerShares, former, assets.BETA, BUY, bought, 1, 200);
    await trade(em, household, formerShares, former, assets.GAMMA, DIVIDEND, paid, 1, 5);
    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: former, tenantKey: household.tenant });
    membership.recordActive = false;
    await em.flush();

    const other = await seedHousehold(em);
    const otherShares = await addPortfolio(em, other, other.appuser, 'Other household shares');
    await trade(em, other, otherShares, other.appuser, assets.ALPHA, BUY, bought, 100, 100);
    await trade(em, other, otherShares, other.appuser, assets.GAMMA, BUY, bought, 100, 50);
    await trade(em, other, otherShares, other.appuser, assets.ALPHA, DIVIDEND, paid, 1, 1000);

    return { household, kid, other, owner, partner };
  }

  /** One read of the overview, as `who` sees it, for `memberKeys` (none: the whole household). */
  async function overview(who: Appuser, memberKeys?: string) {
    const query = (extra: string) => `?${[extra, memberKeys === undefined ? '' : `memberKeys=${memberKeys}`].filter(Boolean).join('&')}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each endpoint's body, read field by field below
    const get = async (path: string): Promise<any> => {
      const response = await http.as(who).get(`/v1/portfolio${path}`);
      expect(response.status).toBe(200);
      return response.body;
    };
    const [dashboard, metrics, allocation, topMovers, holdings, calendar, dividends, realized] = await Promise.all([
      get(`/dashboard${query('period=1M')}`),
      get(`/metrics${query('')}`),
      get(`/allocation${query('')}`),
      get(`/top-movers${query('period=1M')}`),
      get(`/holdings${query('')}`),
      get(`/calendar${query('')}`),
      get(`/dividend-income${query('')}`),
      get(`/realized-gains${query('')}`),
    ]);
    const quantities = Object.fromEntries((holdings.holdings as { financialAssetSymbol: string; quantity: number }[]).map((holding) => [holding.financialAssetSymbol, holding.quantity]));
    const allocationValues = Object.fromEntries((allocation.byAsset as { type: string; value: number }[]).map((item) => [item.type, item.value]));
    const contributions = Object.fromEntries([...topMovers.gainers, ...topMovers.losers].map((mover: { contribution: number; ticker: string }) => [mover.ticker, Math.round(mover.contribution)]));
    return {
      allocation: allocationValues,
      calendar: [...new Set((calendar.dividends as { symbol: string }[]).map((row) => row.symbol))].toSorted(),
      contributions,
      dividends: dividends.totalDividends as number,
      metricsValue: metrics.metrics.currentValue as number,
      portfolioCount: dashboard.summary.portfolioCount as number,
      portfolios: (dashboard.portfolios as { name: string }[]).map((portfolio) => portfolio.name).toSorted(),
      quantities,
      realizedGains: dashboard.summary.realizedGains as number,
      realizedReport: realized.totals.realizedGain as number,
      totalValue: dashboard.summary.totalValue as number,
    };
  }

  /** The overview of someone with no portfolios in the household. */
  const NOTHING = {
    allocation: {},
    calendar: [],
    contributions: {},
    dividends: 0,
    metricsValue: 0,
    portfolioCount: 0,
    portfolios: [],
    quantities: {},
    realizedGains: 0,
    realizedReport: 0,
    totalValue: 0,
  };

  it('shows each member only their own portfolios, a former member\'s under Shared, and the parts add up to the household', async () => {
    const { kid, owner, partner } = await seed();

    const household = await overview(owner);
    const owners = await overview(owner, String(owner.appuserKey));
    const partners = await overview(owner, String(partner.appuserKey));
    const kids = await overview(owner, String(kid.appuserKey));
    const shared = await overview(owner, 'shared');

    expect(household).toMatchObject({ dividends: 35, metricsValue: 3010, portfolioCount: 4, realizedGains: 110, realizedReport: 110, totalValue: 3010 });
    expect(household.quantities).toEqual({ ALPHA: 13, BETA: 7, GAMMA: 1 });

    expect(owners).toEqual({
      allocation: { ALPHA: 1040, BETA: 360 },
      calendar: ['ALPHA', 'BETA'],
      contributions: { ALPHA: 240, BETA: -40 },
      dividends: 20,
      metricsValue: 1400,
      portfolioCount: 2,
      portfolios: ['Owner empty', 'Owner shares'],
      quantities: { ALPHA: 8, BETA: 2 },
      realizedGains: 100,
      realizedReport: 100,
      totalValue: 1400,
    });
    expect(partners).toEqual({
      allocation: { ALPHA: 650, BETA: 720 },
      calendar: ['ALPHA', 'BETA'],
      contributions: { ALPHA: 150, BETA: -80 },
      dividends: 10,
      metricsValue: 1370,
      portfolioCount: 1,
      portfolios: ['Partner shares'],
      quantities: { ALPHA: 5, BETA: 4 },
      realizedGains: 10,
      realizedReport: 10,
      totalValue: 1370,
    });
    expect(kids).toEqual(NOTHING);
    expect(shared).toEqual({
      allocation: { BETA: 180, GAMMA: 60 },
      calendar: ['BETA', 'GAMMA'],
      contributions: { BETA: -20, GAMMA: 10 },
      dividends: 5,
      metricsValue: 240,
      portfolioCount: 1,
      portfolios: ['Former member shares'],
      quantities: { BETA: 1, GAMMA: 1 },
      realizedGains: 0,
      realizedReport: 0,
      totalValue: 240,
    });

    const parts = [owners, partners, kids, shared];
    const sum = (pick: (part: typeof household) => number) => parts.reduce((total, part) => total + pick(part), 0);
    expect(sum((part) => part.totalValue)).toBe(household.totalValue);
    expect(sum((part) => part.metricsValue)).toBe(household.metricsValue);
    expect(sum((part) => part.dividends)).toBe(household.dividends);
    expect(sum((part) => part.realizedGains)).toBe(household.realizedGains);
    expect(sum((part) => part.portfolioCount)).toBe(household.portfolioCount);
    for (const symbol of ['ALPHA', 'BETA', 'GAMMA']) {
      expect(sum((part) => part.quantities[symbol] ?? 0)).toBe(household.quantities[symbol]);
      expect(sum((part) => part.allocation[symbol] ?? 0)).toBe(household.allocation[symbol]);
      expect(sum((part) => part.contributions[symbol] ?? 0)).toBe(household.contributions[symbol]);
    }
  });

  it('keeps several members together, and Shared with them', async () => {
    const { owner, partner } = await seed();

    const together = await overview(owner, `${partner.appuserKey},shared`);

    expect(together).toMatchObject({ dividends: 15, portfolioCount: 2, realizedGains: 10, totalValue: 1610 });
    expect(together.quantities).toEqual({ ALPHA: 5, BETA: 5, GAMMA: 1 });
  });

  it('shows nothing for a member of another household, and never that household\'s portfolios', async () => {
    const { other, owner } = await seed();

    const outsider = await overview(owner, String(other.appuser.appuserKey));

    expect(outsider).toEqual(NOTHING);
  });

  it('narrows one portfolio\'s realized gains to nothing when another member owns it', async () => {
    const { owner, partner } = await seed();
    const partnerShares = await db.em().findOneOrFail(Portfolio, { name: 'Partner shares' });

    const ownersView = await http.as(owner).get(`/v1/portfolio/realized-gains?portfolioId=${partnerShares.portfolioKey}&memberKeys=${owner.appuserKey}`);
    const partnersView = await http.as(owner).get(`/v1/portfolio/realized-gains?portfolioId=${partnerShares.portfolioKey}&memberKeys=${partner.appuserKey}`);

    expect(ownersView.body.totals).toMatchObject({ realizedGain: 0, sales: 0 });
    expect(partnersView.body.totals).toMatchObject({ realizedGain: 10, sales: 1 });
  });

  it.each(['dashboard', 'metrics', 'allocation', 'top-movers', 'holdings', 'calendar', 'dividend-income', 'realized-gains'])('answers 400 on /%s to a member filter that is neither a member key nor shared', async (path) => {
    const { owner } = await seed();

    const response = await http.as(owner).get(`/v1/portfolio/${path}?memberKeys=everyone`);

    expect(response.status).toBe(400);
  });
});
