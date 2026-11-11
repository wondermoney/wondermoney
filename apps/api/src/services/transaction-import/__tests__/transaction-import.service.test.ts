import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import type { transactionImport } from '@wondermoney/shared';

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import type { StatementMapping } from '@service/account/account-statement-mapping.schema';
import type { Enqueue } from '@service/queue/enqueue';
import { ConflictError, NotFoundError } from '@utils/errors';

import { sweepTransactionImportSessions } from '../transaction-import-sweep';
import { type TransactionImportDeps, TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * A person importing a bank statement in stages: the file is read into rows, the rows are
 * reviewed (new, duplicate, unreadable) and decided, and only the commit writes transactions. The
 * commit writes in chunks, each in its own database transaction, so one that stops part way
 * resumes without writing a row twice. A session is its starter's alone: another household, and
 * their own partner, never reach it.
 */
describe('staged transaction import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  const header = ['Movimentos da conta', '', 'Data mov.;Data valor;Descrição;Débito;Crédito;Saldo'];
  const lines = [
    '02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50',
    '05-09-2026;05-09-2026;SALARIO ACME LDA;;1.500,00;2.457,50',
    '07-09-2026;07-09-2026;FARMACIA CENTRAL;12,30;;2.445,20',
    '09-09-2026;09-09-2026;CAFE BOAVISTA;2,10;;2.443,10',
    '11-09-2026;11-09-2026;LIVRARIA LELLO;25,00;;2.418,10',
  ];
  const statement = (rows: string[]) => [...header, ...rows].join('\r\n');

  function setup(extra: Partial<TransactionImportDeps> = {}) {
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
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue, storage, ...extra });
    /** Run the last job queued, as the worker would, with the job id pg-boss gave it. */
    const runLastJob = (jobId?: string) => {
      const index = sent.length - 1;
      const job = sent[index];
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, jobId ?? `job-${index + 1}`, job.data.mode);
    };
    const upload = (account: Account, text: string) => {
      const key = `account-${account.accountKey}-generic-${objects.size + 1}.csv`;
      objects.set(key, Buffer.from(text, 'latin1'));
      return key;
    };
    return { runLastJob, sent, service, upload };
  }

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function storedTransactions(account: Account = household.account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionMerchantKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, balance: row.balance, date: row.transactionDate?.toISOString().slice(0, 10), merchant: row.transactionMerchantKey?.name }));
  }

  /** Start an import of `text` on the household's account and read it, as the parse job does. */
  async function staged(ctx: ReturnType<typeof setup>, text: string, options?: { mapping?: StatementMapping }) {
    const key = ctx.upload(household.account, text);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'statement', key, ...(options ? { options } : {}) });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, {});
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  it('stores the file as rows and writes no transaction before the commit', async () => {
    const ctx = setup();
    const view = await staged(ctx, statement(lines.slice(0, 2)));

    expect(view.session.status).toBe('ready');
    expect(view.session.counts).toMatchObject({ duplicate: 0, invalid: 0, new: 2 });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, decision: row.decision, status: row.status }))).toEqual([
      { amount: -42.5, decision: 'import', status: 'new' },
      { amount: 1500, decision: 'import', status: 'new' },
    ]);
    expect(await storedTransactions()).toEqual([]);
  });

  it('commits the rows decided import, with the same amounts, merchants and running balances as a one-step import', async () => {
    const ctx = setup();
    const view = await staged(ctx, statement(lines.slice(0, 2)));
    await commitAndRun(ctx, view.session.id);

    // The account held 1000 before; the statement's rows are older, so the balance chain is
    // back-derived from it, as the one-step import does.
    expect(await storedTransactions()).toEqual([
      { amount: -42.5, balance: -500, date: '2026-09-02', merchant: 'CONTINENTE MATOSINHOS' },
      { amount: 1500, balance: 1000, date: '2026-09-05', merchant: 'SALARIO ACME LDA' },
    ]);
    const after = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(after.session.status).toBe('succeeded');
    expect(after.session.counts).toMatchObject({ imported: 2, new: 0 });
  });

  it('marks rows already on the account as duplicates, skipped unless the person includes them', async () => {
    const ctx = setup();
    const first = await staged(ctx, statement(lines.slice(0, 2)));
    await commitAndRun(ctx, first.session.id);

    const second = await staged(ctx, statement(lines.slice(0, 3)));
    expect(second.session.counts).toMatchObject({ duplicate: 2, new: 1 });
    const duplicates = second.rows.items.filter((row) => row.status === 'duplicate');
    expect(duplicates.every((row) => row.decision === 'skip' && row.matchedTransaction !== null)).toBe(true);

    await commitAndRun(ctx, second.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['CONTINENTE MATOSINHOS', 'SALARIO ACME LDA', 'FARMACIA CENTRAL']);
    expect((await ctx.service().get(ownerScope(), second.session.id, {})).session.counts).toMatchObject({ imported: 1, skipped: 2 });
  });

  it('lets the person skip or include rows in bulk, by row or by status', async () => {
    const ctx = setup();
    const view = await staged(ctx, statement(lines));
    const [first, second] = view.rows.items;

    await ctx.service().decide(ownerScope(), view.session.id, { decision: 'skip', status: 'new' });
    await ctx.service().decide(ownerScope(), view.session.id, { decision: 'import', rowIds: [first!.id, second!.id] });
    const decided = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(decided.session.decisions).toEqual({ import: 2, skip: 3 });

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['CONTINENTE MATOSINHOS', 'SALARIO ACME LDA']);
  });

  it('lists a line it cannot read as invalid, with the reason, and never imports it', async () => {
    const ctx = setup();
    // Columns found by name are trusted when at least four lines in five read.
    const view = await staged(ctx, statement([lines[0]!, '31-02-2026;31-02-2026;BROKEN DATE;5,00;;952,50', ...lines.slice(1)]));
    expect(view.session.counts).toMatchObject({ invalid: 1, new: 5 });
    const invalid = view.rows.items.find((row) => row.status === 'invalid');
    expect(invalid).toMatchObject({ decision: null, error: 'Unreadable date', sourceRow: 5 });

    await ctx.service().decide(ownerScope(), view.session.id, { decision: 'import', rowIds: [invalid!.id] });
    await commitAndRun(ctx, view.session.id);
    expect(await storedTransactions()).toHaveLength(5);
    expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.counts).toMatchObject({ imported: 5, invalid: 1 });
  });

  it('reads the file with the columns the person confirmed in the preview', async () => {
    const ctx = setup();
    const view = await staged(ctx, ['c1;c2;c3', '02-09-2026;CONTINENTE MATOSINHOS;-42,50', '05-09-2026;SALARIO ACME LDA;1.500,00'].join('\n'), {
      mapping: { columns: { amount: 2, date: 0, description: 1 }, dateFormat: 'DMY', decimalSeparator: ',', headerRowIndex: 0, invertAmounts: false },
    });

    expect(view.session.status).toBe('ready');
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, date: row.normalized?.date.slice(0, 10), merchant: row.normalized?.merchant }))).toEqual([
      { amount: -42.5, date: '2026-09-02', merchant: 'CONTINENTE MATOSINHOS' },
      { amount: 1500, date: '2026-09-05', merchant: 'SALARIO ACME LDA' },
    ]);
  });

  it('ends the session as failed when the columns cannot be found', async () => {
    const ctx = setup();
    const view = await staged(ctx, ['a;b;c', 'foo;bar;baz'].join('\n'));

    expect(view.session).toMatchObject({ errorCode: 'columns_not_found', status: 'failed' });
    expect(view.session.counts).toMatchObject({ new: 0 });
  });

  it('pages and filters the rows by status', async () => {
    const ctx = setup();
    const view = await staged(ctx, statement(lines));
    const page = await ctx.service().get(ownerScope(), view.session.id, { page: 2, pageSize: 2, status: 'new' });
    expect(page.rows.total).toBe(5);
    expect(page.rows.items.map((row) => row.normalized?.merchant)).toEqual(['FARMACIA CENTRAL', 'CAFE BOAVISTA']);
  });

  describe('a commit that stops part way', () => {
    it('resumes when the job is handed back, writing every row once', async () => {
      let failures = 1;
      const ctx = setup({
        chunkSize: 2,
        onChunk: (index) => {
          if (index === 1 && failures-- > 0) throw new Error('worker stopped');
        },
      });
      const view = await staged(ctx, statement(lines));
      await ctx.service().commit(ownerScope(), view.session.id);

      await expect(ctx.runLastJob()).rejects.toThrow('worker stopped');
      // The first chunk is in; the rest wait.
      expect(await storedTransactions()).toHaveLength(2);
      expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.status).toBe('importing');

      // pg-boss hands the same job back.
      await expect(ctx.runLastJob()).resolves.toBe(true);
      expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['CONTINENTE MATOSINHOS', 'SALARIO ACME LDA', 'FARMACIA CENTRAL', 'CAFE BOAVISTA', 'LIVRARIA LELLO']);
      expect((await storedTransactions()).at(-1)?.balance).toBe(1000);
      expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.status).toBe('succeeded');
    });

    it('can be retried by the person once its job has given up, and finishes without doubles', async () => {
      let failures = 1;
      const ctx = setup({
        chunkSize: 2,
        onChunk: (index) => {
          if (index === 2 && failures-- > 0) throw new Error('worker stopped');
        },
      });
      const view = await staged(ctx, statement(lines));
      await ctx.service().commit(ownerScope(), view.session.id);
      await expect(ctx.runLastJob()).rejects.toThrow('worker stopped');
      // The job has no retries left: its operation ends.
      const operation = await db.em().findOneOrFail(BackgroundOperation, { correlationId: ctx.sent.at(-1)!.data.correlationId });
      await db.em().nativeUpdate(BackgroundOperation, { backgroundOperationKey: operation.backgroundOperationKey }, { finishedAt: new Date(), status: BackgroundOperationStatus.STALE });

      expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.canRetry).toBe(true);
      await commitAndRun(ctx, view.session.id);
      expect(await storedTransactions()).toHaveLength(5);
      expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.counts).toMatchObject({ imported: 5 });
    });

    it('never writes a row twice when the commit is asked for again or its job runs twice', async () => {
      const ctx = setup();
      const view = await staged(ctx, statement(lines.slice(0, 2)));
      await commitAndRun(ctx, view.session.id);

      await expect(ctx.runLastJob()).resolves.toBe(false);
      await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);
      expect(await storedTransactions()).toHaveLength(2);
    });
  });

  describe('a file with several accounts', () => {
    const twoAccounts: transactionImport.ImportAdapter = {
      format: 'statement',
      parse: () => Promise.resolve({
        rows: [
          { normalized: { amount: -10, date: '2026-09-01T00:00:00.000Z', description: 'Groceries', externalId: 'a-1', sourceAccountLabel: 'Checking' }, raw: {}, sourceRow: 2 },
          { normalized: { amount: -20, date: '2026-09-02T00:00:00.000Z', description: 'Fuel', externalId: 'b-1', sourceAccountLabel: 'Card' }, raw: {}, sourceRow: 3 },
        ],
        sourceAccounts: [{ label: 'Checking', rowCount: 1 }, { label: 'Card', rowCount: 1 }],
        warnings: [],
      }),
    };

    it('asks for a mapping before it can be committed, then checks duplicates on the mapped accounts', async () => {
      const ctx = setup({ adapters: { statement: twoAccounts } });
      const card = await addAccount(db.em(), household, { name: 'Card' });
      const synced = await addTransaction(db.em(), household, { account: card, amount: -20, date: new Date('2026-09-02'), status: 'BOOKED' });
      await db.em().nativeUpdate(Transaction, { transactionKey: synced.transactionKey }, { internalTransactionId: 'b-1', nordigenInternalTransactionId: 'b-1' });

      const view = await staged(ctx, 'ignored');
      expect(view.session.status).toBe('needs_mapping');
      expect(view.session.sourceAccounts.map((source) => source.label)).toEqual(['Checking', 'Card']);
      await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);

      await ctx.service().setAccountMapping(ownerScope(), view.session.id, { Card: card.accountKey, Checking: household.account.accountKey });
      const mapped = await ctx.service().get(ownerScope(), view.session.id, {});
      expect(mapped.session.status).toBe('ready');
      expect(mapped.rows.items.map((row) => ({ status: row.status, target: row.targetAccountId }))).toEqual([
        { status: 'new', target: household.account.accountKey },
        { status: 'duplicate', target: card.accountKey },
      ]);
    });

    it('maps only to accounts the person may write to', async () => {
      const ctx = setup({ adapters: { statement: twoAccounts } });
      const other = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);
      const partnersAccount = await addAccount(db.em(), household, { owner: partner });
      const view = await staged(ctx, 'ignored');

      await expect(ctx.service().setAccountMapping(ownerScope(), view.session.id, { Card: other.account.accountKey, Checking: household.account.accountKey })).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service().setAccountMapping(ownerScope(), view.session.id, { Card: partnersAccount.accountKey, Checking: household.account.accountKey })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('who can reach a session', () => {
    it('is the person who started it only: not another household, not their partner', async () => {
      const ctx = setup();
      const view = await staged(ctx, statement(lines.slice(0, 2)));
      const other = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);
      const scopes = [
        { appuserKey: other.appuser.appuserKey, tenantKey: other.tenant.tenantKey },
        { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey },
        // Their own id in the other household's tenant is not theirs either.
        { appuserKey: household.appuser.appuserKey, tenantKey: other.tenant.tenantKey },
      ];
      for (const scope of scopes) {
        await expect(ctx.service().get(scope, view.session.id, {})).rejects.toBeInstanceOf(NotFoundError);
        await expect(ctx.service().decide(scope, view.session.id, { decision: 'skip', status: 'new' })).rejects.toBeInstanceOf(NotFoundError);
        await expect(ctx.service().setAccountMapping(scope, view.session.id, {})).rejects.toBeInstanceOf(NotFoundError);
        await expect(ctx.service().parse(scope, view.session.id, {})).rejects.toBeInstanceOf(NotFoundError);
        await expect(ctx.service().commit(scope, view.session.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(ctx.service().cancel(scope, view.session.id)).rejects.toBeInstanceOf(NotFoundError);
      }
      expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.decisions).toEqual({ import: 2, skip: 0 });
    });

    it('starts only on an account the person owns', async () => {
      const ctx = setup();
      const other = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), household);
      const partnersAccount = await addAccount(db.em(), household, { owner: partner });
      for (const account of [other.account, partnersAccount]) {
        const key = ctx.upload(account, statement(lines));
        await expect(ctx.service().create(ownerScope(), { accountId: account.accountKey, format: 'statement', key })).rejects.toBeInstanceOf(NotFoundError);
      }
    });

    it('reads only a file uploaded for the account it imports into', async () => {
      const ctx = setup();
      const second = await addAccount(db.em(), household);
      const key = ctx.upload(second, statement(lines));
      await expect(ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'statement', key })).rejects.toThrow('Invalid file key');
    });
  });

  it('cancels a session that is waiting for the person, and it can no longer be committed', async () => {
    const ctx = setup();
    const view = await staged(ctx, statement(lines.slice(0, 2)));
    await ctx.service().cancel(ownerScope(), view.session.id);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await ctx.service().get(ownerScope(), view.session.id, {})).session.status).toBe('cancelled');
    expect(await storedTransactions()).toEqual([]);
  });

  it('runs the one-step import through a session, reporting the counts the import dialogs read', async () => {
    const ctx = setup();
    const key = ctx.upload(household.account, statement(lines.slice(0, 2)));
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, autoCommit: true, format: 'statement', key });
    await expect(ctx.runLastJob()).resolves.toBe(true);

    expect(await storedTransactions()).toHaveLength(2);
    const operation = await db.em().findOneOrFail(BackgroundOperation, { correlationId: created.correlationId! });
    expect(operation.status).toBe(BackgroundOperationStatus.SUCCEEDED);
    expect(operation.progress).toMatchObject({ failed: 0, imported: 2, skipped: 0, totalRows: 2 });
  });

  it('keeps a committed import\'s summary once the daily sweep has deleted its rows, and a later import does not remove it', async () => {
    let clock = new Date('2026-09-20T10:00:00Z');
    const ctx = setup({ now: () => clock });
    const view = await staged(ctx, statement(lines.slice(0, 3)));
    await ctx.service().decide(ownerScope(), view.session.id, { decision: 'skip', rowIds: view.rows.items.slice(0, 1).map((row) => row.id) });
    await commitAndRun(ctx, view.session.id);
    const committed = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(committed.session).toMatchObject({ committedAt: clock.toISOString(), detailsDeletedAt: null, status: 'succeeded' });

    // Eight days on, the person starts another import, and the sweep runs.
    clock = new Date(clock.getTime() + 8 * 24 * 60 * 60 * 1000);
    await staged(ctx, statement(lines.slice(3)));
    expect((await ctx.service().get(ownerScope(), view.session.id, {})).rows.total).toBe(3);
    await sweepTransactionImportSessions({ em: db.em(), now: clock, storage: { deleteObject: () => Promise.resolve() } });

    const after = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(after.session).toMatchObject({ committedAt: committed.session.committedAt, createdAt: committed.session.createdAt, detailsDeletedAt: clock.toISOString(), status: 'succeeded' });
    expect(after.session.counts).toEqual(committed.session.counts);
    expect(after.session.counts).toMatchObject({ imported: 2, skipped: 1 });
    expect(after.rows).toMatchObject({ items: [], total: 0 });
    expect(await storedTransactions()).toHaveLength(2);
  });

  it('does not start on a deleted account', async () => {
    const ctx = setup();
    const em = db.em();
    const account = await em.findOneOrFail(Account, { accountKey: household.account.accountKey });
    account.deletedAt = new Date();
    await em.flush();
    const key = ctx.upload(household.account, statement(lines));
    await expect(ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'statement', key })).rejects.toBeInstanceOf(NotFoundError);
  });
});
