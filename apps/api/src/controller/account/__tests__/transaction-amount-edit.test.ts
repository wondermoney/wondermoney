import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
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

  describe('on a row in another currency', () => {
    async function seedForeignCharge(rate?: number) {
      const em = db.em();
      const household = await seedHousehold(em);
      const usd = await currencyFor(em, 'USD');
      if (rate !== undefined) em.create(ExchangeRate, { date: new Date('2026-07-09T00:00:00Z'), fromCurrency: usd, rate, toCurrency: household.currency }, { partial: true });
      await em.flush();
      const charge = await addTransaction(em, household, { amount: -100, appuserCurrencyBalance: 900, currency: usd, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
      // Settled in dollars, counted in the owner's euros.
      await em.nativeUpdate(Transaction, { transactionKey: charge.transactionKey }, { appuserCurrencyKey: household.currency, appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
      await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { appuserCurrencyBalance: 900, balance: 1000 });
      return { charge, household };
    }

    it('converts the edited amount at the rate for the row date, exactly', async () => {
      const { charge, household } = await seedForeignCharge(0.9);

      await edit(household, charge.transactionKey, -33.33);

      const row = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey }, { filters: false });
      expect(row).toMatchObject({ appuserSettlementAmount: -29.997, fxStatus: FxStatus.EXACT });
    });

    it('stores no converted amount when no rate exists, rather than the dollar amount', async () => {
      const { charge, household } = await seedForeignCharge();

      await edit(household, charge.transactionKey, -50);

      const row = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey }, { filters: false });
      expect(row).toMatchObject({ appuserCurrencyBalance: null, appuserSettlementAmount: null, fxStatus: FxStatus.MISSING, settlementAmount: -50 });
    });
  });
});
