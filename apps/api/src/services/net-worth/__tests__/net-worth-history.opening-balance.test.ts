import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, addTransaction, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';

import { NetWorthService } from '../net-worth.service';

/*
 * An account that holds money but has no transactions (a new manual account, a dormant savings
 * account) still counts in net worth history: from the day it was opened, at its opening balance,
 * until its first transaction carries a running balance.
 */
describe('net-worth history and opening balances', () => {
  const db = useTestDatabase();

  const now = new Date();
  const monthsAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const endOfMonthAgo = (months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 0));
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);

  async function openAccount(em: EntityManager, account: Account, input: { appuserCurrencyBalance: null | number; createdAt: Date; openingBalance: null | number; openingBalanceDate: Date | null }) {
    await em.getConnection().execute(
      'update "account" set "created_at" = ?, "appuser_currency_balance" = ?, "opening_balance" = ?, "opening_balance_date" = ? where "account_key" = ?',
      [input.createdAt, input.appuserCurrencyBalance, input.openingBalance, input.openingBalanceDate, account.accountKey],
    );
  }

  it('counts an account with no transactions at its opening balance at every point since it was opened', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await openAccount(em, household.account, { appuserCurrencyBalance: 1000, createdAt: monthsAgo(4), openingBalance: 1000, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.length).toBeGreaterThanOrEqual(3);
    for (const point of history.points) expect(point).toMatchObject({ accountsTotal: 1000, isComplete: true, totalNetWorth: 1000 });
    expect(history.readiness).toBe('ready');
  });

  it('does not use the opening balance before the date it was recorded', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await openAccount(em, household.account, { appuserCurrencyBalance: 1000, createdAt: monthsAgo(4), openingBalance: 1000, openingBalanceDate: monthsAgo(1) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 4 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(2)))).toMatchObject({ accountsTotal: null, isComplete: false });
    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 1000, isComplete: true });
  });

  it('uses the opening balance before the first transaction and the running balance from it on', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await openAccount(em, household.account, { appuserCurrencyBalance: 600, createdAt: monthsAgo(4), openingBalance: 500, openingBalanceDate: monthsAgo(4) });
    await addTransaction(em, household, { amount: 100, appuserCurrencyBalance: 600, date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12)), status: 'BOOKED' });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(2)))).toMatchObject({ accountsTotal: 500, isComplete: true });
    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 600, isComplete: true });
  });

  it('adds an opening-balance-only account to another account\'s running balance', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await openAccount(em, household.account, { appuserCurrencyBalance: 50, createdAt: monthsAgo(4), openingBalance: 0, openingBalanceDate: monthsAgo(4) });
    await addTransaction(em, household, { amount: 50, appuserCurrencyBalance: 50, date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 2, 12)), status: 'BOOKED' });
    const savings = await addAccount(em, household, { balance: 2000, name: 'Savings' });
    await openAccount(em, savings, { appuserCurrencyBalance: 2000, createdAt: monthsAgo(4), openingBalance: 2000, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 2050, isComplete: true });
  });

  it('converts a foreign-currency opening balance at the latest rate on or before each point', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = em.create(Currency, { code: 'USD', num: '840' }, { partial: true });
    em.create(ExchangeRate, { date: monthsAgo(12), fromCurrency: usd, rate: 0.9, toCurrency: household.currency }, { partial: true });
    await em.flush();
    await em.getConnection().execute('update "account" set "currency_key" = ? where "account_key" = ?', [usd.currencyKey, household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: 90, createdAt: monthsAgo(4), openingBalance: 100, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 90, isComplete: true });
  });

  it('leaves a point incomplete when a foreign-currency opening balance has no rate', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const jpy = em.create(Currency, { code: 'JPY', num: '392' }, { partial: true });
    await em.flush();
    await em.getConnection().execute('update "account" set "currency_key" = ? where "account_key" = ?', [jpy.currencyKey, household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: null, createdAt: monthsAgo(4), openingBalance: 10_000, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: null, isComplete: false, totalNetWorth: null });
  });

  it('converts a foreign-currency opening balance at the rate in force at each point, not today\'s', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    em.create(ExchangeRate, { date: monthsAgo(12), fromCurrency: usd, rate: 0.8, toCurrency: household.currency }, { partial: true });
    em.create(ExchangeRate, { date: monthsAgo(1), fromCurrency: usd, rate: 0.9, toCurrency: household.currency }, { partial: true });
    await em.flush();
    await em.getConnection().execute('update "account" set "currency_key" = ? where "account_key" = ?', [usd.currencyKey, household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: 90, createdAt: monthsAgo(4), openingBalance: 100, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(2)))).toMatchObject({ accountsTotal: 80, isComplete: true });
    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 90, isComplete: true });
  });

  it('leaves a point incomplete when the opening balance\'s first rate is published after it', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    em.create(ExchangeRate, { date: monthsAgo(1), fromCurrency: usd, rate: 0.9, toCurrency: household.currency }, { partial: true });
    await em.flush();
    await em.getConnection().execute('update "account" set "currency_key" = ? where "account_key" = ?', [usd.currencyKey, household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: 90, createdAt: monthsAgo(4), openingBalance: 100, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 3 });

    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(2)))).toMatchObject({ accountsTotal: null, isComplete: false, totalNetWorth: null });
    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 90, isComplete: true });
  });

  it('converts an opening balance from the account\'s currency into a household member\'s own currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const gbp = await currencyFor(em, 'GBP');
    const partner = await addPartner(em, household, { currency: gbp });
    // Only USD → GBP is stored: the owner's currency (EUR) has no rate into the partner's, so the
    // opening balance has to be converted from the account's own currency.
    em.create(ExchangeRate, { date: monthsAgo(12), fromCurrency: usd, rate: 0.75, toCurrency: gbp }, { partial: true });
    await em.flush();
    await em.getConnection().execute('update "account" set "currency_key" = ? where "account_key" = ?', [usd.currencyKey, household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: 90, createdAt: monthsAgo(4), openingBalance: 100, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(partner, { months: 3 });

    expect(history.currencyCode).toBe('GBP');
    expect(history.points.find((point) => point.date === isoDate(endOfMonthAgo(1)))).toMatchObject({ accountsTotal: 75, isComplete: true });
  });

  it('marks today incomplete when an account\'s balance cannot be converted into the user\'s currency', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const jpy = await currencyFor(em, 'JPY');
    await em.getConnection().execute('update "account" set "currency_key" = ?, "fx_status" = ? where "account_key" = ?', [jpy.currencyKey, 'missing', household.account.accountKey]);
    await openAccount(em, household.account, { appuserCurrencyBalance: null, createdAt: monthsAgo(4), openingBalance: 1000, openingBalanceDate: monthsAgo(4) });

    const history = await new NetWorthService().getNetWorthHistory(household.appuser, { months: 2 });

    expect(history.points.at(-1)).toMatchObject({ date: isoDate(now), isComplete: false });
  });
});
