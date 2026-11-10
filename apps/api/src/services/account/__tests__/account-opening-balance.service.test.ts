import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';

import { backfillAccountOpeningBalances } from '../account-opening-balance.service';

/*
 * Accounts created before opening balances were stored get one on startup: the balance before
 * their oldest settled row, or, with no rows, the balance they hold now, dated when the account
 * was created. Accounts that already have one are never touched, so running it again changes
 * nothing.
 */
describe('opening balance backfill', () => {
  const db = useTestDatabase();
  const createdAt = new Date('2025-03-14T09:30:00Z');

  async function ageAccount(em: EntityManager, account: Account, balance: number) {
    await em.getConnection().execute('update "account" set "created_at" = ?, "balance" = ? where "account_key" = ?', [createdAt, balance, account.accountKey]);
  }

  async function opening(account: Account) {
    const row = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
    return { openingBalance: row.openingBalance ?? null, openingBalanceDate: row.openingBalanceDate ?? null };
  }

  it('takes the balance before the oldest settled row, dated when the account was created', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await ageAccount(em, household.account, 1150);
    await addTransaction(em, household, { amount: 50, appuserCurrencyBalance: 1150, date: new Date('2025-05-02T12:00:00Z'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 100, appuserCurrencyBalance: 1100, date: new Date('2025-04-01T12:00:00Z'), status: 'BOOKED' });

    await backfillAccountOpeningBalances(db.em());

    expect(await opening(household.account)).toEqual({ openingBalance: 1000, openingBalanceDate: createdAt });
  });

  it('skips pending and expired rows, which never moved money', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await ageAccount(em, household.account, 1100);
    await addTransaction(em, household, { amount: -999, appuserCurrencyBalance: 1, date: new Date('2025-03-20T12:00:00Z'), status: 'PENDING' });
    await addTransaction(em, household, { amount: -999, appuserCurrencyBalance: 1, date: new Date('2025-03-21T12:00:00Z'), status: 'EXPIRED' });
    await addTransaction(em, household, { amount: 100, appuserCurrencyBalance: 1100, date: new Date('2025-04-01T12:00:00Z'), status: 'BOOKED' });

    await backfillAccountOpeningBalances(db.em());

    expect((await opening(household.account)).openingBalance).toBe(1000);
  });

  it('takes the current balance of an account with no transactions', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const savings = await addAccount(em, household, { name: 'Savings' });
    await ageAccount(em, savings, 2500);

    await backfillAccountOpeningBalances(db.em());

    expect(await opening(savings)).toEqual({ openingBalance: 2500, openingBalanceDate: createdAt });
  });

  it('leaves an account alone when its oldest row carries no balance to derive one from', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await ageAccount(em, household.account, 1100);
    await addTransaction(em, household, { amount: 100, date: new Date('2025-04-01T12:00:00Z'), status: 'BOOKED' });

    await backfillAccountOpeningBalances(db.em());

    expect(await opening(household.account)).toEqual({ openingBalance: null, openingBalanceDate: null });
  });

  it('never overwrites an opening balance that is already stored', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const storedDate = new Date('2025-06-01T00:00:00Z');
    await ageAccount(em, household.account, 1100);
    await em.getConnection().execute('update "account" set "opening_balance" = 700, "opening_balance_date" = ? where "account_key" = ?', [storedDate, household.account.accountKey]);
    await addTransaction(em, household, { amount: 100, appuserCurrencyBalance: 1100, date: new Date('2025-04-01T12:00:00Z'), status: 'BOOKED' });

    await backfillAccountOpeningBalances(db.em());

    expect(await opening(household.account)).toEqual({ openingBalance: 700, openingBalanceDate: storedDate });
  });

  it('is idempotent: a second run changes nothing', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await ageAccount(em, household.account, 1100);
    await addTransaction(em, household, { amount: 100, appuserCurrencyBalance: 1100, date: new Date('2025-04-01T12:00:00Z'), status: 'BOOKED' });
    const savings = await addAccount(em, household, { name: 'Savings' });
    await ageAccount(em, savings, 2500);

    const first = await backfillAccountOpeningBalances(db.em());
    const afterFirst = [await opening(household.account), await opening(savings)];
    const second = await backfillAccountOpeningBalances(db.em());

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect([await opening(household.account), await opening(savings)]).toEqual(afterFirst);
  });
});
