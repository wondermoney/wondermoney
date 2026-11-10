import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import type { EntityManager } from '@mikro-orm/postgresql';

import { addAccount, addCategory, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Goal } from '@entity/Goal';
import { Portfolio } from '@entity/Portfolio';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import accountRoutes from '@route/account';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * A payment to a broker, or to an account outside WonderMoney, has no counterpart row, so transfer
 * matching cannot see it is a transfer. The user can say so: they re-type it as a transfer, and
 * optionally say where the money went (another account, a portfolio or a goal). The row then leaves
 * spending, and transfer matching never types it back.
 */
describe('marking a transaction as a transfer', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  let sequence = 0;

  async function type(em: EntityManager, name: string): Promise<TransactionType> {
    return (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName: name, name }, { partial: true });
  }

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const types = { DEPOSIT: await type(em, 'DEPOSIT'), PAYMENT: await type(em, 'PAYMENT'), TRANSFER_IN: await type(em, 'TRANSFER_IN'), TRANSFER_OUT: await type(em, 'TRANSFER_OUT') };
    await em.flush();
    const partner = await addPartner(em, owner);
    const savings = await addAccount(em, owner, { name: 'Savings' });
    const partnerPrivate = await addAccount(em, owner, { isPrivate: true, name: 'Partner private', owner: partner });
    const portfolio = em.create(Portfolio, { currencyKey: owner.currency, name: 'Broker', portfolioOwnerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });
    const goal = em.create(Goal, { appuserKey: owner.appuser, currencyKey: owner.currency, name: 'House deposit', targetAmount: 20000, tenantKey: owner.tenant }, { partial: true });
    const neighbour = await seedHousehold(em);
    const theirPortfolio = em.create(Portfolio, { currencyKey: neighbour.currency, name: 'Theirs', portfolioOwnerAppuserKey: neighbour.appuser, tenantKey: neighbour.tenant }, { partial: true });
    await em.flush();
    const groceries = await addCategory(em, owner, 'Groceries');
    return { goal, groceries, neighbour, owner, partner, partnerPrivate, portfolio, savings, theirPortfolio, types };
  }

  /** A row as bank sync stores it: PAYMENT for money out, DEPOSIT for money in. */
  async function synced(household: Household, input: { account?: Account; amount: number; date?: Date }, types: Awaited<ReturnType<typeof households>>['types']) {
    return addTransaction(db.em(), household, { account: input.account, amount: input.amount, date: input.date ?? JULY_10, enableBankingTransactionId: `eb-${++sequence}`, status: 'BOOKED', type: input.amount < 0 ? types.PAYMENT : types.DEPOSIT });
  }

  const patch = (user: Appuser, transactionKey: number, body: Record<string, unknown>) => http.as(user).patch(`/v1/account/transaction/${transactionKey}`).send(body);
  const stored = (transactionKey: number) => db.em().findOneOrFail(Transaction, { transactionKey }, { filters: false, populate: ['transactionTypeKey', 'transferCounterpartKey'] });
  const reconcile = (tenantKey: number) => reconcileTransfers(db.em(), { actorType: TransactionAuditActorType.SYNC, apply: true, source: 'transfer-matching', tenantKey });

  it('takes a payment to a portfolio out of spending', async () => {
    const { groceries, owner, portfolio, types } = await households();
    const payment = await synced(owner, { amount: -300 }, types);
    await addTransaction(db.em(), owner, { amount: -40, category: groceries, date: JULY_10, status: 'BOOKED' });
    const spending = async () => (await getSpendingByCategoryReport({ filters: reportFiltersSchema.parse({ fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' }), tenant: owner.tenant, user: owner.appuser })).data.map((row) => [row.name, row.totalAmount]);
    expect(await spending()).toEqual([['Uncategorized', 300], ['Groceries', 40]]);

    const response = await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: portfolio.portfolioKey, type: 'portfolio' } });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({ transactionTypeKey: { name: 'TRANSFER_OUT' }, transferDestination: { key: portfolio.portfolioKey, name: 'Broker', type: 'portfolio' } });
    expect(await spending()).toEqual([['Groceries', 40]]);
    const listed = await http.as(owner.appuser).get('/v1/account/transaction');
    expect((listed.body.transactions as { transactionKey: number; transferDestination: unknown }[]).find((row) => row.transactionKey === payment.transactionKey)?.transferDestination).toEqual({ key: portfolio.portfolioKey, name: 'Broker', type: 'portfolio' });
  });

  it('is never typed back by transfer matching', async () => {
    const { owner, types } = await households();
    const payment = await synced(owner, { amount: -300 }, types);
    await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT' });

    await reconcile(owner.tenant.tenantKey);

    expect((await stored(payment.transactionKey)).transactionTypeKey?.name).toBe('TRANSFER_OUT');
  });

  it('keeps a payment a user marked as not a transfer out of a pair, and frees its partner', async () => {
    const { owner, savings, types } = await households();
    const out = await synced(owner, { amount: -150 }, types);
    const into = await synced(owner, { account: savings, amount: 150 }, types);
    await reconcile(owner.tenant.tenantKey);
    expect((await stored(out.transactionKey)).transactionTypeKey?.name).toBe('TRANSFER_OUT');

    const response = await patch(owner.appuser, out.transactionKey, { transactionType: 'PAYMENT' });
    await reconcile(owner.tenant.tenantKey);

    expect(response.status).toBe(200);
    const [outAfter, intoAfter] = [await stored(out.transactionKey), await stored(into.transactionKey)];
    expect([outAfter.transactionTypeKey?.name, outAfter.transferCounterpartKey ?? null]).toEqual(['PAYMENT', null]);
    expect([intoAfter.transactionTypeKey?.name, intoAfter.transferCounterpartKey ?? null]).toEqual(['DEPOSIT', null]);
  });

  it('pairs a marked transfer with its other half on another household account', async () => {
    const { owner, savings, types } = await households();
    const out = await synced(owner, { amount: -150 }, types);
    // An incoming row two days later: matching would pair them on its own, but here the user marks
    // the outgoing one first; the pair still forms, with the user's type kept.
    await patch(owner.appuser, out.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: savings.accountKey, type: 'account' } });
    const into = await synced(owner, { account: savings, amount: 150, date: new Date('2026-07-12T12:00:00Z') }, types);

    await reconcile(owner.tenant.tenantKey);

    expect((await stored(out.transactionKey)).transferCounterpartKey?.transactionKey).toBe(into.transactionKey);
    expect((await stored(into.transactionKey)).transactionTypeKey?.name).toBe('TRANSFER_IN');
  });

  it('marks money in as an incoming transfer, and refuses a type against the amount\'s direction', async () => {
    const { owner, types } = await households();
    const deposit = await synced(owner, { amount: 500 }, types);

    expect((await patch(owner.appuser, deposit.transactionKey, { transactionType: 'TRANSFER_OUT' })).status).toBe(400);
    expect((await patch(owner.appuser, deposit.transactionKey, { transactionType: 'PAYMENT' })).status).toBe(400);
    expect((await patch(owner.appuser, deposit.transactionKey, { transactionType: 'TRANSFER_IN' })).status).toBe(200);
    expect((await stored(deposit.transactionKey)).transactionTypeKey?.name).toBe('TRANSFER_IN');
  });

  it('records a destination only on an outgoing transfer, and clears it when the row is no longer one', async () => {
    const { goal, owner, types } = await households();
    const payment = await synced(owner, { amount: -300 }, types);

    expect((await patch(owner.appuser, payment.transactionKey, { transferDestination: { key: goal.goalKey, type: 'goal' } })).status).toBe(400);
    expect((await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: goal.goalKey, type: 'goal' } })).status).toBe(200);
    expect((await stored(payment.transactionKey)).transferDestinationGoalKey?.goalKey).toBe(goal.goalKey);

    await patch(owner.appuser, payment.transactionKey, { transactionType: 'PAYMENT' });

    expect((await stored(payment.transactionKey)).transferDestinationGoalKey ?? null).toBeNull();
  });

  it('never points at another household\'s portfolio, a partner\'s private account, or the row\'s own account', async () => {
    const { owner, partnerPrivate, theirPortfolio, types } = await households();
    const payment = await synced(owner, { amount: -300 }, types);

    expect((await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: theirPortfolio.portfolioKey, type: 'portfolio' } })).status).toBe(404);
    expect((await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: partnerPrivate.accountKey, type: 'account' } })).status).toBe(404);
    expect((await patch(owner.appuser, payment.transactionKey, { transactionType: 'TRANSFER_OUT', transferDestination: { key: owner.account.accountKey, type: 'account' } })).status).toBe(400);
    // A refused request changes nothing.
    expect((await stored(payment.transactionKey)).transactionTypeKey?.name).toBe('PAYMENT');
  });

  it('cannot re-type another household\'s transaction', async () => {
    const { neighbour, owner, types } = await households();
    const theirs = await synced(neighbour, { amount: -300 }, types);

    expect((await patch(owner.appuser, theirs.transactionKey, { transactionType: 'TRANSFER_OUT' })).status).toBe(404);
    expect((await stored(theirs.transactionKey)).transactionTypeKey?.name).toBe('PAYMENT');
  });
});
