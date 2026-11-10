import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, addTransaction, currencyFor, type Household, seedHousehold, type StatusName } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
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
  interface RowInput { account: Account; amount: number; appuser?: Appuser; date: string; hidden?: boolean; manual?: boolean; status?: StatusName; type?: TypeName }

  /** A row as the sync stores it (provider id set, DEPOSIT for a credit, PAYMENT for a debit), unless `manual`. */
  async function row(ctx: Awaited<ReturnType<typeof household>>, input: RowInput, target: Household = ctx.household): Promise<Transaction> {
    const typeName = input.type ?? (input.amount >= 0 ? 'DEPOSIT' : 'PAYMENT');
    return addTransaction(ctx.em, target, {
      account: input.account,
      amount: input.amount,
      appuser: input.appuser,
      // A row settles in its account's currency.
      currency: input.account.currencyKey,
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
    const base = { booked: true, counterpartKey: null, currencyKey: 1, deleted: false, hidden: false, privateTo: null, synced: true, transferRate: null, userTyped: false };
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

  /*
   * Money sent from a EUR account to a USD account leaves as one amount and arrives as another. The
   * two halves pair when the outgoing amount, converted at the stored rate for its day, lands within
   * the tolerance of the incoming amount (2 percent unless TRANSFER_MATCH_FX_TOLERANCE says
   * otherwise), on two accounts the same people can see.
   */
  describe('across currencies', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    async function multiCurrencyHousehold() {
      const ctx = await household();
      const usd = await currencyFor(ctx.em, 'USD');
      const dollars = await addAccount(ctx.em, ctx.household, { currency: usd, name: 'Dollars' });
      return { ...ctx, dollars, eur: ctx.household.currency, usd };
    }

    /** A stored rate: one `from` buys `rate` of `to`, published on `date`. */
    async function rate(ctx: Awaited<ReturnType<typeof multiCurrencyHousehold>>, date: string, value: number, from = ctx.eur, to = ctx.usd) {
      ctx.em.create(ExchangeRate, { date: day(date), fromCurrency: from, rate: value, toCurrency: to }, { partial: true });
      await ctx.em.flush();
    }

    /** Type, counterpart and stored implied rate of each row, read fresh. */
    async function storedWithRate(...rows: Transaction[]) {
      const found = await db.em().find(Transaction, { transactionKey: { $in: rows.map((r) => r.transactionKey) } }, { filters: false, populate: ['transactionTypeKey'] });
      const byKey = new Map(found.map((t) => [t.transactionKey, t]));
      return rows.map((r) => {
        const t = byKey.get(r.transactionKey);
        return { counterpart: t?.transferCounterpartKey?.transactionKey ?? null, rate: t?.transferExchangeRate ?? null, type: t?.transactionTypeKey?.name };
      });
    }

    it('pairs EUR 100 out with USD 108 in a day later at that day\'s rate of 1.08, and stores the implied rate on both rows', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-03', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-04' });

      const result = await reconcile(ctx.household.tenant.tenantKey);

      expect(result).toMatchObject({ pairsMatched: 1 });
      expect(await storedWithRate(out, into)).toEqual([
        { counterpart: into.transactionKey, rate: 1.08, type: 'TRANSFER_OUT' },
        { counterpart: out.transactionKey, rate: 1.08, type: 'TRANSFER_IN' },
      ]);
    });

    it('pairs at a rate the household set itself, and never at one another household set', async () => {
      const ctx = await multiCurrencyHousehold();
      ctx.em.create(ExchangeRateOverride, { date: day('2026-07-03'), fromCurrency: ctx.eur, rate: 1.08, tenantKey: ctx.household.tenant, toCurrency: ctx.usd }, { partial: true });
      await ctx.em.flush();
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-04' });
      const neighbour = await multiCurrencyHousehold();
      const theirOut = await row(neighbour, { account: neighbour.current, amount: -100, date: '2026-07-03' });
      const theirIn = await row(neighbour, { account: neighbour.dollars, amount: 108, date: '2026-07-04' });

      await reconcile(ctx.household.tenant.tenantKey);
      await reconcile(neighbour.household.tenant.tenantKey);

      expect(await storedWithRate(out, into)).toEqual([
        { counterpart: into.transactionKey, rate: 1.08, type: 'TRANSFER_OUT' },
        { counterpart: out.transactionKey, rate: 1.08, type: 'TRANSFER_IN' },
      ]);
      expect((await stored(theirOut, theirIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
    });

    it('pairs a transfer a bank spread or fee moved within the tolerance, and not one moved beyond it', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      // 100 EUR is 108 USD; 106.50 arrived (1.4 percent off).
      const spreadOut = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const spreadIn = await row(ctx, { account: ctx.dollars, amount: 106.5, date: '2026-07-01' });
      // 101 EUR left, 1 of it a fee: 109.08 USD at the rate, 108 arrived (1 percent off).
      const feeOut = await row(ctx, { account: ctx.current, amount: -101, date: '2026-07-10' });
      const feeIn = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-11' });
      // 200 EUR is 216 USD; 210 arrived (2.9 percent off): not the same money.
      const farOut = await row(ctx, { account: ctx.current, amount: -200, date: '2026-07-20' });
      const farIn = await row(ctx, { account: ctx.dollars, amount: 210, date: '2026-07-20' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(spreadOut, spreadIn, feeOut, feeIn, farOut, farIn)).map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER_IN', 'PAYMENT', 'DEPOSIT']);
      expect((await storedWithRate(spreadIn))[0]?.rate).toBe(1.065);
    });

    it('takes the tolerance from TRANSFER_MATCH_FX_TOLERANCE', async () => {
      vi.stubEnv('TRANSFER_MATCH_FX_TOLERANCE', '0.005');
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const into = await row(ctx, { account: ctx.dollars, amount: 106.5, date: '2026-07-01' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(out, into)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
    });

    it('leaves the pair unpaired when no rate is stored for the day, never assuming one', async () => {
      const ctx = await multiCurrencyHousehold();
      // Only a rate published after the transfer, and one for the opposite direction's currency
      // pair: neither converts EUR to USD on 3 July.
      await rate(ctx, '2026-07-06', 1.08);
      await rate(ctx, '2026-07-01', 0.925, ctx.usd, ctx.eur);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-04' });
      // Same digits, no rate at all: a 1.0 fallback would pair these.
      const sameDigitsOut = await row(ctx, { account: ctx.current, amount: -50, date: '2026-07-03' });
      const sameDigitsIn = await row(ctx, { account: ctx.dollars, amount: 50, date: '2026-07-03' });

      const result = await reconcile(ctx.household.tenant.tenantKey);

      expect(result).toMatchObject({ pairsMatched: 0, rowsChanged: 0 });
      expect((await stored(out, into, sameDigitsOut, sameDigitsIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'PAYMENT', 'DEPOSIT']);
    });

    it('pairs at the latest earlier rate, however old (a provisional rate)', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-06-01', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-03' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(out, into)).map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    });

    it('never pairs into a partner\'s private account, nor a shared account with a private one', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const partner = await addPartner(ctx.em, ctx.household);
      const partnersPrivate = await addAccount(ctx.em, ctx.household, { currency: ctx.usd, isPrivate: true, name: 'Partner dollars', owner: partner });
      const ownPrivate = await addAccount(ctx.em, ctx.household, { currency: ctx.usd, isPrivate: true, name: 'My dollars' });
      const toPartner = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const partnerIn = await row(ctx, { account: partnersPrivate, amount: 108, appuser: partner, date: '2026-07-01' });
      // The partner sees the shared EUR account but not the private USD one.
      const toOwnPrivate = await row(ctx, { account: ctx.current, amount: -200, date: '2026-07-10' });
      const ownPrivateIn = await row(ctx, { account: ownPrivate, amount: 216, date: '2026-07-10' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(toPartner, partnerIn, toOwnPrivate, ownPrivateIn)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'PAYMENT', 'DEPOSIT']);
    });

    it('pairs two private accounts of the same member', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const privateEuros = await addAccount(ctx.em, ctx.household, { isPrivate: true, name: 'My euros' });
      const privateDollars = await addAccount(ctx.em, ctx.household, { currency: ctx.usd, isPrivate: true, name: 'My dollars' });
      const out = await row(ctx, { account: privateEuros, amount: -100, date: '2026-07-01' });
      const into = await row(ctx, { account: privateDollars, amount: 108, date: '2026-07-01' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(out, into)).map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    });

    it('never pairs rows of two different households', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const other = await seedHousehold(ctx.em);
      const theirDollars = await addAccount(ctx.em, other, { currency: ctx.usd });
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const into = await row(ctx, { account: theirDollars, amount: 108, date: '2026-07-01' }, other);

      await reconcile(ctx.household.tenant.tenantKey);
      await reconcile(other.tenant.tenantKey);

      expect((await stored(out, into)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
    });

    it('leaves ambiguous candidates unpaired: two incoming rows within the tolerance, equally close', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const moreDollars = await addAccount(ctx.em, ctx.household, { currency: ctx.usd, name: 'More dollars' });
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const a = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-02' });
      const b = await row(ctx, { account: moreDollars, amount: 107, date: '2026-07-02' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(out, a, b)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT', 'DEPOSIT']);
    });

    it('never pairs outside the matching window', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-01' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-05' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect((await stored(out, into)).map((r) => r.type)).toEqual(['PAYMENT', 'DEPOSIT']);
    });

    it('keeps an exact same-currency match ahead of a cross-currency one', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-01', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const euros = await row(ctx, { account: ctx.savings, amount: 100, date: '2026-07-04' });
      const dollars = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-04' });

      await reconcile(ctx.household.tenant.tenantKey);

      expect(await storedWithRate(out, euros, dollars)).toEqual([
        { counterpart: euros.transactionKey, rate: null, type: 'TRANSFER_OUT' },
        { counterpart: out.transactionKey, rate: null, type: 'TRANSFER_IN' },
        { counterpart: null, rate: null, type: 'DEPOSIT' },
      ]);
    });

    it('is idempotent: a second run keeps the pair and writes nothing', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-03', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 107.2, date: '2026-07-04' });
      await reconcile(ctx.household.tenant.tenantKey);
      const auditRows = await db.em().count(TransactionAuditLog, {});

      const second = await reconcile(ctx.household.tenant.tenantKey);

      expect(second).toMatchObject({ pairsDissolved: 0, pairsMatched: 0, rowsChanged: 0 });
      expect(await db.em().count(TransactionAuditLog, {})).toBe(auditRows);
      expect((await storedWithRate(out, into)).map((r) => [r.type, r.rate])).toEqual([['TRANSFER_OUT', 1.072], ['TRANSFER_IN', 1.072]]);
    });

    it('dissolves a cross-currency pair once an amount moves beyond the tolerance', async () => {
      const ctx = await multiCurrencyHousehold();
      await rate(ctx, '2026-07-03', 1.08);
      const out = await row(ctx, { account: ctx.current, amount: -100, date: '2026-07-03' });
      const into = await row(ctx, { account: ctx.dollars, amount: 108, date: '2026-07-03' });
      await reconcile(ctx.household.tenant.tenantKey);
      const em = db.em();
      const resettled = await em.findOneOrFail(Transaction, { transactionKey: into.transactionKey });
      resettled.settlementAmount = 90;
      await em.flush();

      const result = await reconcile(ctx.household.tenant.tenantKey);

      expect(result.pairsDissolved).toBe(1);
      expect(await storedWithRate(out, into)).toEqual([{ counterpart: null, rate: null, type: 'PAYMENT' }, { counterpart: null, rate: null, type: 'DEPOSIT' }]);
    });

    it('accepts a difference of exactly the tolerance and nothing more', () => {
      const base = { booked: true, counterpartKey: null, deleted: false, hidden: false, privateTo: null, synced: true, transferRate: null, userTyped: false };
      const rows: TransferRow[] = [
        { ...base, accountKey: 1, cents: -10_000, currencyKey: 1, day: 3, transactionKey: 1, typeName: 'PAYMENT' },
        // 100.00 at 1.02 is 102.00, exactly 2 percent of the 100.00 that arrived.
        { ...base, accountKey: 2, cents: 10_000, currencyKey: 2, day: 3, transactionKey: 2, typeName: 'DEPOSIT' },
        { ...base, accountKey: 1, cents: -20_000, currencyKey: 1, day: 10, transactionKey: 3, typeName: 'PAYMENT' },
        // 200.00 at 1.02 is 204.00, 4.01 away from 199.99: just over 2 percent of it.
        { ...base, accountKey: 2, cents: 19_999, currencyKey: 2, day: 10, transactionKey: 4, typeName: 'DEPOSIT' },
      ];

      const plan = planTransfers(rows, { fxTolerance: 0.02, rateOn: () => 1.02 });

      expect(plan.changes.map((change) => [change.transactionKey, change.counterpartKey.to])).toEqual([[1, 2], [2, 1]]);
    });
  });
});
