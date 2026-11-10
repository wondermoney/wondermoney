import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// Today's portfolio value comes from pricing its holdings, which is not what these tests are about:
// each portfolio is worth what `livePortfolioValues` says.
const livePortfolioValues = vi.hoisted(() => new Map<number, number>());
vi.mock('@service/portfolio/portfolio-holdings.service', () => ({
  default: {
    getPortfolioValues: (_appuser: unknown, keys: number[]) =>
      Promise.resolve(new Map(keys.map((key) => [key, { isComplete: true, value: livePortfolioValues.get(key) ?? 0 }]))),
  },
}));

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { AccountType } from '@entity/AccountType';
import { Appuser } from '@entity/Appuser';
import { Portfolio, PortfolioAccountBalanceMode } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import netWorthRoutes from '@route/net-worth';
import { getNetWorthHistoryReport } from '@service/reports/netWorthHistory.service';

/*
 * A brokerage account whose balance already includes the securities, tracked as well as a
 * portfolio, must not be counted twice. The portfolio is linked to the account, and the link says
 * whether the account's balance includes the holdings (`includes_holdings`: count the account and
 * show the portfolio without adding it) or only the cash (`cash_only`: count both).
 *
 *   Current account     1 000 EUR
 *   Brokerage account  10 000 EUR   (cash plus securities)
 *   Portfolio           8 000 EUR   (the securities)
 */
describe('net worth with a portfolio linked to its account', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/net-worth', netWorthRoutes);

  const now = new Date();
  const monthsAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const endOfMonthAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 0));
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);

  beforeEach(() => {
    livePortfolioValues.clear();
  });

  const portfolioRow = (body: { rows: { id?: number; type: string }[] }, portfolio: Portfolio) =>
    body.rows.find((row) => row.type === 'portfolios' && row.id === portfolio.portfolioKey);

  async function investmentType(em: EntityManager): Promise<AccountType> {
    const type = (await em.findOne(AccountType, { description: 'INVESTMENT' })) ?? em.create(AccountType, { description: 'INVESTMENT' }, { partial: true });
    await em.flush();
    return type;
  }

  /** Back-date an account so history points before today count it at its opening balance. */
  async function openSince(em: EntityManager, account: Account, since: Date, balance: number) {
    await em.nativeUpdate(Account, { accountKey: account.accountKey }, { appuserCurrencyBalance: balance, balance, createdAt: since, openingBalance: balance, openingBalanceDate: since });
  }

  async function addPortfolio(em: EntityManager, household: Household, input: { createdAt?: Date; link?: { account: Account; mode: PortfolioAccountBalanceMode }; owner?: Appuser; snapshotsSince?: Date; value: number }) {
    const portfolio = em.create(Portfolio, {
      accountBalanceMode: input.link?.mode ?? null,
      currencyKey: household.currency,
      linkedAccountKey: input.link?.account ?? null,
      name: 'Shares',
      portfolioOwnerAppuserKey: input.owner ?? household.appuser,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    if (input.createdAt) await em.nativeUpdate(Portfolio, { portfolioKey: portfolio.portfolioKey }, { createdAt: input.createdAt });
    if (input.snapshotsSince) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: household.currency, appuserCurrencyTotalValue: input.value, currencyKey: household.currency, portfolioKey: portfolio, snapshotDate: input.snapshotsSince, totalValue: input.value }, { partial: true });
      await em.flush();
    }
    livePortfolioValues.set(portfolio.portfolioKey, input.value);
    return portfolio;
  }

  async function brokerageHousehold(input: { brokeragePrivate?: boolean; mode?: PortfolioAccountBalanceMode } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    await openSince(em, household.account, monthsAgo(4), 1000);
    const brokerage = await addAccount(em, household, { isPrivate: input.brokeragePrivate ?? false, name: 'Brokerage' });
    await em.nativeUpdate(Account, { accountKey: brokerage.accountKey }, { accountTypeKey: await investmentType(em) });
    await openSince(em, brokerage, monthsAgo(4), 10_000);
    const portfolio = await addPortfolio(em, household, {
      createdAt: monthsAgo(4),
      link: input.mode ? { account: brokerage, mode: input.mode } : undefined,
      snapshotsSince: monthsAgo(4),
      value: 8000,
    });
    return { brokerage, household, partner, portfolio };
  }

  describe('today', () => {
    it('counts the account once and shows the portfolio as a row that does not add to the total', async () => {
      const { brokerage, household, portfolio } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(11_000);
      expect(body.assets).toEqual({ accounts: 11_000, portfolios: 0 });
      expect(portfolioRow(body, portfolio)).toMatchObject({ balance: 8000, countedInAccountId: brokerage.accountKey, name: 'Shares' });
    });

    it('counts both when the account holds only the cash', async () => {
      const { household, portfolio } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.CASH_ONLY });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(19_000);
      expect(body.assets).toEqual({ accounts: 11_000, portfolios: 8000 });
      expect(portfolioRow(body, portfolio)).toMatchObject({ balance: 8000, name: 'Shares' });
      expect(portfolioRow(body, portfolio)).not.toHaveProperty('countedInAccountId');
    });

    it('counts an unlinked portfolio as before', async () => {
      const { household } = await brokerageHousehold();

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(19_000);
      expect(body.rows.filter((row: { countedInAccountId?: number }) => row.countedInAccountId != null)).toEqual([]);
    });

    it('counts the portfolio again once its account is deleted', async () => {
      const { brokerage, household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });
      await db.em().nativeUpdate(Account, { accountKey: brokerage.accountKey }, { deletedAt: new Date() });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(9000);
      expect(body.assets).toEqual({ accounts: 1000, portfolios: 8000 });
    });
  });

  describe('a private account linked to a shared portfolio', () => {
    it('counts the account, not the portfolio, for the member who owns the account', async () => {
      const { household } = await brokerageHousehold({ brokeragePrivate: true, mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(11_000);
    });

    it('counts the portfolio for the other member, who cannot see the account, and says nothing of the link', async () => {
      const { brokerage, partner, portfolio } = await brokerageHousehold({ brokeragePrivate: true, mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });

      const { body } = await http.as(partner).get('/v1/net-worth');

      expect(body.totalNetWorth).toBe(9000);
      expect(body.assets).toEqual({ accounts: 1000, portfolios: 8000 });
      expect(portfolioRow(body, portfolio)).toMatchObject({ balance: 8000, name: 'Shares' });
      expect(portfolioRow(body, portfolio)).not.toHaveProperty('countedInAccountId');
      expect(JSON.stringify(body)).not.toContain('Brokerage');
      expect(body.rows.map((row: { id?: number }) => row.id)).not.toContain(brokerage.accountKey);
    });
  });

  describe('history', () => {
    const pastPoint = () => isoDate(endOfMonthAgo(1));

    it('leaves a linked portfolio out of past points when the account includes the holdings', async () => {
      const { household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });

      const { body } = await http.as(household.appuser).get('/v1/net-worth/history?months=3');

      expect(body.points.find((point: { date: string }) => point.date === pastPoint())).toMatchObject({ accountsTotal: 11_000, isComplete: true, portfoliosTotal: 0, totalNetWorth: 11_000 });
      expect(body.points.at(-1)).toMatchObject({ portfoliosTotal: 0, totalNetWorth: 11_000 });
    });

    it('adds a linked portfolio to past points when the account holds only the cash', async () => {
      const { household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.CASH_ONLY });

      const { body } = await http.as(household.appuser).get('/v1/net-worth/history?months=3');

      expect(body.points.find((point: { date: string }) => point.date === pastPoint())).toMatchObject({ portfoliosTotal: 8000, totalNetWorth: 19_000 });
    });

    it('counts the portfolio at points before its account was added', async () => {
      const { brokerage, household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });
      await db.em().nativeUpdate(Account, { accountKey: brokerage.accountKey }, { createdAt: monthsAgo(0), openingBalanceDate: monthsAgo(0) });

      const { body } = await http.as(household.appuser).get('/v1/net-worth/history?months=3');

      expect(body.points.find((point: { date: string }) => point.date === pastPoint())).toMatchObject({ accountsTotal: 1000, portfoliosTotal: 8000, totalNetWorth: 9000 });
    });

    it('counts the portfolio in the other member\'s history when the linked account is private', async () => {
      const { partner } = await brokerageHousehold({ brokeragePrivate: true, mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });

      const { body } = await http.as(partner).get('/v1/net-worth/history?months=3');

      expect(body.points.find((point: { date: string }) => point.date === pastPoint())).toMatchObject({ accountsTotal: 1000, portfoliosTotal: 8000, totalNetWorth: 9000 });
    });

    it('reports the same assets in the net worth history report', async () => {
      const { household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });
      const user = await db.em().findOneOrFail(Appuser, { appuserKey: household.appuser.appuserKey }, { filters: false, populate: ['currencyKey'] });

      const rows = await getNetWorthHistoryReport({ filters: {}, tenant: household.tenant, user } as Parameters<typeof getNetWorthHistoryReport>[0]);

      const lastMonth = rows.find((row) => row.date.startsWith(isoDate(monthsAgo(1)).slice(0, 7)));
      expect(lastMonth).toMatchObject({ breakdown: { assets: 11_000, liabilities: 0 }, netWorth: 11_000 });
    });
  });

  describe('suggesting a link', () => {
    it('suggests linking when the household has an investment account and an unlinked portfolio', async () => {
      const { household } = await brokerageHousehold();

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.suggestPortfolioLink).toBe(true);
    });

    it('does not suggest it once every portfolio is linked', async () => {
      const { household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.CASH_ONLY });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.suggestPortfolioLink).toBe(false);
    });

    it('does not suggest it for an investment account already linked to a portfolio, by either member', async () => {
      const { household, partner } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });
      await addPortfolio(db.em(), household, { owner: partner, value: 500 });

      const owner = await http.as(household.appuser).get('/v1/net-worth');
      const member = await http.as(partner).get('/v1/net-worth');

      expect(owner.body.suggestPortfolioLink).toBe(false);
      expect(member.body.suggestPortfolioLink).toBe(false);
    });

    it('still suggests it for another investment account that no portfolio is linked to', async () => {
      const { household } = await brokerageHousehold({ mode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS });
      const em = db.em();
      const second = await addAccount(em, household, { name: 'Second brokerage' });
      await em.nativeUpdate(Account, { accountKey: second.accountKey }, { accountTypeKey: await investmentType(em) });
      await addPortfolio(em, household, { value: 500 });

      const { body } = await http.as(household.appuser).get('/v1/net-worth');

      expect(body.suggestPortfolioLink).toBe(true);
    });

    it('does not suggest it without an investment account the viewer can see', async () => {
      const { partner } = await brokerageHousehold({ brokeragePrivate: true });

      const { body } = await http.as(partner).get('/v1/net-worth');

      expect(body.suggestPortfolioLink).toBe(false);
    });
  });
});
