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

import { TransactionImportService, type TransactionImportStorage } from '../transaction-import.service';

/*
 * CAMT.053 imports through the staged session: the ISO 20022 statement is read by its adapter,
 * a batch booking splits into its details, a file with two statements asks for a mapping and
 * suggests the account whose number holds each IBAN, a re-import finds every row through its
 * AcctSvcrRef, the file is recognised by its content, and a DOCTYPE is refused.
 */
describe('staged CAMT.053 import', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    const names = ['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
    for (const name of names) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
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
      presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-camt-upload.xml`, presignedUrl: 'https://files.example.test/upload' }),
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
    const upload = (account: Account, content: string) => {
      // The presigned key the API hands out ends in `.csv` whatever the file is; the content decides the reader.
      const key = `account-${account.accountKey}-camt-${objects.size + 1}.csv`;
      objects.set(key, Buffer.from(content, 'utf8'));
      return key;
    };
    return { runLastJob, sent, service, upload };
  }

  const ownerScope = () => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

  async function storedTransactions(account: Account = household.account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' }, populate: ['transactionMerchantKey', 'transactionTypeKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, date: row.transactionDate?.toISOString().slice(0, 10), description: row.descriptionDirty ?? row.description ?? '', merchant: row.transactionMerchantKey?.name, type: row.transactionTypeKey?.name }));
  }

  async function staged(ctx: ReturnType<typeof setup>, content: string, format: 'camt053' | 'statement' = 'camt053') {
    const key = ctx.upload(household.account, content);
    const created = await ctx.service().create(ownerScope(), { accountId: household.account.accountKey, format, key });
    await ctx.runLastJob();
    return ctx.service().get(ownerScope(), created.id, {});
  }

  async function commitAndRun(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.service().commit(ownerScope(), id);
    return ctx.runLastJob();
  }

  const statement = (entries: string, account = '<Id><IBAN>PT50000201231234567890154</IBAN></Id>') =>
    `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>TEST-1</MsgId><CreDtTm>2026-02-01T06:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>STMT-1</Id>
      <Acct>${account}<Ccy>EUR</Ccy></Acct>
${entries}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

  const entry = (fields: { acctSvcrRef?: string; amount: string; creditDebit: string; date: string; details?: string; ntryRef?: string; status?: string }) =>
    `      <Ntry>
${fields.ntryRef ? `        <NtryRef>${fields.ntryRef}</NtryRef>` : ''}
        <Amt Ccy="EUR">${fields.amount}</Amt>
        <CdtDbtInd>${fields.creditDebit}</CdtDbtInd>
        <Sts>${fields.status ?? 'BOOK'}</Sts>
        <BookgDt><Dt>${fields.date}</Dt></BookgDt>
${fields.acctSvcrRef ? `        <AcctSvcrRef>${fields.acctSvcrRef}</AcctSvcrRef>` : ''}
${fields.details ?? ''}
      </Ntry>`;

  const detail = (fields: { acctSvcrRef?: string; amount?: string; creditDebit?: string; name: string; remittance: string }) =>
    `        <NtryDtls><TxDtls>
${fields.acctSvcrRef ? `          <Refs><AcctSvcrRef>${fields.acctSvcrRef}</AcctSvcrRef></Refs>` : ''}
${fields.amount ? `          <Amt Ccy="EUR">${fields.amount}</Amt>` : ''}
${fields.creditDebit ? `          <CdtDbtInd>${fields.creditDebit}</CdtDbtInd>` : ''}
          <RltdPties><Cdtr><Nm>${fields.name}</Nm></Cdtr></RltdPties>
          <RmtInf><Ustrd>${fields.remittance}</Ustrd></RmtInf>
        </TxDtls></NtryDtls>`;

  const bankFile = () =>
    statement(
      [
        entry({ acctSvcrRef: 'REF-1', amount: '42.50', creditDebit: 'DBIT', date: '2026-01-15', details: detail({ name: 'CONTINENTE', remittance: 'Groceries' }) }),
        entry({ acctSvcrRef: 'REF-2', amount: '1500.00', creditDebit: 'CRDT', date: '2026-01-31', details: detail({ name: 'ACME LDA', remittance: 'Salary' }) }),
      ].join('\n'),
    );

  it('stores each entry with the sign CdtDbtInd states', async () => {
    const ctx = setup();
    const view = await staged(ctx, bankFile());

    expect(view.session.format).toBe('camt053');
    expect(view.session.counts).toMatchObject({ duplicate: 0, invalid: 0, new: 2 });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, date: row.normalized?.date.slice(0, 10), merchant: row.normalized?.merchant }))).toEqual([
      { amount: -42.5, date: '2026-01-15', merchant: 'CONTINENTE' },
      { amount: 1500, date: '2026-01-31', merchant: 'ACME LDA' },
    ]);

    await commitAndRun(ctx, view.session.id);
    expect(await storedTransactions()).toEqual([
      { amount: -42.5, date: '2026-01-15', description: 'Groceries', merchant: 'CONTINENTE', type: 'PAYMENT' },
      { amount: 1500, date: '2026-01-31', description: 'Salary', merchant: 'ACME LDA', type: 'DEPOSIT' },
    ]);
  });

  it('marks every row of a re-imported file as a duplicate', async () => {
    const ctx = setup();

    const first = await staged(ctx, bankFile());
    expect(first.session.counts).toMatchObject({ new: 2 });
    await commitAndRun(ctx, first.session.id);
    expect(await storedTransactions()).toHaveLength(2);

    const second = await staged(ctx, bankFile());
    expect(second.session.counts).toMatchObject({ duplicate: 2, new: 0 });
    expect(second.rows.items.every((row) => row.decision === 'skip' && row.matchedTransaction !== null)).toBe(true);
  });

  it('splits a batch booking into its details when they add up', async () => {
    const ctx = setup();
    const file = statement(
      entry({
        acctSvcrRef: 'BATCH-1',
        amount: '100.00',
        creditDebit: 'DBIT',
        date: '2026-03-02',
        details: [detail({ acctSvcrRef: 'BATCH-1-1', amount: '60.00', creditDebit: 'DBIT', name: 'STADTWERKE', remittance: 'Power' }), detail({ acctSvcrRef: 'BATCH-1-2', amount: '40.00', creditDebit: 'DBIT', name: 'STADTWERKE', remittance: 'Water' })].join('\n'),
      }),
    );

    const view = await staged(ctx, file);
    expect(view.session.counts).toMatchObject({ new: 2 });
    expect(view.rows.items.map((row) => ({ amount: row.normalized?.amount, description: row.normalized?.description }))).toEqual([
      { amount: -60, description: 'Power' },
      { amount: -40, description: 'Water' },
    ]);

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => ({ amount: row.amount, description: row.description }))).toEqual([
      { amount: -60, description: 'Power' },
      { amount: -40, description: 'Water' },
    ]);
  });

  it('keeps a batch entry as one row when its details do not add up to it', async () => {
    const ctx = setup();
    const file = statement(
      entry({
        acctSvcrRef: 'BATCH-2',
        amount: '50.00',
        creditDebit: 'DBIT',
        date: '2026-03-04',
        details: [detail({ amount: '20.00', creditDebit: 'DBIT', name: 'KIOSK', remittance: 'Magazine' }), detail({ amount: '20.00', creditDebit: 'DBIT', name: 'KIOSK', remittance: 'Sweets' })].join('\n'),
      }),
    );

    const view = await staged(ctx, file);
    expect(view.session.counts).toMatchObject({ new: 1 });
    expect(view.rows.items[0]?.normalized).toMatchObject({ amount: -50, description: 'Magazine' });
  });

  it('asks for an account mapping when the file holds two statements, suggesting the account whose number holds each IBAN', async () => {
    const ctx = setup();
    const em = db.em();
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { accountNumber: 'PT50000201231234567890154' });
    const savings = await addAccount(em, household, { name: 'Savings' });
    savings.accountNumber = 'PT50003300009998887776655'.replace(/(.{4})/g, '$1 ').trim();
    await em.flush();
    const file = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>TEST-2</MsgId><CreDtTm>2026-02-01T06:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>CHECKING</Id>
      <Acct><Id><IBAN>PT50000201231234567890154</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entry({ acctSvcrRef: 'CHK-1', amount: '11.00', creditDebit: 'DBIT', date: '2026-01-15', details: detail({ name: 'SUPERMERCADO', remittance: 'Groceries' }) })}
    </Stmt>
    <Stmt>
      <Id>SAVINGS</Id>
      <Acct><Id><IBAN>PT50003300009998887776655</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entry({ acctSvcrRef: 'SAV-1', amount: '200.00', creditDebit: 'CRDT', date: '2026-01-21', details: detail({ name: 'CHECKING', remittance: 'Transfer' }) })}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

    const view = await staged(ctx, file);
    expect(view.session.status).toBe('needs_mapping');
    expect(view.session.sourceAccounts).toEqual([
      { currency: 'EUR', label: 'PT50000201231234567890154', rowCount: 1, suggestedAccountId: household.account.accountKey },
      { currency: 'EUR', label: 'PT50003300009998887776655', rowCount: 1, suggestedAccountId: savings.accountKey },
    ]);
    await expect(ctx.service().commit(ownerScope(), view.session.id)).rejects.toBeInstanceOf(ConflictError);

    await ctx.service().setAccountMapping(ownerScope(), view.session.id, { 'PT50000201231234567890154': household.account.accountKey, 'PT50003300009998887776655': savings.accountKey });
    const mapped = await ctx.service().get(ownerScope(), view.session.id, {});
    expect(mapped.session.status).toBe('ready');
    expect(mapped.rows.items.map((row) => row.targetAccountId)).toEqual([household.account.accountKey, savings.accountKey]);

    await commitAndRun(ctx, view.session.id);
    expect((await storedTransactions()).map((row) => row.amount)).toEqual([-11]);
    expect((await storedTransactions(savings)).map((row) => row.amount)).toEqual([200]);
  });

  it('suggests no account when no account number holds the IBAN', async () => {
    const ctx = setup();
    const other = await addAccount(db.em(), household, { name: 'Other' });
    const file = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>CHECKING</Id>
      <Acct><Id><IBAN>PT50000201231234567890154</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entry({ acctSvcrRef: 'CHK-1', amount: '11.00', creditDebit: 'DBIT', date: '2026-01-15', details: detail({ name: 'SUPERMERCADO', remittance: 'Groceries' }) })}
    </Stmt>
    <Stmt>
      <Id>OTHER</Id>
      <Acct><Id><IBAN>PT50003300009998887776655</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entry({ acctSvcrRef: 'OTH-1', amount: '5.00', creditDebit: 'DBIT', date: '2026-01-22', details: detail({ name: 'PADARIA', remittance: 'Bread' }) })}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

    const view = await staged(ctx, file);

    expect(view.session.sourceAccounts.map((source) => source.suggestedAccountId)).toEqual([undefined, undefined]);
    expect(other.accountKey).not.toBe(household.account.accountKey);
  });

  it('reads a CAMT.053 file uploaded as a statement with the CAMT.053 adapter, by its content', async () => {
    const ctx = setup();

    const view = await staged(ctx, bankFile(), 'statement');

    expect(view.session.format).toBe('camt053');
    expect(view.session.counts).toMatchObject({ new: 2 });
  });

  it('skips an entry that is not booked, with a warning', async () => {
    const ctx = setup();
    const file = statement(
      [
        entry({ acctSvcrRef: 'PEND-1', amount: '25.00', creditDebit: 'DBIT', date: '2026-01-15', details: detail({ name: 'RESTAURANTE', remittance: 'Dinner' }), status: 'PDNG' }),
        entry({ acctSvcrRef: 'BOOK-1', amount: '10.00', creditDebit: 'DBIT', date: '2026-01-16', details: detail({ name: 'CAFE', remittance: 'Coffee' }) }),
      ].join('\n'),
    );

    const view = await staged(ctx, file);

    expect(view.session.counts).toMatchObject({ new: 1 });
    expect(view.session.warnings).toContainEqual(expect.objectContaining({ code: 'entry_not_booked', detail: 'PDNG' }));
  });

  it('fails the session when the file declares a document type', async () => {
    const ctx = setup();
    const file = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Document [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>XXE</Id>
      <Acct><Id><IBAN>PT50000201231234567890154</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entry({ amount: '1.00', creditDebit: 'DBIT', date: '2026-01-15', details: detail({ name: 'X', remittance: '&xxe;' }) })}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

    const view = await staged(ctx, file);

    expect(view.session.status).toBe('failed');
    expect(view.session.errorCode).toBe('doctype');
    expect(view.session.counts).toMatchObject({ new: 0 });
  });
});
