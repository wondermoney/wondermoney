import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, type PortfolioSetup, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));

import portfolioHoldingsService from '../portfolio-holdings.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * Dividend income is every dividend the household received, in the viewer's currency. A dividend is
 * stored in the currency it settled in and, when that is not its member's currency, also converted
 * into the member's. Members keep their own currencies, so each dividend is converted into the
 * viewer's at the rate of its date. One with no rate is left out of the totals and counted in
 * `completeness`, never dropped silently or added at face value.
 */
describe('portfolio dividend income', () => {
  const db = useTestDatabase();

  it('counts a dividend paid in the user currency', async () => {
    const household = await seedHousehold(db.em());
    const { appuser, asset, em, portfolio } = await seedPortfolio(DI.em, household);

    await portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.DIVIDEND, portfolioId: portfolio.portfolioKey,
      quantity: 1, settlementCurrencyId: household.currency.currencyKey, skipMaintenance: true, transactionDate: new Date('2026-07-15T00:00:00Z'), unitPrice: 50,
    }, em);

    const income = await portfolioHoldingsService.getDividendIncome(appuser, undefined, household.tenant.tenantKey);

    expect(income.totalDividends).toBe(50);
    expect(income.byAsset).toEqual([expect.objectContaining({ symbol: 'AAPL', totalDividends: 50 })]);
    expect(income.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('adds dividends in the user currency to converted foreign ones', async () => {
    const household = await seedHousehold(db.em());
    const { appuser, asset, em, portfolio, usd } = await seedPortfolio(DI.em, household);
    await addExchangeRate(em, usd, household.currency, '2026-07-15', 0.9);
    const dividend = (unitPrice: number, settlementCurrencyId: number) => portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: asset.symbol, financialAsset: asset, financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.DIVIDEND, portfolioId: portfolio.portfolioKey,
      quantity: 1, settlementCurrencyId, skipMaintenance: true, transactionDate: new Date('2026-07-15T00:00:00Z'), unitPrice,
    }, em);
    await dividend(50, household.currency.currencyKey);
    await dividend(100, usd.currencyKey);

    const income = await portfolioHoldingsService.getDividendIncome(appuser, undefined, household.tenant.tenantKey);

    expect(income.totalDividends).toBe(140);
  });

  /* The owner keeps EUR, the partner USD. */
  describe('in a household whose members keep different currencies', () => {
    async function mixedHousehold() {
      const household = await seedHousehold(db.em());
      const setup = await seedPortfolio(DI.em, household);
      const partner = await addPartner(setup.em, household, { currency: setup.usd });
      return { ...setup, eur: household.currency, household, partner };
    }

    /**
     * A dividend as the portfolio service stores it: in its settlement currency, with the amount
     * converted into its member's currency only when that differs (`memberAmount`).
     */
    async function addDividend(em: EntityManager, household: Household, setup: PortfolioSetup, input: { amount: number; day: string; member: Appuser; memberAmount?: number; settlement: Currency }) {
      const dividendType = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.DIVIDEND });
      em.create(FinancialTransaction, {
        appuserKey: input.member,
        appuserSettlementAmount: input.memberAmount,
        financialAssetKey: setup.asset,
        financialTransactionTypeKey: dividendType,
        internalTransactionId: `dividend-${input.day}-${input.amount}`,
        portfolioKey: setup.portfolio,
        quantity: 1,
        settlementAmount: input.amount,
        settlementCurrencyKey: input.settlement,
        settlementUnitAmount: input.amount,
        tenantKey: household.tenant,
        transactionDate: new Date(`${input.day}T00:00:00Z`),
      }, { partial: true });
      await em.flush();
    }

    it('converts the partner\'s dollar dividend into the owner\'s euros at the rate of its day', async () => {
      const { em, eur, household, partner, usd, ...setup } = await mixedHousehold();
      await addExchangeRate(em, usd, eur, '2026-07-14', 0.9);
      await addExchangeRate(em, usd, eur, '2026-07-20', 0.5);
      await addDividend(em, household, { em, usd, ...setup }, { amount: 100, day: '2026-07-15', member: partner, settlement: usd });

      const income = await portfolioHoldingsService.getDividendIncome(setup.appuser, undefined, household.tenant.tenantKey);

      // The latest rate on or before 15 July: 0.9, not the later 0.5.
      expect(income.totalDividends).toBe(90);
      expect(income.byAsset).toEqual([expect.objectContaining({ symbol: 'AAPL', totalDividends: 90 })]);
      expect(income.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('shows the partner the owner\'s euro dividends in dollars', async () => {
      const { em, eur, household, partner, usd, ...setup } = await mixedHousehold();
      await addExchangeRate(em, eur, usd, '2026-07-15', 1.2);
      await addDividend(em, household, { em, usd, ...setup }, { amount: 10, day: '2026-07-15', member: setup.appuser, settlement: eur });
      await addDividend(em, household, { em, usd, ...setup }, { amount: 45, day: '2026-07-15', member: setup.appuser, settlement: eur });

      const income = await portfolioHoldingsService.getDividendIncome(partner, undefined, household.tenant.tenantKey);

      // (10 + 45) EUR at 1.2.
      expect(income.totalDividends).toBe(66);
      expect(income.completeness).toMatchObject({ currencyCode: 'USD', isComplete: true });
    });

    it('shows the partner the owner\'s dollar dividend at its exact dollar amount, not converted to euros and back', async () => {
      const { em, eur, household, partner, usd, ...setup } = await mixedHousehold();
      await addExchangeRate(em, eur, usd, '2026-07-15', 1.2);
      // Settled as 50 USD and stored as 45 EUR for the owner. Read from the euros it would be 54 USD.
      await addDividend(em, household, { em, usd, ...setup }, { amount: 50, day: '2026-07-15', member: setup.appuser, memberAmount: 45, settlement: usd });

      const income = await portfolioHoldingsService.getDividendIncome(partner, undefined, household.tenant.tenantKey);

      expect(income.totalDividends).toBe(50);
      expect(income.byAsset).toEqual([expect.objectContaining({ symbol: 'AAPL', totalDividends: 50 })]);
      expect(income.completeness).toEqual({ currencyCode: 'USD', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('converts a foreign dividend from its settlement amount, not from the amount stored in its member\'s currency', async () => {
      const { em, eur, household, partner, usd, ...setup } = await mixedHousehold();
      const gbp = await em.findOne(Currency, { code: 'GBP' }) ?? em.create(Currency, { code: 'GBP', num: '826' }, { partial: true });
      await em.flush();
      await addExchangeRate(em, gbp, usd, '2026-07-15', 1.3);
      await addExchangeRate(em, eur, usd, '2026-07-15', 1.2);
      // Settled as 10 GBP and stored as 11 EUR for the owner: 13 USD from the pounds, 13.2 from the euros.
      await addDividend(em, household, { em, usd, ...setup }, { amount: 10, day: '2026-07-15', member: setup.appuser, memberAmount: 11, settlement: gbp });

      const income = await portfolioHoldingsService.getDividendIncome(partner, undefined, household.tenant.tenantKey);

      expect(income.totalDividends).toBe(13);
      expect(income.completeness).toMatchObject({ currencyCode: 'USD', isComplete: true });
    });

    it('leaves a dollar dividend with no rate out and reports it, instead of dropping it', async () => {
      const { em, eur, household, partner, usd, ...setup } = await mixedHousehold();
      await addDividend(em, household, { em, usd, ...setup }, { amount: 100, day: '2026-07-15', member: partner, settlement: usd });
      await addDividend(em, household, { em, usd, ...setup }, { amount: 30, day: '2026-07-15', member: setup.appuser, settlement: eur });

      const income = await portfolioHoldingsService.getDividendIncome(setup.appuser, undefined, household.tenant.tenantKey);

      expect(income.totalDividends).toBe(30);
      expect(income.byAsset).toEqual([expect.objectContaining({ symbol: 'AAPL', totalDividends: 30 })]);
      expect(income.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });

    it('converts a foreign dividend stored with no converted amount from its settlement currency', async () => {
      const { em, eur, household, usd, ...setup } = await mixedHousehold();
      // The owner (EUR) received USD when no rate was stored yet; one has been stored since.
      await addDividend(em, household, { em, usd, ...setup }, { amount: 100, day: '2026-07-15', member: setup.appuser, settlement: usd });
      await addExchangeRate(em, usd, eur, '2026-07-15', 0.9);

      const income = await portfolioHoldingsService.getDividendIncome(setup.appuser, undefined, household.tenant.tenantKey);

      expect(income.totalDividends).toBe(90);
      expect(income.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
    });
  });
});
