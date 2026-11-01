import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { BadRequestError } from '@utils/errors';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { updateTransaction } from '../transactions';

type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => Promise<unknown>;

/*
 * A user can correct a transaction's amount. The edit replaces the amount the balances and totals
 * read, zero included.
 */
describe('editing a transaction amount', () => {
  const db = useTestDatabase();

  async function attemptEdit(household: Household, transactionKey: number, updatedAmount: number): Promise<unknown> {
    const next = vi.fn();
    const res = { json: () => res, status: () => res } as unknown as Response;
    const req = { body: { updatedAmount }, headers: {}, params: { transactionId: String(transactionKey) }, query: {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
    await (updateTransaction as Handler)(req, res, next);
    return next.mock.calls[0]?.[0];
  }

  async function edit(household: Household, transactionKey: number, updatedAmount: number) {
    expect(await attemptEdit(household, transactionKey, updatedAmount)).toBeUndefined();
  }

  async function stored(household: Household, transactionKey: number) {
    const em = db.em();
    const transaction = await em.findOneOrFail(Transaction, { transactionKey }, { filters: false });
    const account = await em.findOneOrFail(Account, { accountKey: household.account.accountKey }, { filters: false });
    return { accountBalance: account.balance, amount: transaction.appuserSettlementAmount, balance: transaction.balance };
  }

  async function seedCharge() {
    const em = db.em();
    const household = await seedHousehold(em);
    const charge = await addTransaction(em, household, { amount: -100, appuserCurrencyBalance: 900, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { appuserCurrencyBalance: 900, balance: 900 });
    return { charge, household };
  }

  it('edits an amount to zero', async () => {
    const { charge, household } = await seedCharge();

    await edit(household, charge.transactionKey, 0);

    await expect(stored(household, charge.transactionKey)).resolves.toEqual({ accountBalance: 1000, amount: 0, balance: 1000 });
  });

  it('corrects an edit back towards the amount the bank charged', async () => {
    const { charge, household } = await seedCharge();
    await edit(household, charge.transactionKey, -10);

    await edit(household, charge.transactionKey, -90);

    await expect(stored(household, charge.transactionKey)).resolves.toEqual({ accountBalance: 910, amount: -90, balance: 910 });
  });

  it('restores the amount the bank charged after an edit', async () => {
    const { charge, household } = await seedCharge();
    await edit(household, charge.transactionKey, -10);

    await edit(household, charge.transactionKey, -100);

    await expect(stored(household, charge.transactionKey)).resolves.toEqual({ accountBalance: 900, amount: -100, balance: 900 });
  });

  it('still refuses an edited amount larger than the bank charged', async () => {
    const { charge, household } = await seedCharge();
    await edit(household, charge.transactionKey, -10);

    expect(await attemptEdit(household, charge.transactionKey, -110)).toBeInstanceOf(BadRequestError);

    await expect(stored(household, charge.transactionKey)).resolves.toEqual({ accountBalance: 990, amount: -10, balance: 990 });
  });

  it('bounds an edit of a manual transaction by the amount it was entered with', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const manual = await addTransaction(em, household, { amount: -100, appuserCurrencyBalance: 900, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    // A manual row entered without an original amount stores none.
    await em.nativeUpdate(Transaction, { transactionKey: manual.transactionKey }, { originalAmount: null, originalCurrencyKey: null });
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { appuserCurrencyBalance: 900, balance: 900 });
    await edit(household, manual.transactionKey, -10);

    await edit(household, manual.transactionKey, -95);
    expect(await attemptEdit(household, manual.transactionKey, -101)).toBeInstanceOf(BadRequestError);

    await expect(stored(household, manual.transactionKey)).resolves.toEqual({ accountBalance: 905, amount: -95, balance: 905 });
  });
});
