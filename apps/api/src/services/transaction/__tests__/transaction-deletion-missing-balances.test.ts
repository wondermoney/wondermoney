import { describe, expect, it } from 'vitest';

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { deleteTransactions } from '@service/transaction/transaction-deletion.service';

/*
 * Deleting a row from a manual account whose stored chain has gaps (rows without a running balance)
 * rebuilds the chain from the account's opening balance, as every whole-account rebuild of a manual
 * account does, rather than from whatever `account.balance` held.
 */
describe('deleting from a manual account whose rows lack a running balance', () => {
  const db = useTestDatabase();

  it('rebuilds the chain from the opening balance', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { balance: 0, openingBalance: 1000 });
    const first = await addTransaction(em, household, { amount: -100, date: new Date('2026-07-01T12:00:00Z'), status: 'BOOKED' });
    const second = await addTransaction(em, household, { amount: -50, date: new Date('2026-07-02T12:00:00Z'), status: 'BOOKED' });
    expect([first.balance, second.balance]).toEqual([undefined, undefined]);

    const doomed = await db.em().find(Transaction, { transactionKey: second.transactionKey }, { filters: false, populate: ['accountKey'] });
    await deleteTransactions(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, doomed);

    const kept = await db.em().findOneOrFail(Transaction, { transactionKey: first.transactionKey }, { filters: false });
    expect(kept.balance).toBe(900);
    expect((await db.em().findOneOrFail(Account, { accountKey: household.account.accountKey }, { filters: false })).balance).toBe(900);
  });

  it('writes no balance when nothing says what the account opened on', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { balance: null, openingBalance: null });
    const first = await addTransaction(em, household, { amount: -100, date: new Date('2026-07-01T12:00:00Z'), status: 'BOOKED' });
    const second = await addTransaction(em, household, { amount: -50, date: new Date('2026-07-02T12:00:00Z'), status: 'BOOKED' });

    const doomed = await db.em().find(Transaction, { transactionKey: second.transactionKey }, { filters: false, populate: ['accountKey'] });
    await deleteTransactions(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, doomed);

    expect((await db.em().findOneOrFail(Transaction, { transactionKey: first.transactionKey }, { filters: false })).balance).toBeNull();
    expect((await db.em().findOneOrFail(Account, { accountKey: household.account.accountKey }, { filters: false })).balance).toBeNull();
  });
});
