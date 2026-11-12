import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addMerchant, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import type { Enqueue } from '@service/queue/enqueue';
import { BadRequestError, ConflictError, ERROR_CODE } from '@utils/errors';

import { syntheticPdf } from '../pdf-statement/__tests__/synthetic-pdf';
import type { ReadStatementPage } from '../pdf-statement/pdf-statement-reader';
import { type TransactionImportDeps, TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * A PDF bank statement through the staged session: uploaded, rendered page by page and read by a
 * (mocked) vision model into staged rows; nothing posts until the person commits; a statement whose
 * balances do not add up needs the difference acknowledged; the PDF is deleted however the read
 * ends; and its rows dedup like any other file's. No network: the model is a function.
 */
describe('staged PDF statement import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  const uploadKey = (session: { upload: null | { key: string } }) => {
    if (!session.upload) throw new Error('no upload link');
    return session.upload.key;
  };

  /** The statement the tests upload: two pages, opening at 1,000.00 and closing at 2,454.30. */
  const STATEMENT = syntheticPdf([
    ['Example Bank - Statement 1 Sep 2026 to 30 Sep 2026', 'Opening balance 1,000.00', '02 Sep GROCERY STORE -42.50'],
    ['05 Sep SALARY 1,500.00', '07 Sep BAKERY -3.20', 'Closing balance 2,454.30'],
  ]);
  const ROWS = {
    1: [{ amount: -42.5, balance: 957.5, currency: null, date: '2026-09-02', description: 'GROCERY STORE' }],
    2: [{ amount: 1500, balance: 2457.5, currency: null, date: '2026-09-05', description: 'SALARY' }, { amount: -3.2, balance: 2454.3, currency: null, date: '2026-09-07', description: 'BAKERY' }],
  };

  /** A model that reads the statement above; `closingBalance` changes what page 2 says it ends on. */
  const modelFor = (options: { closingBalance?: number } = {}): ReadStatementPage => ({ pageNumber }) => Promise.resolve(pageNumber === 1
    ? { closingBalance: null, currency: 'EUR', openingBalance: 1000, rows: ROWS[1] }
    : { closingBalance: options.closingBalance ?? 2454.3, currency: 'EUR', openingBalance: null, rows: ROWS[2] });

  function setup(extra: Partial<TransactionImportDeps> & { limits?: { maxBytes: number; maxPages: number }; readPage?: ReadStatementPage } = {}) {
    const objects = new Map<string, Buffer>();
    const deleted: string[] = [];
    const presigned: { accountKey: number; contentLength: number }[] = [];
    const storage: TransactionImportStorage = {
      deleteObject: (_bucket, key) => {
        deleted.push(key);
        objects.delete(key);
        return Promise.resolve();
      },
      getAccountCsvBucketName: () => 'csv',
      getObjectBuffer: (_bucket, key) => {
        const object = objects.get(key);
        return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
      },
      getObjectSize: (_bucket, key) => Promise.resolve(objects.get(key)?.length),
      presignAccountPdfUpload: (accountKey, contentLength) => {
        presigned.push({ accountKey, contentLength });
        return Promise.resolve({ key: `account-${accountKey}-statement-${presigned.length}.pdf`, presignedUrl: 'https://files.example.test/upload' });
      },
      presignAccountUpload: () => Promise.reject(new Error('not used')),
    };
    const sent: { data: { correlationId: string; mode: 'commit' | 'parse' } }[] = [];
    const enqueue: Enqueue = {
      send: (_queue, data) => {
        sent.push({ data: data as (typeof sent)[number]['data'] });
        return Promise.resolve(`job-${sent.length}`);
      },
      sendAfter: () => Promise.resolve(null),
    };
    const { limits, readPage, ...deps } = extra;
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue, pdfStatement: { limits, readPage: readPage ?? modelFor(), sleep: () => Promise.resolve() }, storage, ...deps });
    const runLastJob = () => {
      const job = sent.at(-1);
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, `job-${sent.length}`, job.data.mode);
    };
    /** Start a PDF import, upload `pdf` to its link, and read it. */
    const importPdf = async (pdf: Buffer = STATEMENT, uploaded: Buffer = pdf) => {
      const created = await service().createPdf(ownerScope(), { accountId: household.account.accountKey, contentLength: pdf.length, fileName: 'September.pdf' });
      objects.set(uploadKey(created), uploaded);
      await service().parse(ownerScope(), created.id, {});
      await runLastJob();
      return { created, view: await service().get(ownerScope(), created.id, { pageSize: 200 }) };
    };
    const commitAndRun = async (id: string, input: { acknowledgeMismatch?: boolean } = {}) => {
      await service().commit(ownerScope(), id, input);
      return runLastJob();
    };
    return { commitAndRun, deleted, importPdf, objects, presigned, runLastJob, sent, service };
  }

  const stored = async () => (await db.em().find(Transaction, { accountKey: household.account, deletedAt: null }, { filters: false, orderBy: { transactionDate: 'ASC' } })).map((row) => ({ amount: row.settlementAmount, date: row.transactionDate?.toISOString().slice(0, 10) }));

  it('reads a statement into staged rows that match it, and posts nothing until the person commits', async () => {
    const ctx = setup();
    const { created, view } = await ctx.importPdf();

    expect(created.status).toBe('waiting_for_upload');
    expect(ctx.presigned).toEqual([{ accountKey: household.account.accountKey, contentLength: STATEMENT.length }]);
    expect(view.session).toMatchObject({ canCommit: true, counts: { new: 3 }, fileName: 'September.pdf', format: 'pdf', status: 'ready' });
    expect(view.session.statementExtraction).toEqual({
      pageCount: 2,
      pagesRead: 2,
      reconciliation: { closingBalance: 2454.3, currency: 'EUR', difference: 0, openingBalance: 1000, rowsTotal: 1454.3, status: 'matched' },
    });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, date: row.normalized?.date.slice(0, 10), decision: row.decision, description: row.normalized?.description, status: row.status }))).toEqual([
      { amount: -42.5, date: '2026-09-02', decision: 'import', description: 'GROCERY STORE', status: 'new' },
      { amount: 1500, date: '2026-09-05', decision: 'import', description: 'SALARY', status: 'new' },
      { amount: -3.2, date: '2026-09-07', decision: 'import', description: 'BAKERY', status: 'new' },
    ]);
    // Staged, not posted.
    expect(await stored()).toEqual([]);

    await ctx.commitAndRun(view.session.id);
    expect(await stored()).toEqual([{ amount: -42.5, date: '2026-09-02' }, { amount: 1500, date: '2026-09-05' }, { amount: -3.2, date: '2026-09-07' }]);
    expect((await ctx.service().get(ownerScope(), view.session.id, {})).session).toMatchObject({ counts: { imported: 3 }, status: 'succeeded' });
  });

  it('deletes the PDF once it is read, and it cannot be read again', async () => {
    const ctx = setup();
    const { created, view } = await ctx.importPdf();
    expect(ctx.deleted).toEqual([uploadKey(created)]);
    expect(ctx.objects.size).toBe(0);
    await expect(ctx.service().parse(ownerScope(), view.session.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it('shows a statement whose balances do not add up, with the difference, and commits it only once acknowledged', async () => {
    // The statement says it ends 25.00 lower than the rows the model found: a row is missing.
    const ctx = setup({ readPage: modelFor({ closingBalance: 2429.3 }) });
    const { view } = await ctx.importPdf();
    expect(view.session.statementExtraction?.reconciliation).toMatchObject({ difference: -25, status: 'mismatch' });
    expect(view.session.canCommit).toBe(true);

    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toMatchObject({ code: ERROR_CODE.STATEMENT_RECONCILIATION_UNACKNOWLEDGED });
    await expect(ctx.service().commit(ownerScope(), view.session.id, { acknowledgeMismatch: false })).rejects.toBeInstanceOf(ConflictError);
    expect(await stored()).toEqual([]);

    await ctx.commitAndRun(view.session.id, { acknowledgeMismatch: true });
    expect(await stored()).toHaveLength(3);
  });

  it('commits a statement that prints no balances without asking, since there is nothing to check', async () => {
    const ctx = setup({ readPage: ({ pageNumber }) => Promise.resolve({ closingBalance: null, currency: null, openingBalance: null, rows: ROWS[pageNumber as 1 | 2] }) });
    const { view } = await ctx.importPdf();
    expect(view.session.statementExtraction?.reconciliation).toMatchObject({ difference: null, status: 'unavailable' });
    await ctx.commitAndRun(view.session.id);
    expect(await stored()).toHaveLength(3);
  });

  describe('limits', () => {
    it('refuses a PDF over the size limit before handing out an upload link, at the default and at the operator override', async () => {
      const ctx = setup();
      const tooBig = { accountId: household.account.accountKey, contentLength: 10 * 1024 * 1024 + 1 };
      await expect(ctx.service().createPdf(ownerScope(), tooBig)).rejects.toMatchObject({ code: ERROR_CODE.STATEMENT_TOO_LARGE });
      await expect(ctx.service().createPdf(ownerScope(), { ...tooBig, contentLength: 10 * 1024 * 1024 })).resolves.toMatchObject({ status: 'waiting_for_upload' });

      vi.stubEnv('STATEMENT_IMPORT_MAX_BYTES', String(STATEMENT.length - 1));
      await expect(ctx.service().createPdf(ownerScope(), { accountId: household.account.accountKey, contentLength: STATEMENT.length })).rejects.toBeInstanceOf(BadRequestError);
      expect(ctx.presigned).toHaveLength(1);
    });

    it('fails a statement that turns out larger than the limit when it is read, and deletes it', async () => {
      const readPage = vi.fn(modelFor());
      const ctx = setup({ limits: { maxBytes: STATEMENT.length, maxPages: 20 }, readPage });
      const { created, view } = await ctx.importPdf(STATEMENT, Buffer.concat([STATEMENT, Buffer.alloc(10)]));
      expect(view.session).toMatchObject({ errorCode: 'too_large', status: 'failed' });
      expect(readPage).not.toHaveBeenCalled();
      expect(ctx.deleted).toEqual([uploadKey(created)]);
    });

    it('fails a statement over the page limit without sending a page, at the operator override', async () => {
      vi.stubEnv('STATEMENT_IMPORT_MAX_PAGES', '1');
      const readPage = vi.fn(modelFor());
      const ctx = setup({ readPage });
      const { created, view } = await ctx.importPdf();
      expect(view.session).toMatchObject({ errorCode: 'too_many_pages', status: 'failed' });
      expect(readPage).not.toHaveBeenCalled();
      expect(ctx.deleted).toEqual([uploadKey(created)]);
    });
  });

  it('deletes the PDF when the model cannot read a page, after a capped number of attempts', async () => {
    const readPage = vi.fn<ReadStatementPage>(() => Promise.reject(new Error('Model request failed with status 500')));
    const ctx = setup({ readPage });
    const { created, view } = await ctx.importPdf();
    expect(view.session).toMatchObject({ errorCode: 'extraction_failed', status: 'failed' });
    expect(readPage).toHaveBeenCalledTimes(3);
    expect(ctx.deleted).toEqual([uploadKey(created)]);
    expect(view.rows.total).toBe(0);
  });

  it('deletes a file that is not a PDF at all', async () => {
    const ctx = setup();
    const notPdf = Buffer.from('date,amount\n2026-09-01,-1\n');
    const { created, view } = await ctx.importPdf(notPdf);
    expect(view.session).toMatchObject({ errorCode: 'unreadable', status: 'failed' });
    expect(ctx.deleted).toEqual([uploadKey(created)]);
  });

  it('records each page read, and stops after the page it is on when the person cancels', async () => {
    const progress: (null | number)[] = [];
    let sessionId = '';
    let cancel: () => Promise<unknown> = () => Promise.resolve();
    const readPage: ReadStatementPage = async (input) => {
      const view = await new TransactionImportService(DI.em.fork(), {}).get(ownerScope(), sessionId, {});
      progress.push(view.session.statementExtraction?.pagesRead ?? null);
      if (input.pageNumber === 1) await cancel();
      return modelFor()(input);
    };
    const ctx = setup({ readPage });
    const created = await ctx.service().createPdf(ownerScope(), { accountId: household.account.accountKey, contentLength: STATEMENT.length });
    sessionId = created.id;
    ctx.objects.set(uploadKey(created), STATEMENT);
    await ctx.service().parse(ownerScope(), created.id, {});
    // While the job reads page 1, the session is cancellable.
    cancel = () => ctx.service().cancel(ownerScope(), created.id);
    await ctx.runLastJob();

    expect(progress).toEqual([0]);
    const view = await ctx.service().get(ownerScope(), created.id, {});
    expect(view.session.status).toBe('cancelled');
    expect(view.rows.total).toBe(0);
    expect(ctx.objects.size).toBe(0);
    expect(await stored()).toEqual([]);
  });

  describe('duplicates', () => {
    it('marks every row of the same statement read again as already imported', async () => {
      const ctx = setup();
      const first = await ctx.importPdf();
      await ctx.commitAndRun(first.view.session.id);

      // The model words the rows differently the second time; the date and amount still match.
      const second = await setup({ readPage: async (input) => {
        const page = (await modelFor()(input)) as { rows: { description: string }[] };
        return { ...page, rows: page.rows.map((row) => ({ ...row, description: `${row.description} REF 1234` })) };
      } }).importPdf();
      expect(second.view.session.counts).toMatchObject({ duplicate: 3, new: 0 });
      expect(second.view.rows.items.every((row) => row.decision === 'skip' && row.matchedTransaction !== null)).toBe(true);
    });

    it('flags a row the bank already synced a day earlier as a possible duplicate', async () => {
      const merchant = await addMerchant(db.em(), household, 'Grocery Store');
      const synced = await addTransaction(db.em(), household, { amount: -42.5, date: new Date('2026-09-01T00:00:00.000Z'), enableBankingTransactionId: 'eb-1', merchant, status: 'BOOKED' });
      const { view } = await setup().importPdf();
      expect(view.rows.items.map((row) => ({ decision: row.decision, matched: row.matchedTransaction?.id ?? null, status: row.status }))).toEqual([
        { decision: 'skip', matched: synced.transactionKey, status: 'possible_duplicate' },
        { decision: 'import', matched: null, status: 'new' },
        { decision: 'import', matched: null, status: 'new' },
      ]);
    });
  });

  it('is never started through the generic route, which has no AI checks', async () => {
    const ctx = setup();
    await expect(ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'pdf', key: `account-${household.account.accountKey}-statement-1.pdf` })).rejects.toBeInstanceOf(BadRequestError);
  });
});
