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
import { ConflictError } from '@utils/errors';

import { TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * QIF imports through the staged session: the file is read by the QIF adapter, a QIF has no
 * transaction id so every row dedups through its date+amount fingerprint, a file whose dates are
 * all ambiguous asks for the order and is read again with it, a split record imports as one
 * transaction, a file with two `!Account` blocks asks for a mapping, and an `L[Account]` category
 * reaches transfer matching as the transfer the file says it is.
 */
describe('staged QIF import', () => {
  const db = useTestDatabase();
  let household: Household;
  let types: Record<'DEPOSIT' | 'PAYMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT', TransactionType>;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    const created = (['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT'] as const).map((name) => em.create(TransactionType, { displayName: name, name }, { partial: true }));
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
      presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-qif-upload.csv`, presignedUrl: 'https://files.example.test/upload' }),
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
      const key = `account-${account.accountKey}-qif-${objects.size + 1}.csv`;
      objects.set(key, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
      return key;
    };
    return { runLastJob, sent, service, upload };
  }

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function storedTransactions(account: Account = household.account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' }, populate: ['transactionMerchantKey', 'transactionTypeKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, date: row.transactionDate?.toISOString().slice(0, 10), description: row.descriptionDirty ?? row.description ?? '', merchant: row.transactionMerchantKey?.name, type: row.transactionTypeKey?.name }));
  }

  async function staged(ctx: ReturnType<typeof setup>, content: Buffer | string, format: 'qif' | 'statement' = 'qif') {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format, key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, {});
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  const bankFile = () =>
    [
      '!Type:Bank',
      'D15/01/2026',
      'T-42.50',
      'PCONTINENTE',
      'MGroceries',
      'LFood:Groceries',
      '^',
      'D31/01/2026',
      'T1500.00',
      'PSALARIO',
      '^',
    ].join('\n');

  it('stores each row with the sign the file states', async () => {
    const ctx = setup();
    const view = await staged(ctx, bankFile());

    expect(view.session.format).toBe('qif');
    expect(view.session.counts).toMatchObject({ duplicate: 0, invalid: 0, new: 2 });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, date: row.normalized?.date.slice(0, 10) }))).toEqual([
      { amount: -42.5, date: '2026-01-15' },
      { amount: 1500, date: '2026-01-31' },
    ]);
    expect(view.rows.items[0]?.normalized?.categoryLabel).toBe('Food:Groceries');

    await commitAndRun(ctx, view.session.id);
    expect(await storedTransactions()).toEqual([
      { amount: -42.5, date: '2026-01-15', description: 'Groceries', merchant: 'CONTINENTE', type: 'PAYMENT' },
      { amount: 1500, date: '2026-01-31', description: 'SALARIO', merchant: 'SALARIO', type: 'DEPOSIT' },
    ]);
  });

  it('marks every row of a re-imported file as a duplicate through its fingerprint', async () => {
    const ctx = setup();

    const first = await staged(ctx, bankFile());
    expect(first.session.counts).toMatchObject({ new: 2 });
    await commitAndRun(ctx, first.session.id);
    expect(await storedTransactions()).toHaveLength(2);

    const second = await staged(ctx, bankFile());
    expect(second.session.counts).toMatchObject({ duplicate: 2, new: 0 });
    expect(second.rows.items.every((row) => row.decision === 'skip' && row.matchedTransaction !== null)).toBe(true);
  });

  it('asks for the date order when every date is ambiguous, and reads again with the choice', async () => {
    const ctx = setup();
    const file = ['!Type:Bank', 'D01/02/2026', 'T-10.00', 'PCOFFEE', '^', 'D03/04/2026', 'T-20.00', 'PBAKERY', '^'].join('\n');

    const view = await staged(ctx, file);
    expect(view.session.warnings).toContainEqual(expect.objectContaining({ code: 'date_order_ambiguous' }));
    expect(view.rows.items.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-02-01', '2026-04-03']);

    await ctx.service().parse(ownerScope(), view.session.id, { options: { dateOrder: 'month-first' } });
    await ctx.runLastJob();

    const reread = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(reread.session.warnings).toEqual([]);
    expect(reread.rows.items.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-02', '2026-03-04']);
  });

  it('does not ask for the date order when a day above 12 settles it', async () => {
    const ctx = setup();

    const view = await staged(ctx, bankFile());

    expect(view.session.warnings).toEqual([]);
  });

  it('imports a split record as one transaction with the record total', async () => {
    const ctx = setup();
    const file = [
      '!Type:Bank',
      'D25/01/2026',
      'T-42.40',
      'PSUPERMERCADO',
      'MWeekly shop',
      'SFood:Groceries',
      'EGroceries',
      '$-30.00',
      'SHousehold',
      'ECleaning',
      '$-12.40',
      '^',
    ].join('\n');

    const view = await staged(ctx, file);
    expect(view.session.counts).toMatchObject({ new: 1 });

    await commitAndRun(ctx, view.session.id);
    expect(await storedTransactions()).toEqual([
      { amount: -42.4, date: '2026-01-25', description: 'Weekly shop — Split: Food:Groceries -30.00; Household -12.40', merchant: 'SUPERMERCADO', type: 'PAYMENT' },
    ]);
  });

  it('asks for an account mapping when the file holds two accounts, then imports each into its own', async () => {
    const ctx = setup();
    const card = await addAccount(db.em(), household, { name: 'Card' });
    const file = [
      '!Account',
      'NChecking',
      'TBank',
      '^',
      '!Type:Bank',
      'D15/01/2026',
      'T-11.00',
      'PSUPERMERCADO',
      '^',
      'D20/01/2026',
      'T800.00',
      'PEMPREGADOR',
      '^',
      '!Account',
      'NCard',
      'TCCard',
      '^',
      '!Type:CCard',
      'D21/01/2026',
      'T-23.40',
      'PRESTAURANTE',
      '^',
    ].join('\n');

    const view = await staged(ctx, file);
    expect(view.session.status).toBe('needs_mapping');
    expect(view.session.sourceAccounts.map((source) => source.label)).toEqual(['Checking', 'Card']);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);

    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Card: card.accountKey, Checking: household.account.accountKey });
    const mapped = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(mapped.session.status).toBe('ready');
    expect(mapped.rows.items.map((row) => row.targetAccountId)).toEqual([household.account.accountKey, household.account.accountKey, card.accountKey]);

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['SUPERMERCADO', 'EMPREGADOR']);
    expect((await storedTransactions(card)).map((row) => ({ amount: row.amount, merchant: row.merchant }))).toEqual([{ amount: -23.4, merchant: 'RESTAURANTE' }]);
  });

  it('keeps the transfer an L[Account] category states, and pairs it with the credit on another account', async () => {
    const ctx = setup();
    const savings = await addAccount(db.em(), household, { name: 'Savings' });
    await addTransaction(db.em(), household, { account: savings, amount: 400, date: new Date(Date.UTC(2026, 0, 16, 12)), enableBankingTransactionId: 'eb-4', status: 'BOOKED', type: types.DEPOSIT });
    const file = ['!Type:Bank', 'D15/01/2026', 'T-400.00', 'PTransfer to savings', 'L[Savings]', '^'].join('\n');

    const view = await staged(ctx, file);
    expect(view.rows.items[0]?.normalized?.transferAccountLabel).toBe('Savings');

    await commitAndRun(ctx, view.session.id);

    expect((await storedTransactions()).map((row) => ({ amount: row.amount, type: row.type }))).toEqual([{ amount: -400, type: 'TRANSFER_OUT' }]);
    expect((await storedTransactions(savings)).map((row) => row.type)).toEqual(['TRANSFER_IN']);
  });

  it('reads a QIF file uploaded as a statement with the QIF adapter, by its content', async () => {
    const ctx = setup();

    const view = await staged(ctx, bankFile(), 'statement');

    expect(view.session.format).toBe('qif');
    expect(view.session.counts).toMatchObject({ new: 2 });
  });
});
