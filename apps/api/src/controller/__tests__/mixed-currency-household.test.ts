import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus } from '@entity/Transaction';
import goalRoutes from '@route/goal';
import netWorthRoutes from '@route/net-worth';
import reportRoutes from '@route/reports';

/*
 * A household whose members keep their books in different currencies: the owner in EUR, the
 * partner in USD. Every total either converts each member's amounts into the viewer's currency
 * first, or reports itself incomplete. It never adds a dollar to a euro.
 *
 * Rates: 1 EUR = 1.25 USD and 1 USD = 0.8 EUR, published before any transaction.
 *
 *   Owner (EUR):   account 1000 EUR, salary +2000 EUR, groceries -100 EUR
 *   Partner (USD): account  500 USD, salary +1100 USD, groceries -220 USD
 */
describe('a household with members in two currencies', () => {
  const db = useTestDatabase({ schema: 'migrations' });
  useRequestContextEm(db);
  const netWorth = tenantHttp('/v1/net-worth', netWorthRoutes);
  const reports = tenantHttp('/v1/reports', reportRoutes);
  const goals = tenantHttp('/v1/goal', goalRoutes);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
  const inMonth = (day: number) => new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 12));
  const period = `fromDate=${monthStart.toISOString()}&toDate=${monthEnd.toISOString()}&timezone=UTC`;

  async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: Date) {
    em.create(ExchangeRate, { date, fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function mixedHousehold(partnerCurrencyCode = 'USD', withRates = true) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const foreign = await currencyFor(em, partnerCurrencyCode);
    household.account.appuserCurrencyBalance = 1000;
    await em.flush();
    const partner = await addPartner(em, household, { currency: foreign });
    const partnerAccount = await addAccount(em, household, { appuserCurrencyBalance: 500, balance: 500, currency: foreign, name: 'Checking', owner: partner });
    if (withRates) {
      await addRate(em, eur, foreign, 1.25, new Date(monthStart.getTime() - 3 * 86_400_000));
      await addRate(em, foreign, eur, 0.8, new Date(monthStart.getTime() - 3 * 86_400_000));
    }
    const salary = await addCategory(em, household, 'Salary');
    const groceries = await addCategory(em, household, 'Groceries');

    await addTransaction(em, household, { amount: 2000, category: salary, date: inMonth(2), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: inMonth(5), status: 'BOOKED' });
    await addTransaction(em, household, { account: partnerAccount, amount: 1100, appuser: partner, category: salary, currency: foreign, date: inMonth(3), status: 'BOOKED' });
    await addTransaction(em, household, { account: partnerAccount, amount: -220, appuser: partner, category: groceries, currency: foreign, date: inMonth(6), status: 'BOOKED' });
    return { groceries, household, partner, partnerAccount };
  }

  describe('net worth', () => {
    it('converts the partner\'s dollars for the euro owner', async () => {
      const { household } = await mixedHousehold();

      const response = await netWorth.as(household.appuser).get('/v1/net-worth');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ assets: { accounts: 1400 }, currencyCode: 'EUR', totalNetWorth: 1400, unsupportedCurrencies: { accounts: 0 } });
    });

    it('converts the owner\'s euros for the dollar partner', async () => {
      const { partner } = await mixedHousehold();

      const response = await netWorth.as(partner).get('/v1/net-worth');

      expect(response.body).toMatchObject({ assets: { accounts: 1750 }, currencyCode: 'USD', totalNetWorth: 1750, unsupportedCurrencies: { accounts: 0 } });
    });

    it('converts each member\'s running balance at every history point', async () => {
      const { household, partner, partnerAccount } = await mixedHousehold();
      const em = db.em();
      const aYearAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      await em.getConnection().execute('update "account" set "created_at" = ? where "tenant_key" = ?', [aYearAgo, household.tenant.tenantKey]);
      await addTransaction(em, household, { amount: -1, appuserCurrencyBalance: 1000, date: inMonth(10), status: 'BOOKED' });
      await addTransaction(em, household, { account: partnerAccount, amount: -1, appuser: partner, appuserCurrencyBalance: 500, currency: partnerAccount.currencyKey, date: inMonth(10), status: 'BOOKED' });
      const lastMonthEnd = monthEnd.toISOString().slice(0, 10);

      const owner = await netWorth.as(household.appuser).get('/v1/net-worth/history?months=2');
      const member = await netWorth.as(partner).get('/v1/net-worth/history?months=2');

      expect(owner.body.points.find((point: { date: string }) => point.date === lastMonthEnd)).toMatchObject({ accountsTotal: 1400, isComplete: true });
      expect(member.body.points.find((point: { date: string }) => point.date === lastMonthEnd)).toMatchObject({ accountsTotal: 1750, isComplete: true });
    });

    it('leaves out an account it cannot convert and reports the total as incomplete', async () => {
      const { household } = await mixedHousehold('JPY', false);

      const response = await netWorth.as(household.appuser).get('/v1/net-worth');

      expect(response.body).toMatchObject({ assets: { accounts: 1000 }, totalNetWorth: 1000, unsupportedCurrencies: { accounts: 1 } });
    });
  });

  describe('cash flow', () => {
    it('totals both members in euros for the owner', async () => {
      const { household } = await mixedHousehold();

      const response = await reports.as(household.appuser).get(`/v1/reports/cashflow?${period}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([expect.objectContaining({ expenses: 276, income: 2880, net: 2604 })]);
      expect(response.body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('totals both members in dollars for the partner', async () => {
      const { partner } = await mixedHousehold();

      const response = await reports.as(partner).get(`/v1/reports/cashflow?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ expenses: 345, income: 3600, net: 3255 })]);
      expect(response.body.completeness).toEqual({ currencyCode: 'USD', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('leaves out what it cannot convert and says how much', async () => {
      const { household } = await mixedHousehold('JPY', false);

      const response = await reports.as(household.appuser).get(`/v1/reports/cashflow?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ expenses: 100, income: 2000 })]);
      expect(response.body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['JPY'], unconvertedTransactions: 2 });
    });
  });

  describe('spending by category', () => {
    it('adds both members\' groceries in euros for the owner', async () => {
      const { groceries, household } = await mixedHousehold();

      const response = await reports.as(household.appuser).get(`/v1/reports/spending-by-category?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ categoryKey: String(groceries.categoryKey), totalAmount: 276, transactionCount: 2 })]);
      expect(response.body.completeness.isComplete).toBe(true);
    });

    it('adds both members\' groceries in dollars for the partner', async () => {
      const { groceries, partner } = await mixedHousehold();

      const response = await reports.as(partner).get(`/v1/reports/spending-by-category?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ categoryKey: String(groceries.categoryKey), totalAmount: 345, transactionCount: 2 })]);
      expect(response.body.completeness.isComplete).toBe(true);
    });

    it('leaves out what it cannot convert and says how much', async () => {
      const { household } = await mixedHousehold('JPY', false);

      const response = await reports.as(household.appuser).get(`/v1/reports/spending-by-category?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ totalAmount: 100, transactionCount: 1 })]);
      expect(response.body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['JPY'], unconvertedTransactions: 1 });
    });
  });

  describe('money available to assign to goals', () => {
    it('is counted in each viewer\'s own currency', async () => {
      const { household, partner } = await mixedHousehold();

      const owner = await goals.as(household.appuser).get('/v1/goal/available-to-assign');
      const member = await goals.as(partner).get('/v1/goal/available-to-assign');

      expect(owner.body).toMatchObject({ availableToAssign: 1400, isComplete: true });
      expect(member.body).toMatchObject({ availableToAssign: 1750, isComplete: true });
    });

    it('leaves out an account it cannot convert and says so', async () => {
      const { household } = await mixedHousehold('JPY', false);

      const response = await goals.as(household.appuser).get('/v1/goal/available-to-assign');

      expect(response.body).toEqual({ availableToAssign: 1000, isComplete: false, unconvertedAccounts: 1 });
    });
  });

  describe('a row stored with no converted amount (no rate when it was written)', () => {
    async function withMissingRow() {
      const em = db.em();
      const household = await seedHousehold(em);
      household.account.appuserCurrencyBalance = 1000;
      await em.flush();
      const yen = await currencyFor(em, 'JPY');
      const tokyo = await addAccount(em, household, { balance: 50_000, currency: yen, name: 'Tokyo' });
      tokyo.appuserCurrencyBalance = null;
      tokyo.fxStatus = FxStatus.MISSING;
      await addTransaction(em, household, { amount: -100, date: inMonth(5), status: 'BOOKED' });
      const ramen = await addTransaction(em, household, { account: tokyo, amount: -10_000, date: inMonth(6), status: 'BOOKED' });
      ramen.appuserSettlementAmount = null;
      ramen.fxStatus = FxStatus.MISSING;
      ramen.settlementCurrencyKey = yen;
      await em.flush();
      return household;
    }

    it('is left out of cash flow and counted, never added at the foreign amount', async () => {
      const household = await withMissingRow();

      const response = await reports.as(household.appuser).get(`/v1/reports/cashflow?${period}`);

      expect(response.body.data).toEqual([expect.objectContaining({ expenses: 100 })]);
      expect(response.body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['JPY'], unconvertedTransactions: 1 });
    });

    it('leaves its account out of net worth and marks the total incomplete', async () => {
      const household = await withMissingRow();

      const response = await netWorth.as(household.appuser).get('/v1/net-worth');

      expect(response.body).toMatchObject({ assets: { accounts: 1000 }, isComplete: false, unsupportedCurrencies: { accounts: 1 } });
    });
  });
});
