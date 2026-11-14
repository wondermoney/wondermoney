import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { AccountType } from '@entity/AccountType';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { Transaction } from '@entity/Transaction';
import { BadRequestError, NotFoundError } from '@utils/errors';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getCreditCardStatementDetailHandler, getCreditCardStatementsHandler, putCreditCardSettings } from '../credit-card';
import { updateTransaction } from '../transactions';

type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => Promise<unknown>;

const db = useTestDatabase();

const utc = (value: string) => new Date(`${value}T12:00:00.000Z`);

async function call(handler: Handler, req: Request): Promise<{ body: unknown; error: unknown; status: number }> {
  const next = vi.fn();
  let status = 200;
  const res = {
    json: (body: unknown) => {
      (res as unknown as { body: unknown }).body = body;
      return res;
    },
    sendStatus: (code: number) => {
      status = code;
      return res;
    },
    status: (code: number) => {
      status = code;
      return res;
    },
  } as unknown as Response;
  try {
    await handler(req, res, next);
  } catch (error) {
    return { body: (res as unknown as { body?: unknown }).body, error, status };
  }
  return { body: (res as unknown as { body?: unknown }).body, error: next.mock.calls[0]?.[0], status };
}

function request(input: { body?: unknown; params: Record<string, string>; query?: Record<string, unknown>; tenant: Household['tenant']; user: Household['appuser'] }): Request {
  return { body: input.body ?? {}, headers: {}, params: input.params, query: input.query ?? {}, tenant: input.tenant, user: input.user } as unknown as Request;
}

async function saveSettings(household: Household, body: Record<string, unknown>, accountId = household.account.accountKey) {
  return call(putCreditCardSettings, request({ body, params: { accountId: String(accountId) }, tenant: household.tenant, user: household.appuser }));
}

async function seedCardHousehold() {
  const em = db.em();
  const household = await seedHousehold(em);
  const creditCard = await em.findOne(AccountType, { description: 'CREDIT_CARD' });
  if (!creditCard) em.create(AccountType, { description: 'CREDIT_CARD' }, { partial: true });
  await em.flush();
  return household;
}

describe('credit card settings', () => {
  it('marks the account as a credit card and stores its cycle', async () => {
    const household = await seedCardHousehold();

    const result = await saveSettings(household, { creditLimit: 1500, paymentDueDay: 10, statementCloseDay: 25 });

    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({ creditCard: { creditLimit: 1500, minimumPaymentPercent: null, paymentDueDay: 10, statementCloseDay: 25 } });
    const em = db.em();
    const account = await em.findOneOrFail(Account, { accountKey: household.account.accountKey }, { populate: ['accountTypeKey'] });
    expect(account.accountTypeKey?.description).toBe('CREDIT_CARD');
    const detail = await em.findOneOrFail(CreditCardDetail, { accountKey: { accountKey: household.account.accountKey } });
    expect(detail.statementCloseDay).toBe(25);
  });

  it('edits the existing settings instead of adding a second row', async () => {
    const household = await seedCardHousehold();
    await saveSettings(household, { paymentDueDay: 10, statementCloseDay: 25 });
    await saveSettings(household, { creditLimit: 500, minimumPaymentPercent: 5, paymentDueDay: 12, statementCloseDay: 28 });

    const em = db.em();
    const details = await em.find(CreditCardDetail, {});
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ creditLimit: 500, minimumPaymentPercent: 5, paymentDueDay: 12, statementCloseDay: 28 });
  });

  it('cannot touch another household’s account', async () => {
    const household = await seedCardHousehold();
    const other = await seedHousehold(db.em());

    const result = await saveSettings(other, { paymentDueDay: 10, statementCloseDay: 25 }, household.account.accountKey);

    expect(result.error).toBeInstanceOf(NotFoundError);
    const em = db.em();
    await expect(em.count(CreditCardDetail, {})).resolves.toBe(0);
  });
});

describe('credit card statements', () => {
  async function seedCard() {
    const household = await seedCardHousehold();
    await saveSettings(household, { creditLimit: 1000, paymentDueDay: 10, statementCloseDay: 31 });
    return household;
  }

  async function statements(household: Household, query: Record<string, unknown> = {}) {
    return call(getCreditCardStatementsHandler, request({ params: { accountId: String(household.account.accountKey) }, query, tenant: household.tenant, user: household.appuser }));
  }

  it('totals charges and payments in the statement that contains them', async () => {
    const em = db.em();
    const household = await seedCard();
    await addTransaction(em, household, { amount: -120, date: utc('2026-01-05'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -80, date: utc('2026-01-31'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 200, date: utc('2026-01-20'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -999, date: utc('2026-02-01'), status: 'BOOKED' });

    const result = await statements(household, { from: '2026-01-01', to: '2026-01-31' });

    expect(result.error).toBeUndefined();
    const list = (result.body as { statements: Record<string, unknown>[] }).statements;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      availableCredit: 1000,
      balance: 0,
      charges: 200,
      dueDate: '2026-02-10',
      payments: 200,
      periodEnd: '2026-01-31',
      periodStart: '2026-01-01',
    });
  });

  it('reduces the statement balance by the payments made against it', async () => {
    const em = db.em();
    const household = await seedCard();
    await addTransaction(em, household, { amount: -300, date: utc('2026-01-10'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 100, date: utc('2026-01-15'), status: 'BOOKED' });

    const result = await statements(household, { from: '2026-01-01', to: '2026-01-31' });

    const list = (result.body as { statements: Record<string, unknown>[] }).statements;
    expect(list[0]).toMatchObject({ availableCredit: 800, balance: 200, charges: 300, payments: 100 });
  });

  it('counts a payment made after the window against the statement it pays', async () => {
    const em = db.em();
    const household = await seedCard();
    await addTransaction(em, household, { amount: -300, date: utc('2026-01-10'), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 300, date: utc('2026-02-05'), status: 'BOOKED' });

    const result = await statements(household, { from: '2026-01-01', to: '2026-01-31' });

    const list = (result.body as { statements: Record<string, unknown>[] }).statements;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ balance: 0, charges: 300, periodEnd: '2026-01-31', status: 'paid' });
  });

  it('moves a transaction to the statement its override names', async () => {
    const em = db.em();
    const household = await seedCard();
    const charge = await addTransaction(em, household, { amount: -150, date: utc('2026-01-28'), status: 'BOOKED' });

    const edit = await call(updateTransaction, request({ body: { statementDateOverride: '2026-02-10' }, params: { transactionId: String(charge.transactionKey) }, tenant: household.tenant, user: household.appuser }));
    expect(edit.error).toBeUndefined();

    const january = (await statements(household, { from: '2026-01-01', to: '2026-01-31' })).body as { statements: Record<string, unknown>[] };
    const february = (await statements(household, { from: '2026-02-01', to: '2026-02-28' })).body as { statements: Record<string, unknown>[] };

    expect(january.statements[0]).toMatchObject({ balance: 0, charges: 0 });
    expect(february.statements[0]).toMatchObject({ balance: 150, charges: 150 });
  });

  it('refuses a non-card account', async () => {
    const household = await seedCardHousehold();

    const result = await statements(household, { from: '2026-01-01', to: '2026-01-31' });

    expect(result.error).toBeInstanceOf(BadRequestError);
  });

  it('cannot read another household’s statements', async () => {
    const household = await seedCardHousehold();
    const other = await seedHousehold(db.em());
    await saveSettings(other, { paymentDueDay: 10, statementCloseDay: 31 });

    const result = await call(getCreditCardStatementsHandler, request({ params: { accountId: String(household.account.accountKey) }, query: {}, tenant: other.tenant, user: other.appuser }));

    expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('credit card statement detail', () => {
  async function seedCardWithTransactions() {
    const household = await seedCardHousehold();
    await saveSettings(household, { creditLimit: 1000, paymentDueDay: 10, statementCloseDay: 31 });
    const em = db.em();
    const first = await addTransaction(em, household, { amount: -120, date: utc('2026-01-05'), status: 'BOOKED' });
    const second = await addTransaction(em, household, { amount: -80, date: utc('2026-01-31'), status: 'BOOKED' });
    const payment = await addTransaction(em, household, { amount: 200, date: utc('2026-01-20'), status: 'BOOKED' });
    // Outside the statement, so it must not appear.
    await addTransaction(em, household, { amount: -999, date: utc('2026-02-01'), status: 'BOOKED' });
    return { first, household, payment, second };
  }

  async function detail(household: Household, statementDate: string) {
    return call(getCreditCardStatementDetailHandler, request({ params: { accountId: String(household.account.accountKey), statementDate }, tenant: household.tenant, user: household.appuser }));
  }

  it('returns the statement with its status and the transactions it counts, newest first', async () => {
    const { first, household, payment, second } = await seedCardWithTransactions();

    const result = await detail(household, '2026-01-31');

    expect(result.error).toBeUndefined();
    const statement = (result.body as { statement: Record<string, unknown> }).statement;
    expect(statement).toMatchObject({ balance: 0, charges: 200, dueDate: '2026-02-10', periodEnd: '2026-01-31', periodStart: '2026-01-01', status: 'paid' });
    expect(statement['transactions']).toEqual([
      { amount: -80, description: expect.any(String), merchantName: null, transactionDate: '2026-01-31', transactionKey: second.transactionKey },
      { amount: 200, description: expect.any(String), merchantName: null, transactionDate: '2026-01-20', transactionKey: payment.transactionKey },
      { amount: -120, description: expect.any(String), merchantName: null, transactionDate: '2026-01-05', transactionKey: first.transactionKey },
    ]);
  });

  it('reports the balance and rows of an unpaid statement', async () => {
    const em = db.em();
    const household = await seedCardHousehold();
    await saveSettings(household, { paymentDueDay: 10, statementCloseDay: 31 });
    const charge = await addTransaction(em, household, { amount: -120, date: utc('2026-01-05'), status: 'BOOKED' });

    const result = await detail(household, '2026-01-31');

    const statement = (result.body as { statement: Record<string, unknown> }).statement;
    expect(statement).toMatchObject({ balance: 120, charges: 120, payments: 0 });
    expect(statement['transactions']).toEqual([
      { amount: -120, description: expect.any(String), merchantName: null, transactionDate: '2026-01-05', transactionKey: charge.transactionKey },
    ]);
  });

  it('refuses a date that is not one of the card’s close days', async () => {
    const household = await seedCardHousehold();
    await saveSettings(household, { paymentDueDay: 10, statementCloseDay: 31 });

    const result = await detail(household, '2026-01-15');

    expect(result.error).toBeInstanceOf(BadRequestError);
  });

  it('refuses a non-card account', async () => {
    const household = await seedCardHousehold();

    const result = await detail(household, '2026-01-31');

    expect(result.error).toBeInstanceOf(BadRequestError);
  });

  it('cannot read another household’s statement', async () => {
    const household = await seedCardHousehold();
    await saveSettings(household, { paymentDueDay: 10, statementCloseDay: 31 });
    const other = await seedHousehold(db.em());

    const result = await call(getCreditCardStatementDetailHandler, request({ params: { accountId: String(household.account.accountKey), statementDate: '2026-01-31' }, tenant: other.tenant, user: other.appuser }));

    expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('a transaction statement override', () => {
  it('is stored and can be cleared', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const charge = await addTransaction(em, household, { amount: -50, date: utc('2026-01-10'), status: 'BOOKED' });

    await call(updateTransaction, request({ body: { statementDateOverride: '2026-02-10' }, params: { transactionId: String(charge.transactionKey) }, tenant: household.tenant, user: household.appuser }));
    let stored = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey });
    expect(stored.statementDateOverride?.toISOString().slice(0, 10)).toBe('2026-02-10');

    await call(updateTransaction, request({ body: { statementDateOverride: null }, params: { transactionId: String(charge.transactionKey) }, tenant: household.tenant, user: household.appuser }));
    stored = await db.em().findOneOrFail(Transaction, { transactionKey: charge.transactionKey });
    expect(stored.statementDateOverride).toBeNull();
  });
});
