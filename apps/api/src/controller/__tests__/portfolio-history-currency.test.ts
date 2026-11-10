import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/portfolio/asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { getBenchmarkHistoricalPrices: vi.fn().mockResolvedValue([]) }) };
});

import type { EntityManager } from '@mikro-orm/postgresql';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import portfolioRoutes from '@route/portfolio';

/*
 * A household whose members keep their books in different currencies: the owner in EUR, the
 * partner in USD (or JPY, with no rate). Each portfolio's daily snapshots are stored in its
 * owner's currency. The history chart shows them in the viewer's currency, converted at each
 * day's rate, and flags a day it could not convert in full rather than adding a dollar to a euro.
 *
 * Rates: 1 EUR = 1.25 USD and 1 USD = 0.8 EUR, published before any snapshot.
 *
 *   Owner (EUR):   portfolio worth 1000 EUR the day before yesterday, 1100 EUR yesterday
 *   Partner:       portfolio worth  500 the day before yesterday,  600 yesterday
 */
describe('portfolio history for a household with members in two currencies', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio', portfolioRoutes);

  const day = (daysAgo: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo)).toISOString().slice(0, 10);
  };
  const dayBefore = day(2);
  const yesterday = day(1);

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, currency: Currency, values: [string, number][]) {
    const portfolio = em.create(Portfolio, { currencyKey: currency, name: `Shares ${currency.code}`, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    for (const [date, value] of values) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: currency, appuserCurrencyTotalValue: value, currencyKey: currency, portfolioKey: portfolio, snapshotDate: new Date(`${date}T00:00:00Z`), totalValue: value }, { partial: true });
    }
    await em.flush();
    return portfolio;
  }

  async function mixedHousehold(partnerCurrencyCode = 'USD', withRates = true) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const foreign = await currencyFor(em, partnerCurrencyCode);
    const partner = await addPartner(em, household, { currency: foreign });
    if (withRates) {
      await addExchangeRate(em, eur, foreign, day(10), 1.25);
      await addExchangeRate(em, foreign, eur, day(10), 0.8);
    }
    await addPortfolio(em, household, household.appuser, eur, [[dayBefore, 1000], [yesterday, 1100]]);
    const partnerPortfolio = await addPortfolio(em, household, partner, foreign, [[dayBefore, 500], [yesterday, 600]]);
    return { em, household, partner, partnerPortfolio };
  }

  it('shows the household history in euros to the euro owner', async () => {
    const { household } = await mixedHousehold();

    const response = await http.as(household.appuser).get('/v1/portfolio/performance?period=1M');

    expect(response.status).toBe(200);
    expect(response.body.dataPoints).toEqual([{ date: dayBefore, value: 1400 }, { date: yesterday, value: 1580 }]);
    expect(response.body.completeness).toEqual({ currencyCode: 'EUR', incompleteDates: [], isComplete: true });
  });

  it('shows the household history in dollars to the dollar partner', async () => {
    const { partner } = await mixedHousehold();

    const response = await http.as(partner).get('/v1/portfolio/performance?period=1M');

    expect(response.body.dataPoints).toEqual([{ date: dayBefore, value: 1750 }, { date: yesterday, value: 1975 }]);
    expect(response.body.completeness).toEqual({ currencyCode: 'USD', incompleteDates: [], isComplete: true });
  });

  it('shows the partner\'s own portfolio in the viewer\'s currency', async () => {
    const { household, partnerPortfolio } = await mixedHousehold();

    const response = await http.as(household.appuser).get(`/v1/portfolio/${partnerPortfolio.portfolioKey}/performance?period=1M`);

    expect(response.status).toBe(200);
    expect(response.body.dataPoints).toEqual([{ date: dayBefore, value: 400 }, { date: yesterday, value: 480 }]);
    expect(response.body.completeness.isComplete).toBe(true);
  });

  it('leaves out a member it has no rate for and flags those days, never adding them at face value', async () => {
    const { household } = await mixedHousehold('JPY', false);

    const response = await http.as(household.appuser).get('/v1/portfolio/performance?period=1M');

    expect(response.body.dataPoints).toEqual([{ date: dayBefore, value: 1000 }, { date: yesterday, value: 1100 }]);
    expect(response.body.completeness).toEqual({ currencyCode: 'EUR', incompleteDates: [dayBefore, yesterday], isComplete: false });
  });

  it('reads a snapshot stored only in its portfolio\'s currency in that currency, not its owner\'s', async () => {
    const { em, household, partnerPortfolio } = await mixedHousehold();
    // The dollar partner's portfolio, held and valued in euros, with no dollar value stored.
    await em.nativeUpdate(PortfolioSnapshot, { portfolioKey: partnerPortfolio }, { appuserCurrencyKey: null, appuserCurrencyTotalValue: null, currencyKey: household.currency, totalValue: 450 });

    const response = await http.as(household.appuser).get(`/v1/portfolio/${partnerPortfolio.portfolioKey}/performance?period=1M`);

    expect(response.body.dataPoints).toEqual([{ date: dayBefore, value: 450 }, { date: yesterday, value: 450 }]);
  });
});
