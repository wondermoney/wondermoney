import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import type { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

import { findLikelyDuplicateCandidates } from '../likely-duplicate-candidates';
import { TransactionImportService } from '../transaction-import.service';

import { ynabFile, ynabStorage } from './ynab-import-helpers';

/*
 * A file row that no id matches may still repeat a transaction the account holds: the bank synced
 * it a day earlier, or the file describes it differently. Such a row is a possible duplicate,
 * shown with the transaction it repeats and skipped unless the person includes it; one
 * transaction answers for one row only, and only transactions on the row's own account, of the
 * person importing, count.
 */
describe('likely duplicates on import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  function setup() {
    const ctx = ynabStorage();
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue: ctx.enqueue, storage: ctx.storage });
    const runLastJob = () => {
      const job = ctx.sent.at(-1);
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, `job-${ctx.sent.length}`, job.data.mode);
    };
    return { ...ctx, runLastJob, service };
  }

  const statement = (rows: string[]) => ['Movimentos da conta', '', 'Data mov.;Data valor;Descrição;Débito;Crédito;Saldo', ...rows].join('\r\n');

  async function staged(ctx: ReturnType<typeof setup>, content: string, options: { autoCommit?: boolean; format?: 'generic-csv' | 'statement' | 'ynab' } = {}) {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, autoCommit: options.autoCommit, format: options.format ?? 'statement', key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, { pageSize: 200 });
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  /** A transaction the bank sync stored, on the household's account unless another is given. */
  async function synced(input: { account?: Account; amount: number; date: Date; hidden?: boolean; merchant?: string }) {
    const merchant = input.merchant ? await addMerchant(db.em(), household, input.merchant) : undefined;
    return addTransaction(db.em(), household, { account: input.account, amount: input.amount, date: input.date, enableBankingTransactionId: `eb-${Math.random()}`, hidden: input.hidden, merchant, status: 'BOOKED' });
  }

  const storedAmounts = async (account: Account = household.account) => (await db.em().find(Transaction, { accountKey: account, deletedAt: null }, { filters: false, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' } })).map((row) => row.settlementAmount);
  const summary = (view: Awaited<ReturnType<typeof staged>>) => view.rows.items.map((row) => ({ decision: row.decision, matched: row.matchedTransaction?.id ?? null, reason: row.matchReason, status: row.status }));

  it('flags a file row dated a day after a synced transaction with the same amount, showing that transaction, and skips it by default', async () => {
    const ctx = setup();
    const existing = await synced({ amount: -42.5, date: day('2026-09-01'), merchant: 'Continente' });

    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50']));

    expect(summary(view)).toEqual([{ decision: 'skip', matched: existing.transactionKey, reason: 'likely', status: 'possible_duplicate' }]);
    expect(view.rows.items[0]!.matchedTransaction).toMatchObject({ amount: -42.5, date: '2026-09-01T00:00:00.000Z', description: 'Continente' });
    expect(view.session.counts).toMatchObject({ new: 0, possible_duplicate: 1 });

    await commitAndRun(ctx, view.session.id);
    expect(await storedAmounts()).toEqual([-42.5]);
  });

  it('flags one of two same-day, same-amount rows against one existing transaction, and the other is new', async () => {
    const ctx = setup();
    const existing = await synced({ amount: -2.1, date: day('2026-09-09'), merchant: 'Cafe Boavista' });

    const view = await staged(ctx, statement(['09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.443,10', '09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.441,00']));

    expect(summary(view)).toEqual([
      { decision: 'skip', matched: existing.transactionKey, reason: 'likely', status: 'possible_duplicate' },
      { decision: 'import', matched: null, reason: null, status: 'new' },
    ]);
  });

  it('never flags a row whose amount differs, by a cent or by its sign', async () => {
    const ctx = setup();
    await synced({ amount: -42.51, date: day('2026-09-02'), merchant: 'Continente' });
    await synced({ amount: 12.3, date: day('2026-09-07'), merchant: 'Farmacia Central' });

    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50', '07-09-2026;07-09-2026;FARMACIA CENTRAL;12,30;;945,20']));

    expect(view.rows.items.map((row) => row.status)).toEqual(['new', 'new']);
  });

  it('writes a flagged row the person chose to import, as a new transaction beside the one it resembles', async () => {
    const ctx = setup();
    await synced({ amount: -42.5, date: day('2026-09-01'), merchant: 'Continente' });
    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50']));

    await ctx.service().decide(ownerScope(), view.session.id, { decision: 'import', status: 'possible_duplicate' });
    await commitAndRun(ctx, view.session.id);

    expect(await storedAmounts()).toEqual([-42.5, -42.5]);
    expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.counts).toMatchObject({ imported: 1, possible_duplicate: 0 });
  });

  it('imports possible duplicates in a one-step import, which no one reviews: nothing is dropped without a decision', async () => {
    const ctx = setup();
    await synced({ amount: -42.5, date: day('2026-09-01'), merchant: 'Continente' });

    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50']), { autoCommit: true });

    expect(view.session.status).toBe('succeeded');
    expect(await storedAmounts()).toEqual([-42.5, -42.5]);
  });

  it('in a one-step import, imports only rows the likely match flagged, and still skips rows already in the account or repeated in the file', async () => {
    const ctx = setup();
    const typeKey = async (name: string) => (await db.em().findOneOrFail(TransactionType, { name })).transactionTypeKey;
    const [deposit, payment] = [await typeKey('DEPOSIT'), await typeKey('PAYMENT')];
    const template = (lines: string[]) => ['date,amount,merchant,internalTransactionId,transactionTypeKey,description', ...lines].join('\n');
    const salary = `2026-09-05,1500.00,Employer,salary-1,${deposit},Salary`;
    const first = await staged(ctx, template([salary]), { format: 'generic-csv' });
    await commitAndRun(ctx, first.session.id);
    await synced({ amount: -42.5, date: day('2026-09-01'), merchant: 'Continente' });
    await synced({ amount: -2.1, date: day('2026-09-08') });
    await synced({ amount: -2.1, date: day('2026-09-10') });

    const view = await staged(ctx, template([
      salary, // its id is on the account: same_id
      `2026-09-07,12.30,Farmacia Central,pharmacy-1,${payment},`,
      `2026-09-07,12.30,Farmacia Central,pharmacy-1,${payment},`, // repeats the line above: earlier_in_file
      `2026-09-02,42.50,Continente,continente-1,${payment},`, // a day after a synced transaction: likely
      `2026-09-09,2.10,Cafe Boavista,cafe-1,${payment},`, // two synced transactions could be it: ambiguous
    ]), { autoCommit: true, format: 'generic-csv' });

    expect(view.session.status).toBe('succeeded');
    expect(view.rows.items.map((row) => [row.sourceRow, row.status])).toEqual([[2, 'skipped'], [3, 'imported'], [4, 'skipped'], [5, 'imported'], [6, 'imported']]);
    expect((await storedAmounts()).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-42.5, -42.5, -12.3, -2.1, -2.1, -2.1, 1500]);
  });

  it('says a row is ambiguous, matching none, when several transactions could be it', async () => {
    const ctx = setup();
    await synced({ amount: -2.1, date: day('2026-09-08') });
    await synced({ amount: -2.1, date: day('2026-09-10') });

    const view = await staged(ctx, statement(['09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.443,10']));

    expect(summary(view)).toEqual([{ decision: 'skip', matched: null, reason: 'ambiguous', status: 'possible_duplicate' }]);
  });

  it('does not offer a transaction an id already matched as another row\'s likely duplicate', async () => {
    const ctx = setup();
    const first = await staged(ctx, statement(['09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.443,10']));
    await commitAndRun(ctx, first.session.id);

    // The same line again, and a second identical coffee the next day: the first is the stored
    // row by its id, so the second has nothing left to repeat.
    const view = await staged(ctx, statement(['09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.443,10', '10-09-2026;10-09-2026;CAFE BOAVISTA;2,10;;2.441,00']));

    expect(view.rows.items.map((row) => ({ reason: row.matchReason, status: row.status }))).toEqual([
      { reason: 'same_id', status: 'duplicate' },
      { reason: null, status: 'new' },
    ]);
  });

  it('counts hidden transactions and leaves out deleted ones, as the match on ids does', async () => {
    const ctx = setup();
    const hidden = await synced({ amount: -42.5, date: day('2026-09-01'), hidden: true });
    const deleted = await synced({ amount: -12.3, date: day('2026-09-07') });
    await db.em().nativeUpdate(Transaction, { transactionKey: deleted.transactionKey }, { deletedAt: new Date() });

    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50', '07-09-2026;07-09-2026;FARMACIA CENTRAL;12,30;;945,20']));

    expect(summary(view).map((row) => [row.status, row.matched])).toEqual([['possible_duplicate', hidden.transactionKey], ['new', null]]);
  });

  it('looks only at the row\'s own account, and only at accounts of the person importing', async () => {
    const ctx = setup();
    const otherAccount = await addAccount(db.em(), household);
    await synced({ account: otherAccount, amount: -42.5, date: day('2026-09-02') });
    const partner = await addPartner(db.em(), household);
    const partnersPrivate = await addAccount(db.em(), household, { isPrivate: true, owner: partner });
    await synced({ account: partnersPrivate, amount: -42.5, date: day('2026-09-02') });
    const other = await seedHousehold(db.em());
    await addTransaction(db.em(), other, { amount: -42.5, date: day('2026-09-02'), status: 'BOOKED' });

    const view = await staged(ctx, statement(['02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50']));
    expect(view.rows.items.map((row) => row.status)).toEqual(['new']);

    // Asked directly for an account that is not the person's, there are no candidates at all.
    const rows = [{ amount: -42.5, date: day('2026-09-02') }];
    expect(await findLikelyDuplicateCandidates(DI.em.fork(), ownerScope(), partnersPrivate.accountKey, rows)).toEqual([]);
    expect(await findLikelyDuplicateCandidates(DI.em.fork(), ownerScope(), other.account.accountKey, rows)).toEqual([]);
    expect(await findLikelyDuplicateCandidates(DI.em.fork(), ownerScope(), otherAccount.accountKey, rows)).toHaveLength(1);
  });

  it('matches each row of a file with several accounts against the account it is mapped to, again when the mapping changes', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'Savings' });
    const card = await addAccount(db.em(), household, { name: 'Credit Card' });
    const onCard = await synced({ account: card, amount: -18.75, date: day('2026-01-21'), merchant: 'Main Street Cafe' });
    const file = ynabFile('web', [
      { account: 'Checking', date: '01/20/2026', outflow: '$18.75', payee: 'Main Street Cafe' },
      { account: 'Credit Card', date: '01/20/2026', outflow: '$18.75', payee: 'Main Street Cafe' },
    ]);

    const view = await staged(ctx, file, { format: 'ynab' });
    expect(view.session.status).toBe('needs_mapping');
    expect(view.rows.items.map((row) => row.status)).toEqual(['new', 'new']);

    const mapped = { 'Checking': household.account.accountKey, 'Credit Card': card.accountKey };
    await ctx.service().setAccountMapping(ownerScope(), view.session.id, mapped);
    const afterMapping = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(summary(afterMapping)).toEqual([
      { decision: 'import', matched: null, reason: null, status: 'new' },
      { decision: 'skip', matched: onCard.transactionKey, reason: 'likely', status: 'possible_duplicate' },
    ]);

    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { 'Credit Card': savings.accountKey });
    const remapped = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(remapped.rows.items.map((row) => row.status)).toEqual(['new', 'new']);
  });
});
