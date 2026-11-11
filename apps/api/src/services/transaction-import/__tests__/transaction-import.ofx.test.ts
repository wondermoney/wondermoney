import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import type { Enqueue } from '@service/queue/enqueue';
import { ConflictError } from '@utils/errors';

import { type TransactionImportDeps, TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * OFX/QFX imports through the staged session: the file is read by the OFX adapter, FITIDs dedup
 * against the target account, two rows with the same date and amount but different FITIDs both
 * import, a file with two accounts asks for a mapping, and a non-UTF-8 file keeps its accents.
 */
describe('staged OFX import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  const trn = (amount: string, date: string, fitid: string, name: string, memo = '') =>
    `<STMTTRN>\n<TRNTYPE>${Number(amount) < 0 ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${date}\n<TRNAMT>${amount}\n<FITID>${fitid}\n<NAME>${name}\n<MEMO>${memo}\n</STMTTRN>\n`;

  const ofxFile = (accounts: { id: string; rows: string[] }[]) => [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<BANKMSGSRSV1>',
    ...accounts.map((account) => [
      '<STMTTRNRS>',
      '<TRNUID>1',
      '<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
      '<STMTRS>',
      '<CURDEF>EUR',
      '<BANKACCTFROM>',
      '<BANKID>123456789',
      `<ACCTID>${account.id}`,
      '<ACCTTYPE>CHECKING',
      '</BANKACCTFROM>',
      '<BANKTRANLIST>',
      ...account.rows,
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
    ]).flat(),
    '</BANKMSGSRSV1>',
    '</OFX>',
    '',
  ].join('\n');

  function setup(extra: Partial<TransactionImportDeps> = {}) {
    const objects = new Map<string, Buffer>();
    const storage: TransactionImportStorage = {
      getAccountCsvBucketName: () => 'csv',
      getObjectBuffer: (_bucket, key) => {
        const object = objects.get(key);
        return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
      },
      getObjectSize: (_bucket, key) => Promise.resolve(objects.get(key)?.length),
      presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-ofx-upload.csv`, presignedUrl: 'https://files.example.test/upload' }),
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
    const runLastJob = (jobId?: string) => {
      const index = sent.length - 1;
      const job = sent[index];
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, jobId ?? `job-${index + 1}`, job.data.mode);
    };
    const upload = (account: Account, content: Buffer | string) => {
      const key = `account-${account.accountKey}-ofx-${objects.size + 1}.csv`;
      objects.set(key, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
      return key;
    };
    return { runLastJob, sent, service, upload };
  }

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function storedTransactions(account: Account = household.account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionMerchantKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, date: row.transactionDate?.toISOString().slice(0, 10), merchant: row.transactionMerchantKey?.name }));
  }

  async function stagedOfx(ctx: ReturnType<typeof setup>, content: Buffer | string) {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'ofx', key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, {});
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  it('marks every row of a re-imported file as a duplicate', async () => {
    const ctx = setup();
    const file = ofxFile([{ id: '111111111', rows: [trn('-42.50', '20260902', 'FIT-1', 'CONTINENTE'), trn('1500.00', '20260905', 'FIT-2', 'SALARIO')] }]);

    const first = await stagedOfx(ctx, file);
    expect(first.session.counts).toMatchObject({ duplicate: 0, new: 2 });
    await commitAndRun(ctx, first.session.id);
    expect(await storedTransactions()).toHaveLength(2);

    const second = await stagedOfx(ctx, file);
    expect(second.session.counts).toMatchObject({ duplicate: 2, new: 0 });
    expect(second.rows.items.every((row) => row.decision === 'skip' && row.matchedTransaction !== null)).toBe(true);
  });

  it('imports two rows with the same date and amount when their FITIDs differ', async () => {
    const ctx = setup();
    const file = ofxFile([{ id: '111111111', rows: [trn('-10.00', '20260910', 'FIT-A', 'COFFEE A'), trn('-10.00', '20260910', 'FIT-B', 'COFFEE B')] }]);

    const view = await stagedOfx(ctx, file);
    expect(view.session.counts).toMatchObject({ duplicate: 0, new: 2 });

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['COFFEE A', 'COFFEE B']);
  });

  it('marks a re-imported empty-FITID row as a duplicate through its fingerprint', async () => {
    const ctx = setup();
    const file = ofxFile([{ id: '111111111', rows: [trn('-5.00', '20260912', '', 'CAFE SEM ID')] }]);

    const first = await stagedOfx(ctx, file);
    expect(first.session.counts).toMatchObject({ new: 1 });
    await commitAndRun(ctx, first.session.id);

    const second = await stagedOfx(ctx, file);
    expect(second.session.counts).toMatchObject({ duplicate: 1, new: 0 });
  });

  it('asks for an account mapping when the file holds two accounts, then imports each into its own', async () => {
    const ctx = setup();
    const card = await addAccount(db.em(), household, { name: 'Card' });
    const file = ofxFile([
      { id: '111111111', rows: [trn('-11.00', '20260902', 'CHECKING-1', 'SUPERMERCADO'), trn('800.00', '20260906', 'CHECKING-2', 'EMPREGADOR')] },
      { id: '222222222', rows: [trn('-23.40', '20260909', 'CARD-1', 'RESTAURANTE')] },
    ]);

    const view = await stagedOfx(ctx, file);
    expect(view.session.status).toBe('needs_mapping');
    expect(view.session.sourceAccounts.map((source) => source.label)).toEqual(['111111111', '222222222']);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);

    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { '111111111': household.account.accountKey, '222222222': card.accountKey });
    const mapped = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(mapped.session.status).toBe('ready');
    expect(mapped.rows.items.map((row) => row.targetAccountId)).toEqual([household.account.accountKey, household.account.accountKey, card.accountKey]);

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.merchant)).toEqual(['SUPERMERCADO', 'EMPREGADOR']);
    expect((await storedTransactions(card)).map((row) => row.merchant)).toEqual(['RESTAURANTE']);
  });

  it('keeps accented payee names intact in a Windows-1252 file', async () => {
    const ctx = setup();
    const file = Buffer.from(ofxFile([{ id: '111111111', rows: [trn('-9.60', '20260904', 'CP-1', 'PADARIA SÃO JOÃO', 'Café e pastelaria')] }]), 'latin1');

    const view = await stagedOfx(ctx, file);
    expect(view.rows.items[0]?.normalized?.merchant).toBe('PADARIA SÃO JOÃO');
    expect(view.rows.items[0]?.normalized?.description).toBe('Café e pastelaria');
  });

  it('reads an OFX file uploaded as a statement as OFX', async () => {
    const ctx = setup();
    const key = ctx.upload(household.account, ofxFile([{ id: '111111111', rows: [trn('-3.20', '20260916', 'FALLBACK-1', 'JORNAL')] }]));
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format: 'statement', key });
    await ctx.runLastJob();

    const view = await ctx.service().get(ownerScope(), created.id, {});
    expect(view.session.format).toBe('ofx');
    expect(view.session.counts).toMatchObject({ new: 1 });
  });
});
