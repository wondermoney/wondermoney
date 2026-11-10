import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { getPortfolioPerformanceReport } from '@service/reports/portfolioPerformance.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * A period's return takes the buys and sales inside it out of the change. Each trade is recorded
 * in the currency of the member who entered it, and the start and end values are read in the
 * viewer's currency, so every trade is converted into the viewer's currency at the rate of its own
 * date first. A trade no rate converts makes the return unknown; it is never added at face value.
 *
 * The household: the owner keeps EUR, the partner USD. The owner's portfolio was worth 10 000 EUR on
 * 2026-07-31 and 12 000 EUR on 2026-09-30, and the owner bought 1 000 EUR of shares on 2026-08-10.
 *
 * Rates: 1 EUR = 1.25 USD from 2026-07-01, 1.5 USD from 2026-09-01.
 */
describe('period return: trades in the period, in the viewer\'s currency', () => {
  const db = useTestDatabase();
  const NOW = new Date('2026-11-05T12:00:00Z');
  const PERIOD = { fromDate: '2026-08-01T00:00:00Z', toDate: '2026-09-30T23:59:59Z' };

  async function mixedHousehold(input: { withRates?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const setup = await seedPortfolio(em, household);
    const { asset, portfolio, usd } = setup;
    const eur = household.currency;
    const partner = await addPartner(em, household, { currency: usd });
    if (input.withRates ?? true) {
      await addExchangeRate(em, eur, usd, '2026-07-01', 1.25);
      await addExchangeRate(em, eur, usd, '2026-09-01', 1.5);
    }
    for (const [day, value] of [['2026-07-31', 10_000], ['2026-09-30', 12_000]] as const) {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: eur, appuserCurrencyTotalValue: value, currencyKey: eur, portfolioKey: portfolio, snapshotDate: new Date(`${day}T00:00:00Z`), totalValue: value }, { partial: true });
    }
    await em.flush();

    const buyType = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.BUY });
    /** A buy settled in the buyer's own currency, so no converted amount is stored. */
    const buy = async (buyer: Appuser, currency: Currency, day: string, quantity: number, unitAmount: number) => {
      em.create(FinancialTransaction, {
        appuserKey: buyer,
        financialAssetKey: asset,
        financialTransactionTypeKey: buyType,
        internalTransactionId: `buy-${day}-${quantity}`,
        portfolioKey: portfolio,
        quantity,
        settlementAmount: quantity * unitAmount,
        settlementCurrencyKey: currency,
        settlementUnitAmount: unitAmount,
        tenantKey: household.tenant,
        transactionDate: new Date(`${day}T10:00:00Z`),
      }, { partial: true });
      await em.flush();
    };
    await buy(household.appuser, eur, '2026-08-10', 10, 100);

    const report = async (viewer: Appuser) => {
      const [row] = await getPortfolioPerformanceReport({ filters: reportFiltersSchema.parse(PERIOD), tenant: household.tenant, user: viewer }, NOW);
      return row;
    };
    const dividendType = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.DIVIDEND });
    /** A dividend settled in `currency` and stored with no converted amount, as one is with no rate. */
    const dividend = async (currency: Currency, day: string, amount: number) => {
      em.create(FinancialTransaction, {
        appuserKey: household.appuser,
        financialAssetKey: asset,
        financialTransactionTypeKey: dividendType,
        internalTransactionId: `dividend-${day}`,
        portfolioKey: portfolio,
        quantity: 1,
        settlementAmount: amount,
        settlementCurrencyKey: currency,
        settlementUnitAmount: amount,
        tenantKey: household.tenant,
        transactionDate: new Date(`${day}T10:00:00Z`),
      }, { partial: true });
      await em.flush();
    };
    return { buy, dividend, em, eur, household, partner, report, usd };
  }

  it('measures the owner\'s period in euros', async () => {
    const { household, report } = await mixedHousehold();

    expect(await report(household.appuser)).toMatchObject({ change: 1000, endValue: 12_000, netContributions: 1000, startValue: 10_000 });
  });

  it('converts the owner\'s euro buy into dollars for the partner, at the rate of its date', async () => {
    const { partner, report } = await mixedHousehold();

    // Start 10 000 EUR at 1.25, end 12 000 EUR at 1.5, and the buy 1 000 EUR at 1.25 (August).
    expect(await report(partner)).toMatchObject({ change: 4250, endValue: 18_000, netContributions: 1250, startValue: 12_500 });
  });

  it('cannot measure the period when a trade in it has no rate into the viewer\'s currency', async () => {
    const { buy, household, partner, report, usd } = await mixedHousehold();
    // The partner buys in dollars; nothing converts dollars into euros.
    await buy(partner, usd, '2026-09-10', 5, 100);

    expect(await report(household.appuser)).toMatchObject({ change: null, changePercent: null, endValue: 12_000, netContributions: null, startValue: 10_000 });
  });

  it('does not need a rate for a trade the start value already holds', async () => {
    const { buy, household, partner, report, usd } = await mixedHousehold();
    await buy(partner, usd, '2026-07-15', 5, 100);

    expect(await report(household.appuser)).toMatchObject({ change: 1000, netContributions: 1000 });
  });

  it('converts a dividend paid in another currency with no converted amount at its date\'s rate', async () => {
    const { dividend, em, eur, household, report, usd } = await mixedHousehold();
    await addExchangeRate(em, usd, eur, '2026-07-01', 0.8);
    await dividend(usd, '2026-08-20', 50);

    expect(await report(household.appuser)).toMatchObject({ dividends: 40 });
  });

  it('cannot total the dividends when one paid in another currency has no rate', async () => {
    const { dividend, household, report, usd } = await mixedHousehold();
    await dividend(usd, '2026-08-20', 50);

    expect(await report(household.appuser)).toMatchObject({ dividends: null });
  });
});
