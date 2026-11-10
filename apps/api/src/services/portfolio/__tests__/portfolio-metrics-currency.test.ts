import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import type { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import type { PortfolioHolding } from '@service/portfolio/portfolio-holdings.utils';

import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioMetricsService from '../portfolio-metrics.service';
import { calculateMaxDrawdown, calculateVolatility } from '../portfolio-metrics.utils';

/*
 * The annual yield (XIRR), volatility and max drawdown read the household's cash flows and daily
 * snapshots together with the live value, which is in the viewer's currency. Members keep their own
 * currencies, so every flow and snapshot is converted into the viewer's currency first: a flow at the
 * rate of its date, a snapshot at the rate in force at the end of its day. When one cannot be
 * converted the metric is unknown (null), never computed from amounts in two currencies.
 *
 * The household: the owner keeps EUR, the partner USD.
 */
describe('portfolio metrics in the viewer\'s currency', () => {
  const db = useTestDatabase();
  const DAY_MS = 86_400_000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);

  afterEach(() => vi.restoreAllMocks());

  async function mixedHousehold() {
    const em = db.em();
    const household = await seedHousehold(em);
    const setup = await seedPortfolio(em, household);
    const partner = await addPartner(em, household, { currency: setup.usd });
    return { ...setup, em, eur: household.currency, household, partner };
  }

  /** The live value the holdings report, in the viewer's currency. */
  function liveValue(value: number) {
    vi.spyOn(portfolioHoldingsService, 'getPortfoliosHoldings').mockResolvedValue([{ averageBuyPrice: value, currentValue: value, financialAssetType: 'Stock', quantity: 1 } as PortfolioHolding]);
  }

  async function buy(em: EntityManager, household: Household, setup: { asset: FinancialAsset; portfolio: Portfolio }, input: { amount: number; buyer: Appuser; currency: Currency; date: Date }) {
    const buyType = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.BUY });
    em.create(FinancialTransaction, {
      appuserKey: input.buyer,
      financialAssetKey: setup.asset,
      financialTransactionTypeKey: buyType,
      internalTransactionId: `buy-${input.date.getTime()}`,
      portfolioKey: setup.portfolio,
      quantity: 1,
      settlementAmount: input.amount,
      settlementCurrencyKey: input.currency,
      settlementUnitAmount: input.amount,
      tenantKey: household.tenant,
      transactionDate: input.date,
    }, { partial: true });
    await em.flush();
  }

  async function addSnapshots(em: EntityManager, portfolio: Portfolio, currency: Currency, values: number[]) {
    values.forEach((value, i) => {
      em.create(PortfolioSnapshot, { appuserCurrencyKey: currency, appuserCurrencyTotalValue: value, currencyKey: currency, portfolioKey: portfolio, snapshotDate: new Date(`${dayKey(daysAgo(values.length - i))}T00:00:00Z`), totalValue: value }, { partial: true });
    });
    await em.flush();
  }

  describe('annual yield', () => {
    it('converts the owner\'s euro buy into dollars for the partner, at the rate of its date', async () => {
      const { em, eur, household, partner, ...setup } = await mixedHousehold();
      await addExchangeRate(em, eur, setup.usd, dayKey(daysAgo(800)), 1.25);
      await buy(em, household, setup, { amount: 1000, buyer: household.appuser, currency: eur, date: daysAgo(730) });
      // 1 000 EUR bought two years ago at 1.25 is 1 250 USD; worth 1 512.50 USD now: 10% a year.
      liveValue(1512.5);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(partner, undefined, household.tenant.tenantKey);

      expect(metrics.annualYield).toBeCloseTo(10, 1);
    });

    it('is unknown when a buy has no rate into the viewer\'s currency', async () => {
      const { em, eur, household, partner, ...setup } = await mixedHousehold();
      await buy(em, household, setup, { amount: 1000, buyer: household.appuser, currency: eur, date: daysAgo(730) });
      liveValue(1512.5);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(partner, undefined, household.tenant.tenantKey);

      expect(metrics.annualYield).toBeNull();
      expect(metrics.sharpeRatio).toBeNull();
    });
  });

  describe('volatility and max drawdown', () => {
    /** The owner's euro portfolio moving ±1% a day, and the partner's dollar portfolio flat at 500 USD. */
    async function twoPortfolios(withRate: boolean) {
      const household = await mixedHousehold();
      const { em, eur, partner, portfolio, usd } = household;
      if (withRate) await addExchangeRate(em, usd, eur, dayKey(daysAgo(400)), 0.8);
      const partnerPortfolio = em.create(Portfolio, { currencyKey: usd, name: 'Dollar shares', portfolioOwnerAppuserKey: partner, tenantKey: household.household.tenant }, { partial: true });
      await em.flush();
      const ownerValues = Array.from({ length: 100 }, (_, i) => 1000 * (i % 2 === 0 ? 1 : 1.01));
      await addSnapshots(em, portfolio, eur, ownerValues);
      await addSnapshots(em, partnerPortfolio, usd, ownerValues.map(() => 500));
      liveValue(1400);
      return { ...household, ownerValues };
    }

    it('reads each snapshot in the viewer\'s currency before adding the portfolios up', async () => {
      const { household, ownerValues } = await twoPortfolios(true);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(household.appuser, undefined, household.tenant.tenantKey);

      // 500 USD at 0.8 is 400 EUR a day.
      const inEuros = ownerValues.map((value, i) => ({ day: dayKey(daysAgo(ownerValues.length - i)), totalValue: value + 400 }));
      expect(metrics.volatility).toBeCloseTo(calculateVolatility(inEuros) ?? Number.NaN, 6);
      expect(metrics.maxDrawdown).toBeCloseTo(calculateMaxDrawdown(inEuros) ?? Number.NaN, 6);
    });

    it('is unknown when a snapshot has no rate into the viewer\'s currency', async () => {
      const { household } = await twoPortfolios(false);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(household.appuser, undefined, household.tenant.tenantKey);

      expect(metrics.volatility).toBeNull();
      expect(metrics.maxDrawdown).toBeNull();
      expect(metrics.riskLevel).toBeNull();
      // The history exists; only its value in the viewer's currency is unknown.
      expect(metrics.readiness.performance.status).toBe('ready');
    });
  });
});
