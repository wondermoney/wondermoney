import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addAccount, addTransaction, type Household, seedHousehold, type StatusName } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { Currency } from '@entity/Currency';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';

import { planTransfers, reconcileTransfers, type TransferRow } from '../transfer-matching.service';

/*
 * A synced credit is income unless it is one half of a transfer between two accounts of the
 * same household: an outgoing and an incoming booked row of the same amount and currency, a few days
 * apart at most. Only such a matched pair is typed TRANSFER_OUT / TRANSFER_IN, which reports leave out.
 */
describe('transfer matching', () => {
  const db = useTestDatabase();
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  let sequence = 0;

  async function type(em: EntityManager, name: string): Promise<TransactionType> {
    return (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName: name, name }, { partial: true });
  }

  async function household() {
    const em = db.em();
    const seeded = await seedHousehold(em);
    const types = { DEPOSIT: await type(em, 'DEPOSIT'), PAYMENT: await type(em, 'PAYMENT'), TRANSFER_IN: await type(em, 'TRANSFER_IN'), TRANSFER_OUT: await type(em, 'TRANSFER_OUT') };
    await em.flush();
    const savings = await addAccount(em, seeded, { name: 'Savings' });
    return { current: seeded.account, em, household: seeded, savings, types };
  }

  type TypeName = 'DEPOSIT' | 'PAYMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  interface RowInput { account: Account; amount: number; date: string; hidden?: boolean; manual?: boolean; status?: StatusName; type?: TypeName }

  /** A row as the sync stores it (provider id set, DEPOSIT for a credit, PAYMENT for a debit), unless `manual`. */
  async function row(ctx: Awaited<ReturnType<typeof household>>, input: RowInput, target: Household = ctx.household): Promise<Transaction> {
    const typeName = input.type ?? (input.amount >= 0 ? 'DEPOSIT' : 'PAYMENT');
    return addTransaction(ctx.em, target, {
      account: input.account,
      amount: input.amount,
      date: day(input.date),
      enableBankingTransactionId: input.manual ? undefined : `eb-${++sequence}`,
      hidden: input.hidden,
      status: input.status ?? 'BOOKED',
      type: await type(ctx.em, typeName),
    });
  }

  async function reconcile(tenantKey: number, options: { apply?: boolean; from?: Date } = {}) {
    return reconcileTransfers(db.em(), { actorType: TransactionAuditActorType.SYNC, apply: options.apply ?? true, from: options.from, source: 'test', tenantKey });
  }

  /** Each row's stored type name and counterpart key, read fresh. */
  async function stored(...rows: Transaction[]) {
    const found = await db.em().find(Transaction, { transactionKey: { $in: rows.map((r) => r.transactionKey) } }, { filters: false, populate: ['transactionTypeKey'] });
    const byKey = new Map(found.map((t) => [t.transactionKey, t]));
    return rows.map((r) => {
      const t = byKey.get(r.transactionKey);
      return { counterpart: t?.transferCounterpartKey?.transactionKey ?? null, type: t?.transactionTypeKey?.name };
    });
  }

  it('pairs an outgoing payment with the same amount arriving on another household account, both ways', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -500, date: '2026-07-03' });
    const into = await row(ctx, { account: ctx.savings, amount: 500, date: '2026-07-04' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect(await stored(out, into)).toEqual([{ counterpart: into.transactionKey, type: 'TRANSFER_OUT' }, { counterpart: out.transactionKey, type: 'TRANSFER_IN' }]);
  });

  it('leaves a salary with no matching outgoing payment as a deposit', async () => {
    const ctx = await household();
    const salary = await row(ctx, { account: ctx.current, amount: 2000, date: '2026-07-01' });
    const rent = await row(ctx, { account: ctx.current, amount: -800, date: '2026-07-02' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect(await stored(salary, rent)).toEqual([{ counterpart: null, type: 'DEPOSIT' }, { counterpart: null, type: 'PAYMENT' }]);
  });

  it('pairs rows three days apart, but not four', async () => {
    const ctx = await household();
    const out3 = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
    const in3 = await row(ctx, { account: ctx.savings, amount: 100, date: '2026-07-06' });
    const out4 = await row(ctx, { account: ctx.current, amount: -70, date: '2026-07-03' });
    const in4 = await row(ctx, { account: ctx.savings, amount: 70, date: '2026-07-07' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(out3, in3)).map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    expect((await stored(out4, in4)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
  });

  it('never pairs rows on the same account, with different amounts, or in different currencies', async () => {
    const ctx = await household();
    const usd = ctx.em.create(Currency, { code: 'USD', num: '840' }, { partial: true });
    await ctx.em.flush();
    const sameAccountOut = await row(ctx, { account: ctx.current, amount: -40, date: '2026-07-03' });
    const sameAccountIn = await row(ctx, { account: ctx.current, amount: 40, date: '2026-07-03' });
    const shortOut = await row(ctx, { account: ctx.current, amount: -60, date: '2026-07-03' });
    const longIn = await row(ctx, { account: ctx.savings, amount: 60.01, date: '2026-07-03' });
    const eurOut = await row(ctx, { account: ctx.current, amount: -25, date: '2026-07-03' });
    const usdIn = await row(ctx, { account: ctx.savings, amount: 25, date: '2026-07-03' });
    usdIn.settlementCurrencyKey = usd;
    await ctx.em.flush();

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(sameAccountOut, sameAccountIn, shortOut, longIn, eurOut, usdIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'PAYMENT', 'DEPOSIT', 'PAYMENT', 'DEPOSIT']);
  });

  it('never pairs rows of two different households', async () => {
    const ctx = await household();
    const other = await seedHousehold(ctx.em);
    const out = await row(ctx, { account: ctx.current, amount: -300, date: '2026-07-03' });
    const into = await row(ctx, { account: other.account, amount: 300, date: '2026-07-03' }, other);

    await reconcile(ctx.household.tenant.tenantKey);
    await reconcile(other.tenant.tenantKey);

    expect((await stored(out, into)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
  });

  it('pairs with the closest date when several rows match', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -200, date: '2026-07-03' });
    const far = await row(ctx, { account: ctx.savings, amount: 200, date: '2026-07-01' });
    const near = await row(ctx, { account: ctx.savings, amount: 200, date: '2026-07-04' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect(await stored(out, far, near)).toEqual([{ counterpart: near.transactionKey, type: 'TRANSFER_OUT' }, { counterpart: null, type: 'DEPOSIT' }, { counterpart: out.transactionKey, type: 'TRANSFER_IN' }]);
  });

  it('leaves a tie unpaired: two incoming rows equally close to one outgoing', async () => {
    const ctx = await household();
    const third = await addAccount(ctx.em, ctx.household, { name: 'Joint' });
    const out = await row(ctx, { account: ctx.current, amount: -150, date: '2026-07-03' });
    const a = await row(ctx, { account: ctx.savings, amount: 150, date: '2026-07-04' });
    const b = await row(ctx, { account: third, amount: 150, date: '2026-07-02' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(out, a, b)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'DEPOSIT']);
  });

  it('resolves a tie once the closer match of one of its rows is taken', () => {
    const base = { booked: true, counterpartKey: null, currencyKey: 1, deleted: false, hidden: false, synced: true, userTyped: false };
    const rows: TransferRow[] = [
      { ...base, accountKey: 1, cents: -10_000, day: 3, transactionKey: 1, typeName: 'PAYMENT' },
      { ...base, accountKey: 2, cents: 10_000, day: 3, transactionKey: 2, typeName: 'DEPOSIT' },
      { ...base, accountKey: 1, cents: -10_000, day: 4, transactionKey: 3, typeName: 'PAYMENT' },
      { ...base, accountKey: 3, cents: 10_000, day: 5, transactionKey: 4, typeName: 'DEPOSIT' },
    ];

    // 3 is one day from both 2 and 4; 2 goes to 1 (same day), which leaves 3 with 4 alone.
    const plan = planTransfers(rows);

    expect(plan.changes.map((change) => [change.transactionKey, change.counterpartKey.to])).toEqual([[1, 2], [2, 1], [3, 4], [4, 3]]);
  });

  it('pairs only booked, visible rows', async () => {
    const ctx = await household();
    const pendingOut = await row(ctx, { account: ctx.current, amount: -90, date: '2026-07-03', status: 'PENDING' });
    const pendingIn = await row(ctx, { account: ctx.savings, amount: 90, date: '2026-07-03' });
    const hiddenOut = await row(ctx, { account: ctx.current, amount: -80, date: '2026-07-03', hidden: true });
    const hiddenIn = await row(ctx, { account: ctx.savings, amount: 80, date: '2026-07-03' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(pendingOut, pendingIn, hiddenOut, hiddenIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'PAYMENT', 'DEPOSIT']);
  });

  it('never pairs a soft-deleted row', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -90, date: '2026-07-03' });
    const deletedIn = await row(ctx, { account: ctx.savings, amount: 90, date: '2026-07-03' });
    deletedIn.deletedAt = new Date();
    await ctx.em.flush();

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(out, deletedIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
  });

  it('pairs a synced payment with a manual transfer the user entered, without changing the manual row', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -250, date: '2026-07-03' });
    const manualIn = await row(ctx, { account: ctx.savings, amount: 250, date: '2026-07-03', manual: true, type: 'TRANSFER_IN' });

    await reconcile(ctx.household.tenant.tenantKey);

    expect(await stored(out, manualIn)).toEqual([{ counterpart: manualIn.transactionKey, type: 'TRANSFER_OUT' }, { counterpart: out.transactionKey, type: 'TRANSFER_IN' }]);
  });

  it('never re-types a manual deposit or payment: the user chose that type', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -250, date: '2026-07-03' });
    const manualDeposit = await row(ctx, { account: ctx.savings, amount: 250, date: '2026-07-03', manual: true });

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(out, manualDeposit)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
  });

  it('never re-types a synced row whose type a user changed', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -120, date: '2026-07-03' });
    const into = await row(ctx, { account: ctx.savings, amount: 120, date: '2026-07-03' });
    ctx.em.create(TransactionAuditLog, { actorType: TransactionAuditActorType.USER, appuserKey: ctx.household.appuser, changes: { transactionTypeKey: { from: 'TRANSFER_IN', to: 'DEPOSIT' } }, eventType: TransactionAuditEventType.USER_EDIT, tenantKey: ctx.household.tenant, transactionKey: into }, { partial: true });
    await ctx.em.flush();

    await reconcile(ctx.household.tenant.tenantKey);

    expect((await stored(out, into)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
  });

  it('is idempotent: a second run changes nothing and writes no audit rows', async () => {
    const ctx = await household();
    await row(ctx, { account: ctx.current, amount: -500, date: '2026-07-03' });
    await row(ctx, { account: ctx.savings, amount: 500, date: '2026-07-03' });
    await reconcile(ctx.household.tenant.tenantKey);
    const auditRows = await db.em().count(TransactionAuditLog, {});

    const second = await reconcile(ctx.household.tenant.tenantKey);

    expect(second).toMatchObject({ pairsDissolved: 0, pairsMatched: 0, rowsChanged: 0 });
    expect(await db.em().count(TransactionAuditLog, {})).toBe(auditRows);
  });

  it('audits every change it makes as a system edit', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -500, date: '2026-07-03' });
    await row(ctx, { account: ctx.savings, amount: 500, date: '2026-07-03' });

    await reconcile(ctx.household.tenant.tenantKey);

    const audits = await db.em().find(TransactionAuditLog, { transactionKey: out });
    expect(audits).toEqual([expect.objectContaining({ actorType: TransactionAuditActorType.SYNC, changes: { transactionTypeKey: { from: 'PAYMENT', to: 'TRANSFER_OUT' }, transferCounterpartKey: { from: null, to: expect.any(Number) } }, eventType: TransactionAuditEventType.SYSTEM_EDIT, source: 'test' })]);
  });

  it('dissolves a pair once one side no longer settles, and gives the synced side its own type back', async () => {
    const ctx = await household();
    const out = await row(ctx, { account: ctx.current, amount: -500, date: '2026-07-03' });
    const into = await row(ctx, { account: ctx.savings, amount: 500, date: '2026-07-03' });
    await reconcile(ctx.household.tenant.tenantKey);
    const em = db.em();
    const voided = await em.findOneOrFail(Transaction, { transactionKey: into.transactionKey });
    voided.transactionStatusKey = ctx.household.statuses.EXPIRED;
    await em.flush();

    const result = await reconcile(ctx.household.tenant.tenantKey);

    expect(result.pairsDissolved).toBe(1);
    expect(await stored(out, into)).toEqual([{ counterpart: null, type: 'PAYMENT' }, { counterpart: null, type: 'DEPOSIT' }]);
  });

  it('retypes a synced credit stored as a transfer as a deposit, unless it pairs', async () => {
    const ctx = await household();
    const salary = await row(ctx, { account: ctx.current, amount: 2000, date: '2026-01-01', type: 'TRANSFER_IN' });
    const out = await row(ctx, { account: ctx.current, amount: -300, date: '2026-01-05' });
    const ownTransfer = await row(ctx, { account: ctx.savings, amount: 300, date: '2026-01-05', type: 'TRANSFER_IN' });
    const manualTransfer = await row(ctx, { account: ctx.savings, amount: 999, date: '2026-01-09', manual: true, type: 'TRANSFER_IN' });

    const result = await reconcile(ctx.household.tenant.tenantKey);

    expect(await stored(salary, out, ownTransfer, manualTransfer)).toEqual([
      { counterpart: null, type: 'DEPOSIT' },
      { counterpart: ownTransfer.transactionKey, type: 'TRANSFER_OUT' },
      { counterpart: out.transactionKey, type: 'TRANSFER_IN' },
      { counterpart: null, type: 'TRANSFER_IN' },
    ]);
    expect(result).toMatchObject({ pairsMatched: 1, retypedAsIncome: 1 });
  });

  it('writes nothing on a dry run, and reports what it would do', async () => {
    const ctx = await household();
    const salary = await row(ctx, { account: ctx.current, amount: 2000, date: '2026-01-01', type: 'TRANSFER_IN' });
    const out = await row(ctx, { account: ctx.current, amount: -300, date: '2026-01-05' });
    const into = await row(ctx, { account: ctx.savings, amount: 300, date: '2026-01-05' });

    const result = await reconcile(ctx.household.tenant.tenantKey, { apply: false });

    expect(result).toMatchObject({ pairsMatched: 1, retypedAsIncome: 1, rowsChanged: 3 });
    expect(await stored(salary, out, into)).toEqual([{ counterpart: null, type: 'TRANSFER_IN' }, { counterpart: null, type: 'PAYMENT' }, { counterpart: null, type: 'DEPOSIT' }]);
    expect(await db.em().count(TransactionAuditLog, {})).toBe(0);
  });

  it('only looks at rows from `from` on, less the matching window', async () => {
    const ctx = await household();
    const oldOut = await row(ctx, { account: ctx.current, amount: -500, date: '2026-01-03' });
    const oldIn = await row(ctx, { account: ctx.savings, amount: 500, date: '2026-01-03' });
    const newOut = await row(ctx, { account: ctx.current, amount: -40, date: '2026-07-03' });
    const newIn = await row(ctx, { account: ctx.savings, amount: 40, date: '2026-07-04' });

    await reconcile(ctx.household.tenant.tenantKey, { from: day('2026-07-01') });

    expect((await stored(oldOut, oldIn, newOut, newIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'TRANSFER_OUT', 'TRANSFER_IN']);
  });
});
