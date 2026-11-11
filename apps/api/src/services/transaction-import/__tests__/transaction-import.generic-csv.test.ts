import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import type { Enqueue } from '@service/queue/enqueue';

import { TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * The older WonderMoney CSV template through the staged session. The expected rows, amounts and
 * dates below were captured from the one-step import (`AccountCsvImportService`) on the same
 * files before it was removed: the session path must store the same transactions.
 *
 * The template's `transactionTypeKey` is the file's word for the type, so it decides the direction
 * (a payment's amount is a magnitude, however the file signs it) and transfer matching must not
 * re-type the row.
 */
describe('staged generic CSV import', () => {
  const db = useTestDatabase();
  let household: Household;
  let types: Record<'CARD_PAYMENT' | 'DEPOSIT' | 'EXCHANGE' | 'FEE' | 'PAYMENT' | 'REVERT' | 'TRANSFER_IN' | 'TRANSFER_OUT', TransactionType>;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    const created = (['CARD_PAYMENT', 'DEPOSIT', 'EXCHANGE', 'FEE', 'PAYMENT', 'REVERT', 'TRANSFER_IN', 'TRANSFER_OUT'] as const).map((name) => em.create(TransactionType, { displayName: name, name }, { partial: true }));
    await em.flush();
    types = Object.fromEntries(created.map((type) => [type.name, type])) as typeof types;
  });

  function setup() {
    const objects = new Map<string, Buffer>();
    const storage: TransactionImportStorage = {
      getAccountCsvBucketName: () => 'csv',
      getObjectBuffer: (_bucket, key) => {
        const object = objects.get(key);
        return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
      },
      getObjectSize: (_bucket, key) => Promise.resolve(objects.get(key)?.length),
      presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-generic-upload.csv`, presignedUrl: 'https://files.example.test/upload' }),
    };
    const sent: { data: { correlationId: string; mode: 'commit' | 'parse' }; queue: string }[] = [];
    const enqueue: Enqueue = {
      send: (queue, data) => {
        sent.push({ data: data as (typeof sent)[number]['data'], queue });
        return Promise.resolve(`job-${sent.length}`);
      },
      sendAfter: () => Promise.resolve(null),
    };
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue, storage });
    const runLastJob = () => {
      const index = sent.length - 1;
      const job = sent[index];
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, `job-${index + 1}`, job.data.mode);
    };
    const upload = (account: Account, content: Buffer | string) => {
      const key = `account-${account.accountKey}-generic-${objects.size + 1}.csv`;
      objects.set(key, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
      return key;
    };
    return { runLastJob, sent, service, upload };
  }

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function storedTransactions(account: Account = household.account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' }, populate: ['transactionMerchantKey', 'transactionTypeKey', 'settlementCurrencyKey'] });
    return rows.map((row) => ({
      amount: row.settlementAmount,
      currency: row.settlementCurrencyKey?.code,
      date: row.transactionDate?.toISOString().slice(0, 10),
      description: row.descriptionDirty ?? row.description ?? '',
      merchant: row.transactionMerchantKey?.name,
      type: row.transactionTypeKey?.name,
    }));
  }

  async function staged(ctx: ReturnType<typeof setup>, content: Buffer | string, format: 'generic-csv' | 'statement' = 'generic-csv') {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format, key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, {});
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  /** The template mobile builds, with the instance's own type keys. */
  const template = () =>
    [
      '\uFEFFdate,amount,merchant,internalTransactionId,transactionTypeKey,description',
      `2026-01-15,23.40,Grocery store,example-1,${types.PAYMENT.transactionTypeKey},Weekly shop`,
      `2026-01-31,1500.00,Employer,example-2,${types.DEPOSIT.transactionTypeKey},Salary`,
      `2026-02-03,12.00,Coffee shop,example-3,${types.PAYMENT.transactionTypeKey},`,
    ].join('\n');

  it('stores the same rows, amounts, dates and types the one-step import stored', async () => {
    const ctx = setup();
    const view = await staged(ctx, template());

    expect(view.session.format).toBe('generic-csv');
    expect(view.session.counts).toMatchObject({ duplicate: 0, invalid: 0, new: 3 });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, date: row.normalized?.date.slice(0, 10), status: row.status }))).toEqual([
      { amount: -23.4, date: '2026-01-15', status: 'new' },
      { amount: 1500, date: '2026-01-31', status: 'new' },
      { amount: -12, date: '2026-02-03', status: 'new' },
    ]);

    await commitAndRun(ctx, view.session.id);

    expect(await storedTransactions()).toEqual([
      { amount: -23.4, currency: 'EUR', date: '2026-01-15', description: 'Weekly shop', merchant: 'Grocery store', type: 'PAYMENT' },
      { amount: 1500, currency: 'EUR', date: '2026-01-31', description: 'Salary', merchant: 'Employer', type: 'DEPOSIT' },
      { amount: -12, currency: 'EUR', date: '2026-02-03', description: '', merchant: 'Coffee shop', type: 'PAYMENT' },
    ]);
  });

  it('reads the date formats, the currency column and the quoted fields the one-step import read', async () => {
    const ctx = setup();
    const file = [
      'date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey',
      `01/15/2026,-10.50,,Shop,Desc,int-1,${types.PAYMENT.transactionTypeKey}`,
      `2026-02-01,42,${household.currency.currencyKey},"Café, Lda.","Lunch, with friends",int-2,${types.DEPOSIT.transactionTypeKey}`,
      `2026-03-05,7.25,,Bakery,,int-3,${types.FEE.transactionTypeKey}`,
    ].join('\n');

    const view = await staged(ctx, file);
    await commitAndRun(ctx, view.session.id);

    expect(await storedTransactions()).toEqual([
      { amount: -10.5, currency: 'EUR', date: '2026-01-15', description: 'Desc', merchant: 'Shop', type: 'PAYMENT' },
      { amount: 42, currency: 'EUR', date: '2026-02-01', description: 'Lunch, with friends', merchant: 'Café, Lda.', type: 'DEPOSIT' },
      { amount: -7.25, currency: 'EUR', date: '2026-03-05', description: '', merchant: 'Bakery', type: 'FEE' },
    ]);
  });

  it('lists each unreadable row as invalid with the reason, and imports the readable ones', async () => {
    const ctx = setup();
    const file = [
      'date,amount,merchant,internalTransactionId,transactionTypeKey,description',
      `2026-03-01,10,Good,ok-1,${types.PAYMENT.transactionTypeKey},`,
      'not-a-date,3,Bad,bad-1,3,',
      `2026-03-06,abc,Bad,bad-2,${types.PAYMENT.transactionTypeKey},`,
      '2026-03-07,3,Bad,bad-3,999999,',
      `2026-03-08,3,,bad-4,${types.PAYMENT.transactionTypeKey},`,
      '2026-03-09,3,Bad,bad-5,3abc,',
    ].join('\n');

    const view = await staged(ctx, file);

    expect(view.session.counts).toMatchObject({ invalid: 5, new: 1 });
    expect(view.rows.items.filter((row) => row.status === 'invalid').map((row) => ({ error: row.error, sourceRow: row.sourceRow }))).toEqual([
      { error: 'Unreadable date', sourceRow: 3 },
      { error: 'Unreadable amount', sourceRow: 4 },
      { error: 'Unknown transaction type: 999999', sourceRow: 5 },
      { error: 'Missing merchant', sourceRow: 6 },
      { error: 'Invalid transaction type', sourceRow: 7 },
    ]);

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['Good']);
  });

  it('marks a re-imported file as duplicates, including a repeated id inside the file', async () => {
    const ctx = setup();
    const file = [
      'date,amount,merchant,internalTransactionId,transactionTypeKey,description',
      `2026-01-15,23.40,Grocery store,same-1,${types.PAYMENT.transactionTypeKey},Weekly shop`,
      `2026-01-15,23.40,Grocery store,same-1,${types.PAYMENT.transactionTypeKey},Weekly shop again`,
    ].join('\n');

    const first = await staged(ctx, file);
    expect(first.session.counts).toMatchObject({ duplicate: 1, new: 1 });
    await commitAndRun(ctx, first.session.id);
    expect((await storedTransactions()).map((row) => row.description)).toEqual(['Weekly shop']);

    const second = await staged(ctx, file);
    expect(second.session.counts).toMatchObject({ duplicate: 2, new: 0 });
    expect(second.rows.items.every((row) => row.decision === 'skip')).toBe(true);
  });

  it('signs each row by its type, and keeps the file sign for a type with no direction', async () => {
    const ctx = setup();
    const file = [
      'date,amount,merchant,internalTransactionId,transactionTypeKey,description',
      `2026-09-01,-42.50,Card,cp-1,${types.CARD_PAYMENT.transactionTypeKey},`,
      `2026-09-02,42.50,Card,cp-2,${types.CARD_PAYMENT.transactionTypeKey},`,
      `2026-09-03,-100,Bank,dep-1,${types.DEPOSIT.transactionTypeKey},`,
      `2026-09-04,100,Bank,dep-2,${types.DEPOSIT.transactionTypeKey},`,
      `2026-09-05,-50,Mix,ex-1,${types.EXCHANGE.transactionTypeKey},`,
      `2026-09-06,75,Mix,ex-2,${types.EXCHANGE.transactionTypeKey},`,
      `2026-09-07,-12.30,Back,rev-1,${types.REVERT.transactionTypeKey},`,
    ].join('\n');

    const view = await staged(ctx, file);
    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions()).map((row) => ({ amount: row.amount, type: row.type }))).toEqual([
      { amount: -42.5, type: 'CARD_PAYMENT' },
      { amount: -42.5, type: 'CARD_PAYMENT' },
      { amount: 100, type: 'DEPOSIT' },
      { amount: 100, type: 'DEPOSIT' },
      { amount: -50, type: 'EXCHANGE' },
      { amount: 75, type: 'EXCHANGE' },
      { amount: -12.3, type: 'REVERT' },
    ]);

    // The session treats the account's stored balance as truth and back-derives the opening
    // balance, so the chain ends where it started; the signed rows are what move it.
    const account = await db.em().findOneOrFail(Account, { accountKey: household.account.accountKey });
    expect(account.balance).toBe(1000);
    expect(account.openingBalance).toBeCloseTo(1000 - 127.7, 2);
  });

  it('keeps the type the file states through transfer matching', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'Savings' });
    const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12));
    await addTransaction(db.em(), household, { account: savings, amount: -2000, date: day(1), enableBankingTransactionId: 'eb-2', status: 'BOOKED', type: types.PAYMENT });

    const view = await staged(ctx, ['date,amount,merchant,internalTransactionId,transactionTypeKey,description', `2026-09-01,2000,Transfer in,dep-1,${types.DEPOSIT.transactionTypeKey},`].join('\n'));
    await commitAndRun(ctx, view.session.id);

    // The file said DEPOSIT, so the matching debit on the other account does not turn it into a transfer.
    expect((await storedTransactions()).map((row) => ({ amount: row.amount, type: row.type }))).toEqual([{ amount: 2000, type: 'DEPOSIT' }]);
    expect((await storedTransactions(savings)).map((row) => row.type)).toEqual(['PAYMENT']);
  });

  it('pairs a row the file types as a transfer out with the credit on another household account', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'Savings' });
    await addTransaction(db.em(), household, { account: savings, amount: 400, date: new Date(Date.UTC(2026, 8, 2, 12)), enableBankingTransactionId: 'eb-3', status: 'BOOKED', type: types.DEPOSIT });

    const view = await staged(ctx, ['date,amount,merchant,internalTransactionId,transactionTypeKey,description', `2026-09-01,400,Transfer out,tr-1,${types.TRANSFER_OUT.transactionTypeKey},`].join('\n'));
    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions()).map((row) => ({ amount: row.amount, type: row.type }))).toEqual([{ amount: -400, type: 'TRANSFER_OUT' }]);
    expect((await storedTransactions(savings)).map((row) => row.type)).toEqual(['TRANSFER_IN']);
  });

  it('reads a template uploaded as a statement with the generic adapter, by its content', async () => {
    const ctx = setup();
    const view = await staged(ctx, template(), 'statement');

    expect(view.session.format).toBe('generic-csv');
    expect(view.session.counts).toMatchObject({ new: 3 });
  });
});
