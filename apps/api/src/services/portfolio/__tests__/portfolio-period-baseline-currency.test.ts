import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addPartner, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate } from '@app/__tests__/__helpers__/portfolio-fixtures';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';

import { findSnapshotPointOnOrBefore, measurePortfolioPeriod } from '../portfolio-period-performance';

/*
 * The period return compares the period's start snapshot with the live value, which is in the
 * viewer's currency. A snapshot is stored in its owner's currency, so in a household whose members
 * keep different currencies the baseline is converted at the rate in force at the end of its day.
 *
 * Rates: 1 EUR = 1.25 USD and 1 USD = 0.8 EUR from 2026-01-01; 1 USD = 0.9 EUR from 2026-03-01.
 */
describe('period-return baseline for a household with members in two currencies', () => {
  const db = useTestDatabase();

  async function addPortfolio(em: EntityManager, household: Household, owner: Appuser, currency: Currency, values: [string, number][]) {
    const portfolio = em.create(Portfolio, { currencyKey: currency, name: `Shares ${currency.code}`, portfolioOwnerAppuserKey: owner, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    for (const [date, value] of values) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: currency, appuserCurrencyTotalValue: value, currencyKey: currency, portfolioKey: portfolio, snapshotDate: new Date(`${date}T00:00:00Z`), totalValue: value }, { partial: true });
    }
    await em.flush();
    return portfolio;
  }

  async function mixedHousehold(withRates = true) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    if (withRates) {
      await addExchangeRate(em, eur, usd, '2026-01-01', 1.25);
      await addExchangeRate(em, usd, eur, '2026-01-01', 0.8);
      await addExchangeRate(em, usd, eur, '2026-03-01', 0.9);
    }
    const ownerPortfolio = await addPortfolio(em, household, household.appuser, eur, [['2026-01-31', 1000]]);
    const partnerPortfolio = await addPortfolio(em, household, partner, usd, [['2026-01-31', 500], ['2026-03-31', 600]]);
    return { ownerPortfolio, partnerPortfolio };
  }

  it('reads the partner\'s dollar baseline in euros for the euro viewer', async () => {
    const { partnerPortfolio } = await mixedHousehold();

    const point = await findSnapshotPointOnOrBefore(partnerPortfolio.portfolioKey, new Date('2026-02-15T00:00:00Z'), 'EUR');

    expect(point).toEqual({ day: '2026-01-31', value: 400 });
  });

  it('reads the owner\'s euro baseline in dollars for the dollar viewer', async () => {
    const { ownerPortfolio } = await mixedHousehold();

    const point = await findSnapshotPointOnOrBefore(ownerPortfolio.portfolioKey, new Date('2026-02-15T00:00:00Z'), 'USD');

    expect(point).toEqual({ day: '2026-01-31', value: 1250 });
  });

  it('converts at the rate in force on the snapshot\'s day, not today\'s', async () => {
    const { partnerPortfolio } = await mixedHousehold();

    const january = await findSnapshotPointOnOrBefore(partnerPortfolio.portfolioKey, new Date('2026-02-15T00:00:00Z'), 'EUR');
    const march = await findSnapshotPointOnOrBefore(partnerPortfolio.portfolioKey, new Date('2026-04-15T00:00:00Z'), 'EUR');

    expect(january?.value).toBe(400);
    expect(march?.value).toBe(540);
  });

  it('leaves the snapshot\'s own value alone when it is already in the viewer\'s currency', async () => {
    const { ownerPortfolio } = await mixedHousehold(false);

    const point = await findSnapshotPointOnOrBefore(ownerPortfolio.portfolioKey, new Date('2026-02-15T00:00:00Z'), 'EUR');

    expect(point).toEqual({ day: '2026-01-31', value: 1000 });
  });

  it('cannot measure the period when the baseline has no rate into the viewer\'s currency, never using it at face value', async () => {
    const { partnerPortfolio } = await mixedHousehold(false);

    const startSnapshot = await findSnapshotPointOnOrBefore(partnerPortfolio.portfolioKey, new Date('2026-02-15T00:00:00Z'), 'EUR');
    const measure = measurePortfolioPeriod({ end: { kind: 'live', value: 450 }, flows: [], fromDate: new Date('2026-02-15T00:00:00Z'), startSnapshot });

    expect(startSnapshot).toEqual({ day: '2026-01-31', value: null });
    expect(measure).toMatchObject({ change: null, changePercent: null, startValue: null });
  });
});
