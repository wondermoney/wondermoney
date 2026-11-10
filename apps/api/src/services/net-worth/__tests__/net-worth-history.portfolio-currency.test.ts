import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate } from '@app/__tests__/__helpers__/portfolio-fixtures';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';

import { NetWorthService } from '../net-worth.service';

/*
 * A household whose members keep their books in different currencies: the owner in EUR, the
 * partner in USD. Each portfolio's snapshots are stored in its owner's currency; net worth history
 * shows them in the viewer's, converted at the rate in force at the end of the snapshot's day.
 *
 *   Owner (EUR):    portfolio worth 1000 EUR at the end of each of the last few months
 *   Partner (USD):  portfolio worth  500 USD at the end of each of the last few months
 */
describe('net-worth history of a household with portfolios in two currencies', () => {
  const db = useTestDatabase();

  const now = new Date();
  const monthsAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const endOfMonthAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 0));
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  const pointAt = (history: { points: { date: string }[] }, months: number) => history.points.find((point) => point.date === isoDate(endOfMonthAgo(months)));

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, currency: Currency, values: [Date, number][]) {
    const portfolio = em.create(Portfolio, { createdAt: monthsAgo(6), currencyKey: currency, name: `Shares ${currency.code}`, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    for (const [date, value] of values) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: currency, appuserCurrencyTotalValue: value, currencyKey: currency, portfolioKey: portfolio, snapshotDate: date, totalValue: value }, { partial: true });
    }
    await em.flush();
    // `createdAt` is set on create; back-date it so the earlier points count the portfolio.
    await em.getConnection().execute('update "portfolio" set "created_at" = ? where "portfolio_key" = ?', [monthsAgo(6), portfolio.portfolioKey]);
    return portfolio;
  }

  async function mixedHousehold(options: { rates?: [number, string, number][] } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    // No accounts or loans: the history is the portfolios alone.
    await em.getConnection().execute('update "account" set "deleted_at" = now() where "account_key" = ?', [household.account.accountKey]);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const rates = options.rates ?? [[12, 'USD>EUR', 0.8], [12, 'EUR>USD', 1.25]];
    for (const [months, pair, rate] of rates) {
      const [from, to] = pair === 'USD>EUR' ? [usd, eur] : [eur, usd];
      await addExchangeRate(em, from, to, isoDate(monthsAgo(months)), rate);
    }
    const monthEnds = [3, 2, 1].map(endOfMonthAgo);
    await addPortfolio(em, household, household.appuser, eur, monthEnds.map((date) => [date, 1000]));
    await addPortfolio(em, household, partner, usd, monthEnds.map((date) => [date, 500]));
    return { household, partner };
  }

  it('shows both members\' portfolios in euros to the euro owner', async () => {
    const { household } = await mixedHousehold();

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.currencyCode).toBe('EUR');
    expect(pointAt(history, 1)).toMatchObject({ isComplete: true, portfoliosTotal: 1400, totalNetWorth: 1400 });
    expect(pointAt(history, 2)).toMatchObject({ isComplete: true, portfoliosTotal: 1400, totalNetWorth: 1400 });
  });

  it('shows both members\' portfolios in dollars to the dollar partner', async () => {
    const { partner } = await mixedHousehold();

    const history = await new NetWorthService().getNetWorthHistory(partner, { months: 3 });

    expect(history.currencyCode).toBe('USD');
    expect(pointAt(history, 1)).toMatchObject({ isComplete: true, portfoliosTotal: 1750, totalNetWorth: 1750 });
  });

  it('converts each snapshot at the rate in force at the end of its own day', async () => {
    const { household } = await mixedHousehold({ rates: [[12, 'USD>EUR', 0.8], [1, 'USD>EUR', 0.9]] });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(pointAt(history, 2)).toMatchObject({ isComplete: true, portfoliosTotal: 1400 });
    expect(pointAt(history, 1)).toMatchObject({ isComplete: true, portfoliosTotal: 1450 });
  });

  it('leaves a point incomplete when a portfolio snapshot has no rate into the viewer\'s currency, never adding it at face value', async () => {
    const { household } = await mixedHousehold({ rates: [] });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(pointAt(history, 1)).toMatchObject({ isComplete: false, portfoliosTotal: null, totalNetWorth: null });
  });

  it('leaves a point incomplete when the snapshot\'s first rate is published after its day', async () => {
    const { household } = await mixedHousehold({ rates: [[1, 'USD>EUR', 0.8]] });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(pointAt(history, 2)).toMatchObject({ isComplete: false, portfoliosTotal: null });
    expect(pointAt(history, 1)).toMatchObject({ isComplete: true, portfoliosTotal: 1400 });
  });

  it('converts a snapshot stored before its owner-currency value was recorded from the portfolio\'s currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await em.getConnection().execute('update "account" set "deleted_at" = now() where "account_key" = ?', [household.account.accountKey]);
    const usd = await currencyFor(em, 'USD');
    await addExchangeRate(em, usd, household.currency, isoDate(monthsAgo(12)), 0.8);
    const portfolio = await addPortfolio(em, household, household.appuser, usd, []);
    em.create(PortfolioSnapshot, { currencyKey: usd, portfolioKey: portfolio, snapshotDate: endOfMonthAgo(1), totalValue: 500 }, { partial: true });
    await em.flush();

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(pointAt(history, 1)).toMatchObject({ isComplete: true, portfoliosTotal: 400 });
  });
});
