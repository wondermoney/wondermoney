import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// Follow-up jobs after a commit; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

/** The object store, in memory: a presigned upload is a key the test then writes the file to. */
const store = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  let uploads = 0;
  return {
    objects,
    s3: {
      deleteObject: (_bucket: string, key: string) => {
        objects.delete(key);
        return Promise.resolve();
      },
      generatePresignedUrlForAccountCsv: (accountKey: number, name: string) => {
        uploads += 1;
        return Promise.resolve({ key: `account-${accountKey}-${name}-${uploads}.csv`, presignedUrl: 'https://files.example.test/upload' });
      },
      getAccountCsvBucketName: () => 'csv',
      getObjectBuffer: (_bucket: string, key: string) => {
        const object = objects.get(key);
        return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
      },
      getObjectSize: (_bucket: string, key: string) => Promise.resolve(objects.get(key)?.length),
    },
  };
});
vi.mock('@service/storage/s3', () => ({ default: store.s3 }));

import { addAccount, addPartner, addShare, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { AccountShare, AccountShareAccess } from '@entity/AccountShare';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Transaction } from '@entity/Transaction';
import { TransactionImportRow } from '@entity/TransactionImportRow';
import { TransactionImportSession } from '@entity/TransactionImportSession';
import { TransactionType } from '@entity/TransactionType';
import accountRoutes from '@route/account';
import transactionImportRoutes from '@route/transaction-import';
import type { Enqueue } from '@service/queue/enqueue';
import { ACCOUNT_ACCESS_ERROR, TransactionImportService } from '@service/transaction-import/transaction-import.service';
import { ERROR_CODE } from '@utils/errors';

/*
 * A statement import into an account, the way the web and mobile clients run it: an upload link
 * for the account, the file read into a staged session, then the commit. Anyone who may write to
 * the account may import into it: its owner, and a member on a shared account or on a private
 * one shared with them for writing. A viewer, a member on another member's private account and
 * someone from another household may not.
 */
describe('a statement import into an account the caller may write to', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const sent: { data: { correlationId: string; mode: 'commit' | 'parse' }; queue: string }[] = [];
  const enqueue: Enqueue = {
    send: (queue, data) => {
      sent.push({ data: data as (typeof sent)[number]['data'], queue });
      return Promise.resolve(`job-${sent.length}`);
    },
    sendAfter: () => Promise.resolve(null),
  };
  const accounts = tenantHttp('/v1/account', accountRoutes, { enqueue });
  const sessions = tenantHttp('/v1/transaction-import-sessions', transactionImportRoutes, { enqueue });

  const STATEMENT = [
    'Movimentos da conta',
    '',
    'Data mov.;Data valor;Descrição;Débito;Crédito;Saldo',
    '02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50',
    '05-09-2026;05-09-2026;SALARIO ACME LDA;;1.500,00;2.457,50',
  ].join('\r\n');

  async function seed(): Promise<Household> {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    await em.flush();
    return household;
  }

  /** Run the last job queued, as the worker would. */
  async function runLastJob() {
    const job = sent.at(-1);
    if (!job) throw new Error('no job queued');
    return new TransactionImportService(DI.em.fork(), { enqueue }).run(job.data.correlationId, `job-${sent.length}`, job.data.mode);
  }

  /** Upload, stage, read and commit the statement into `account` as `user`. */
  async function importAs(user: Appuser, account: Account) {
    const upload = await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/upload`).send({});
    expect(upload.status).toBe(200);
    const key = upload.body.key as string;
    store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));

    const preview = await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/import/preview`).send({ key });
    expect(preview.status).toBe(200);

    const created = await sessions.as(user).post('/v1/transaction-import-sessions').send({ accountId: account.accountKey, format: 'statement', key });
    expect(created.status).toBe(201);
    const id = created.body.session.id as string;
    await runLastJob();

    const read = await sessions.as(user).get(`/v1/transaction-import-sessions/${id}`);
    expect(read.body.session).toMatchObject({ canCommit: true, status: 'ready' });

    const committed = await sessions.as(user).post(`/v1/transaction-import-sessions/${id}/commit`).send({});
    expect(committed.status).toBe(202);
    await runLastJob();
    return (await sessions.as(user).get(`/v1/transaction-import-sessions/${id}`)).body.session as { counts: { imported: number }; status: string };
  }

  async function storedAmounts(account: Account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { filters: false, orderBy: { transactionDate: 'ASC' } });
    return rows.map((row) => row.settlementAmount);
  }

  it('lets the account owner import', async () => {
    const household = await seed();

    const session = await importAs(household.appuser, household.account);

    expect(session).toMatchObject({ counts: { imported: 2 }, status: 'succeeded' });
    expect(await storedAmounts(household.account)).toEqual([-42.5, 1500]);
  });

  it('lets a member import into another member\'s shared account', async () => {
    const household = await seed();
    const member = await addPartner(db.em(), household);

    const session = await importAs(member, household.account);

    expect(session).toMatchObject({ counts: { imported: 2 }, status: 'succeeded' });
    expect(await storedAmounts(household.account)).toEqual([-42.5, 1500]);
  });

  it('lets a member import into a private account shared with them for writing', async () => {
    const household = await seed();
    const member = await addPartner(db.em(), household);
    const shared = await addAccount(db.em(), household, { isPrivate: true });
    await addShare(db.em(), household, shared, member, 'write');

    const session = await importAs(member, shared);

    expect(session).toMatchObject({ counts: { imported: 2 }, status: 'succeeded' });
    expect(await storedAmounts(shared)).toEqual([-42.5, 1500]);
  });

  /** Every step of the import, for an account the caller may not write to, with a file already uploaded for it. */
  async function attempts(user: Appuser, account: Account) {
    const key = `account-${account.accountKey}-generic-elsewhere.csv`;
    store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));
    return [
      await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/upload`).send({}),
      await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/import/preview`).send({ key }),
      await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/import`).send({ key }),
      await sessions.as(user).post('/v1/transaction-import-sessions').send({ accountId: account.accountKey, format: 'statement', key }),
    ];
  }

  it('refuses a household viewer as read-only', async () => {
    const household = await seed();
    const viewer = await addPartner(db.em(), household, { role: HouseholdRole.VIEWER });

    const responses = await attempts(viewer, household.account);

    expect(responses.map((response) => [response.status, (response.body as { code?: string }).code])).toEqual(Array.from({ length: 4 }, () => [403, ERROR_CODE.HOUSEHOLD_READ_ONLY]));
    expect(await storedAmounts(household.account)).toEqual([]);
  });

  it('refuses a member a private account shared with them for viewing only', async () => {
    const household = await seed();
    const member = await addPartner(db.em(), household);
    const readOnly = await addAccount(db.em(), household, { isPrivate: true });
    await addShare(db.em(), household, readOnly, member, 'read');

    const responses = await attempts(member, readOnly);

    expect(responses.map((response) => [response.status, (response.body as { code?: string }).code])).toEqual(Array.from({ length: 4 }, () => [403, ERROR_CODE.ACCOUNT_READ_ONLY]));
  });

  it('answers not found for another member\'s private account and for another household\'s account', async () => {
    const household = await seed();
    const member = await addPartner(db.em(), household);
    const ownersPrivate = await addAccount(db.em(), household, { isPrivate: true });
    const neighbour = await seed();

    for (const [user, account] of [[member, ownersPrivate], [neighbour.appuser, household.account]] as const) {
      const responses = await attempts(user, account);
      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
      expect(await storedAmounts(account)).toEqual([]);
    }
  });
  describe('when access changes after the import was asked for', () => {
    /** A household whose owner shares a private account with a member for writing. */
    async function sharedForWriting() {
      const household = await seed();
      const member = await addPartner(db.em(), household);
      const account = await addAccount(db.em(), household, { isPrivate: true });
      const share = await addShare(db.em(), household, account, member, 'write');
      return { account, household, member, share };
    }
    const setShare = (share: AccountShare, change: { access?: AccountShareAccess; deletedAt?: Date }) => db.em().nativeUpdate(AccountShare, { accountShareKey: share.accountShareKey }, change);
    const sessionOf = (publicId: string) => db.em().findOneOrFail(TransactionImportSession, { publicId }, { filters: false });
    const rowsOf = async (publicId: string) => db.em().count(TransactionImportRow, { transactionImportSessionKey: { transactionImportSessionKey: (await sessionOf(publicId)).transactionImportSessionKey } }, { filters: false });

    /** A one-step import of the statement into `account` as `user`, its job not run yet. */
    async function oneStep(user: Appuser, account: Account, upload = true) {
      const key = `account-${account.accountKey}-generic-one-step-${sent.length}.csv`;
      if (upload) store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));
      const response = await accounts.as(user).post(`/v1/account/${account.accountKey}/transaction/import`).send({ key });
      expect(response.status).toBe(202);
      return { id: response.body.importId as string, key };
    }

    it('stores nothing when a one-step import is read again after the share became view-only', async () => {
      const { account, member, share } = await sharedForWriting();
      // The first read fails: the file is not there yet.
      const { id, key } = await oneStep(member, account, false);
      await runLastJob();
      expect((await sessionOf(id)).status).toBe('failed');

      store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));
      await setShare(share, { access: AccountShareAccess.READ });
      const reread = await sessions.as(member).post(`/v1/transaction-import-sessions/${id}/parse`).send({});

      expect(reread.status).toBe(403);
      expect((reread.body as { code?: string }).code).toBe(ERROR_CODE.ACCOUNT_READ_ONLY);
      expect(await storedAmounts(account)).toEqual([]);
    });

    it.each([
      ['the share is taken back', async ({ share }: Awaited<ReturnType<typeof sharedForWriting>>) => { await setShare(share, { deletedAt: new Date() }) }],
      ['the share becomes view-only', async ({ share }: Awaited<ReturnType<typeof sharedForWriting>>) => { await setShare(share, { access: AccountShareAccess.READ }) }],
      ['the member becomes a viewer', async ({ household, member }: Awaited<ReturnType<typeof sharedForWriting>>) => { await db.em().nativeUpdate(AppuserTenant, { appuserKey: { appuserKey: member.appuserKey }, tenantKey: { tenantKey: household.tenant.tenantKey } }, { role: HouseholdRole.VIEWER }) }],
      ['the member leaves the household', async ({ household, member }: Awaited<ReturnType<typeof sharedForWriting>>) => { await db.em().nativeUpdate(AppuserTenant, { appuserKey: { appuserKey: member.appuserKey }, tenantKey: { tenantKey: household.tenant.tenantKey } }, { recordActive: false }) }],
      ['the account is closed', async ({ account }: Awaited<ReturnType<typeof sharedForWriting>>) => { await db.em().nativeUpdate(Account, { accountKey: account.accountKey }, { closed: true }) }],
    ])('stores nothing when %s between the one-step import and its job', async (_change, change) => {
      const shared = await sharedForWriting();
      const { id } = await oneStep(shared.member, shared.account);

      await change(shared);
      await runLastJob();

      expect(await sessionOf(id)).toMatchObject({ errorCode: ACCOUNT_ACCESS_ERROR, status: 'failed' });
      expect(await rowsOf(id)).toBe(0);
      expect(await storedAmounts(shared.account)).toEqual([]);
    });

    it('stores nothing when the share is taken back between a staged commit and its job', async () => {
      const { account, member, share } = await sharedForWriting();
      const key = `account-${account.accountKey}-generic-staged.csv`;
      store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));
      const created = await sessions.as(member).post('/v1/transaction-import-sessions').send({ accountId: account.accountKey, format: 'statement', key });
      const id = created.body.session.id as string;
      await runLastJob();
      expect((await sessions.as(member).post(`/v1/transaction-import-sessions/${id}/commit`).send({})).status).toBe(202);

      await setShare(share, { access: AccountShareAccess.READ });
      await runLastJob();

      expect(await sessionOf(id)).toMatchObject({ errorCode: ACCOUNT_ACCESS_ERROR, status: 'failed' });
      expect(await storedAmounts(account)).toEqual([]);
    });

    it('neither reads again nor shows its duplicate matches once the person can no longer see the account', async () => {
      const { account, household, member, share } = await sharedForWriting();
      // A transaction already on the account that the file's first line repeats.
      await addTransaction(db.em(), household, { account, amount: -42.5, date: new Date('2026-09-02T00:00:00.000Z'), status: 'BOOKED' });
      const key = `account-${account.accountKey}-generic-hidden.csv`;
      store.objects.set(key, Buffer.from(STATEMENT, 'latin1'));
      const created = await sessions.as(member).post('/v1/transaction-import-sessions').send({ accountId: account.accountKey, format: 'statement', key });
      const id = created.body.session.id as string;
      await runLastJob();
      const before = await sessions.as(member).get(`/v1/transaction-import-sessions/${id}`);
      expect((before.body.rows.items as { matchedTransaction: unknown }[]).some((row) => row.matchedTransaction !== null)).toBe(true);

      await setShare(share, { deletedAt: new Date() });

      expect((await sessions.as(member).get(`/v1/transaction-import-sessions/${id}`)).status).toBe(404);
      expect((await sessions.as(member).post(`/v1/transaction-import-sessions/${id}/parse`).send({})).status).toBe(404);
      expect((await sessions.as(member).patch(`/v1/transaction-import-sessions/${id}/rows`).send({ decision: 'import', status: 'possible_duplicate' })).status).toBe(404);
      expect((await sessions.as(member).post(`/v1/transaction-import-sessions/${id}/commit`).send({})).status).toBe(404);
    });
  });

  it('refuses an import into a closed account before any upload link exists', async () => {
    const household = await seed();
    await db.em().nativeUpdate(Account, { accountKey: household.account.accountKey }, { closed: true });

    const responses = await attempts(household.appuser, household.account);

    expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
  });
});
