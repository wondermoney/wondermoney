import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/portfolio/asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { getBenchmarkHistoricalPrices: vi.fn().mockResolvedValue([]) }) };
});

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import portfolioRoutes from '@route/portfolio';

/*
 * The aggregate portfolio chart (`GET /v1/portfolio/performance`) under the member filter, by the
 * rule the portfolio performance report and net worth already follow: a portfolio is its owner's
 * outright, and one whose owner left the household is Shared. One household, all in euros:
 *
 *   Owner:          portfolio worth 1000 the day before yesterday, 1100 yesterday
 *   Partner:        portfolio worth  500 the day before yesterday,  600 yesterday,
 *                   and a private account of 5000 the owner cannot see
 *   Kid:            no portfolio
 *   Former member:  portfolio worth   50 the day before yesterday,   60 yesterday (Shared)
 *   Another household's portfolio of 9000, which never counts.
 */
describe('the portfolio chart, filtered by member', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  const day = (daysAgo: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo)).toISOString().slice(0, 10);
  };
  const dayBefore = day(2);
  const yesterday = day(1);

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, name: string, values: [number, number]) {
    const portfolio = em.create(Portfolio, { currencyKey: household.currency, name, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    for (const [date, value] of [[dayBefore, values[0]], [yesterday, values[1]]] as const) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: household.currency, appuserCurrencyTotalValue: value, currencyKey: household.currency, portfolioKey: portfolio, snapshotDate: new Date(`${date}T00:00:00Z`), totalValue: value }, { partial: true });
    }
    await em.flush();
    return portfolio;
  }

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const owner = household.appuser;
    const partner = await addPartner(em, household);
    const kid = await addPartner(em, household);
    const former = await addPartner(em, household);
    await addAccount(em, household, { appuserCurrencyBalance: 5000, balance: 5000, isPrivate: true, name: 'Partner private', owner: partner });
    await addPortfolio(em, household, owner, 'Owner shares', [1000, 1100]);
    const partnerPortfolio = await addPortfolio(em, household, partner, 'Partner shares', [500, 600]);
    await addPortfolio(em, household, former, 'Former member shares', [50, 60]);

    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: former, tenantKey: household.tenant });
    membership.recordActive = false;
    await em.flush();

    const other = await seedHousehold(em);
    await addPortfolio(em, other, other.appuser, 'Other household shares', [9000, 9000]);

    return { em, household, kid, other, owner, partner, partnerPortfolio };
  }

  const values = (body: { dataPoints: { value: number }[] }) => body.dataPoints.map((point) => point.value);

  it('charts the portfolios each member owns, a former member\'s as Shared, and the parts add up to the household', async () => {
    const { kid, owner, partner } = await seed();
    const chart = async (memberKeys?: string) => {
      const response = await http.as(owner).get(`/v1/portfolio/performance?period=1M${memberKeys === undefined ? '' : `&memberKeys=${memberKeys}`}`);
      expect(response.status).toBe(200);
      return response.body as { dataPoints: { date: string; value: number }[]; normalizedDataPoints: { value: number }[] };
    };

    const household = await chart();
    const owners = await chart(String(owner.appuserKey));
    const partners = await chart(String(partner.appuserKey));
    const kids = await chart(String(kid.appuserKey));
    const shared = await chart('shared');

    expect(household.dataPoints).toEqual([{ date: dayBefore, value: 1550 }, { date: yesterday, value: 1760 }]);
    expect(values(owners)).toEqual([1000, 1100]);
    // The partner's private 5000 is an account, never part of their portfolios' value.
    expect(values(partners)).toEqual([500, 600]);
    expect(values(kids)).toEqual([]);
    expect(values(shared)).toEqual([50, 60]);
    expect([owners, partners, kids, shared].reduce((total, part) => [0, 1].map((index) => (total[index] ?? 0) + (values(part)[index] ?? 0)), [0, 0])).toEqual(values(household));
    // The return is the member's own: the owner's portfolio went from 1000 to 1100.
    expect(owners.normalizedDataPoints.at(-1)?.value).toBeCloseTo(10, 6);
  });

  it('keeps several members together, and Shared with them', async () => {
    const { owner, partner } = await seed();

    const response = await http.as(owner).get(`/v1/portfolio/performance?period=1M&memberKeys=${partner.appuserKey},shared`);

    expect(values(response.body)).toEqual([550, 660]);
  });

  it('charts nothing for a member of another household, and never that household\'s portfolios', async () => {
    const { other, owner } = await seed();

    const response = await http.as(owner).get(`/v1/portfolio/performance?period=1M&memberKeys=${other.appuser.appuserKey}`);

    expect(response.status).toBe(200);
    expect(values(response.body)).toEqual([]);
  });

  it('answers 400 to a member filter that is neither a member key nor shared', async () => {
    const { owner } = await seed();

    const response = await http.as(owner).get('/v1/portfolio/performance?period=1M&memberKeys=everyone');

    expect(response.status).toBe(400);
  });

  it('still charts a member\'s portfolios when another member\'s holds an oversold position', async () => {
    const { em, household, owner, partner, partnerPortfolio } = await seed();
    // A sale with no purchase before it: the partner's holding has negative units.
    const { asset } = await seedPortfolio(em, household);
    em.create(FinancialTransaction, {
      appuserKey: partner,
      financialAssetKey: asset,
      financialTransactionTypeKey: await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.SELL }),
      internalTransactionId: 'oversold-sale',
      portfolioKey: partnerPortfolio,
      quantity: 5,
      settlementAmount: 500,
      settlementCurrencyKey: household.currency,
      settlementUnitAmount: 100,
      tenantKey: household.tenant,
      transactionDate: new Date(`${dayBefore}T00:00:00Z`),
    }, { partial: true });
    await em.flush();

    const owners = await http.as(owner).get(`/v1/portfolio/performance?period=1M&memberKeys=${owner.appuserKey}`);
    const partners = await http.as(owner).get(`/v1/portfolio/performance?period=1M&memberKeys=${partner.appuserKey}`);

    expect(values(owners.body)).toEqual([1000, 1100]);
    // The partner's own chart, like the household's, cannot be drawn until the sale is fixed.
    expect(partners.body.portfolioHistoryStatus).toBe('empty');
    expect(values(partners.body)).toEqual([]);
  });
});
