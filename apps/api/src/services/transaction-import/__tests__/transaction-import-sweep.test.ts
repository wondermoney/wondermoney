import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { TransactionImportRow, TransactionImportRowDecision, TransactionImportRowStatus } from '@entity/TransactionImportRow';
import { TransactionImportSession, TransactionImportSessionStatus } from '@entity/TransactionImportSession';

import { sweepTransactionImportSessions } from '../transaction-import-sweep';

/*
 * A staged import holds a bank statement's lines. Once one nobody committed has expired, the daily
 * sweep deletes it, its rows and its uploaded file, in every household. Seven days after a commit,
 * it deletes the committed session's rows and file and keeps a short summary of it. A session still
 * open, one being committed, and one being read by a live job are left alone.
 */
describe('the daily sweep of expired imports', () => {
  const db = useTestDatabase();
  const now = new Date('2026-11-09T03:30:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

  async function addSession(household: Household, input: { committedAt?: Date; correlationId?: string; expiresAt: Date; rows?: number; s3Key?: string; status: TransactionImportSessionStatus }) {
    const em = db.em();
    const session = em.create(TransactionImportSession, {
      accountKey: household.account,
      appuserKey: household.appuser,
      committedAt: input.committedAt,
      correlationId: input.correlationId,
      expiresAt: input.expiresAt,
      format: 'statement',
      publicId: randomUUID(),
      s3Bucket: 'csv',
      s3Key: input.s3Key ?? `account-${household.account.accountKey}-${randomUUID()}.csv`,
      status: input.status,
      tenantKey: household.tenant,
    }, { partial: true });
    for (let row = 1; row <= (input.rows ?? 3); row += 1) {
      const status = input.committedAt === undefined ? TransactionImportRowStatus.NEW : row === 1 ? TransactionImportRowStatus.SKIPPED : TransactionImportRowStatus.IMPORTED;
      em.create(TransactionImportRow, { decision: TransactionImportRowDecision.IMPORT, raw: { line: `row ${row}` }, sourceRow: row, status, transactionImportSessionKey: session }, { partial: true });
    }
    await em.flush();
    return session;
  }

  async function addOperation(correlationId: string, status: BackgroundOperationStatus, lastHeartbeatAt: Date) {
    const em = db.em();
    em.create(BackgroundOperation, { attemptCount: 1, correlationId, lastHeartbeatAt, operationType: 'transaction-import', queueProvider: 'pg-boss', resourceId: 'transaction-import-session:test', retryable: false, startedAt: lastHeartbeatAt, status }, { partial: true });
    await em.flush();
  }

  const remaining = async () => {
    const sessions = await db.em().find(TransactionImportSession, {}, { filters: false });
    return new Set(sessions.map((session) => session.transactionImportSessionKey));
  };
  const rowsOf = (session: TransactionImportSession) => db.em().count(TransactionImportRow, { transactionImportSessionKey: { transactionImportSessionKey: session.transactionImportSessionKey } });

  function storage() {
    const deleted: string[] = [];
    return { deleted, deleteObject: (bucket: string, key: string) => Promise.resolve(void deleted.push(`${bucket}/${key}`)) };
  }

  it('deletes the expired, uncommitted sessions of every household with their rows and files', async () => {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    const ourReady = await addSession(ours, { expiresAt: daysAgo(1), status: TransactionImportSessionStatus.READY });
    const ourUpload = await addSession(ours, { expiresAt: daysAgo(3), rows: 0, status: TransactionImportSessionStatus.WAITING_FOR_UPLOAD });
    const theirMapping = await addSession(theirs, { expiresAt: daysAgo(2), status: TransactionImportSessionStatus.NEEDS_MAPPING });
    const theirFailed = await addSession(theirs, { expiresAt: minutesAgo(1), status: TransactionImportSessionStatus.FAILED });
    const theirCancelled = await addSession(theirs, { expiresAt: daysAgo(1), rows: 0, status: TransactionImportSessionStatus.CANCELLED });

    const fresh = await addSession(ours, { expiresAt: daysAgo(-6), status: TransactionImportSessionStatus.READY });
    const committing = await addSession(theirs, { correlationId: 'transaction-import:commit:a', expiresAt: daysAgo(2), status: TransactionImportSessionStatus.IMPORTING });
    // A commit whose job stopped is resumed by the person, so it is kept even with no live job.
    const stalledCommit = await addSession(ours, { correlationId: 'transaction-import:commit:b', expiresAt: daysAgo(9), status: TransactionImportSessionStatus.IMPORTING });
    const committed = await addSession(ours, { expiresAt: daysAgo(4), status: TransactionImportSessionStatus.SUCCEEDED });
    await addOperation('transaction-import:commit:a', BackgroundOperationStatus.RUNNING, minutesAgo(1));

    const files = storage();
    const result = await sweepTransactionImportSessions({ em: db.em(), now, storage: files });

    expect(result).toMatchObject({ fileErrors: 0, files: 5, rows: 9, sessions: 5 });
    expect(await remaining()).toEqual(new Set([fresh, committing, stalledCommit, committed].map((session) => session.transactionImportSessionKey)));
    for (const gone of [ourReady, ourUpload, theirMapping, theirFailed, theirCancelled]) expect(await rowsOf(gone)).toBe(0);
    expect(await rowsOf(fresh)).toBe(3);
    expect(await rowsOf(committing)).toBe(3);
    expect(await rowsOf(stalledCommit)).toBe(3);
    expect(files.deleted.sort()).toEqual([ourReady, ourUpload, theirMapping, theirFailed, theirCancelled].map((session) => `csv/${session.s3Key}`).sort());

    // A second run finds nothing more to do.
    expect(await sweepTransactionImportSessions({ em: db.em(), now, storage: storage() })).toMatchObject({ files: 0, rows: 0, sessions: 0 });
  });

  it('deletes an expired session stuck reading its file only once its job has stopped', async () => {
    const household = await seedHousehold(db.em());
    const reading = await addSession(household, { correlationId: 'transaction-import:parse:live', expiresAt: daysAgo(1), status: TransactionImportSessionStatus.PARSING });
    const stuck = await addSession(household, { correlationId: 'transaction-import:parse:dead', expiresAt: daysAgo(1), status: TransactionImportSessionStatus.PARSING });
    await addOperation('transaction-import:parse:live', BackgroundOperationStatus.RUNNING, minutesAgo(1));
    await addOperation('transaction-import:parse:dead', BackgroundOperationStatus.RUNNING, minutesAgo(90));

    const result = await sweepTransactionImportSessions({ em: db.em(), now, storage: storage() });

    expect(result).toMatchObject({ sessions: 1 });
    expect(await remaining()).toEqual(new Set([reading.transactionImportSessionKey]));
    expect(stuck.transactionImportSessionKey).not.toBe(reading.transactionImportSessionKey);
  });

  it('works in bounded batches, up to a limit per run, and the next run carries on', async () => {
    const household = await seedHousehold(db.em());
    for (let index = 0; index < 5; index += 1) await addSession(household, { expiresAt: daysAgo(1), rows: 2, status: TransactionImportSessionStatus.READY });

    const first = await sweepTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
    expect(first).toMatchObject({ batches: 2, more: true, rows: 8, sessions: 4 });
    expect((await remaining()).size).toBe(1);

    const second = await sweepTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
    expect(second).toMatchObject({ more: false, sessions: 1 });
    expect((await remaining()).size).toBe(0);
  });

  it('keeps a file another session still reads, and deletes the rows even when a file cannot be removed', async () => {
    const household = await seedHousehold(db.em());
    const shared = `account-${household.account.accountKey}-shared.csv`;
    await addSession(household, { expiresAt: daysAgo(1), s3Key: shared, status: TransactionImportSessionStatus.FAILED });
    const retried = await addSession(household, { expiresAt: daysAgo(-6), s3Key: shared, status: TransactionImportSessionStatus.READY });
    const broken = await addSession(household, { expiresAt: daysAgo(1), status: TransactionImportSessionStatus.READY });

    const deleted: string[] = [];
    const result = await sweepTransactionImportSessions({
      em: db.em(),
      now,
      storage: { deleteObject: (_bucket, key) => (key === broken.s3Key ? Promise.reject(new Error('storage is down')) : Promise.resolve(void deleted.push(key))) },
    });

    expect(result).toMatchObject({ fileErrors: 1, files: 0, sessions: 2 });
    expect(deleted).toEqual([]);
    expect(await remaining()).toEqual(new Set([retried.transactionImportSessionKey]));
    expect(await rowsOf(broken)).toBe(0);
  });

  describe('committed sessions', () => {
    const summaryOf = async (session: TransactionImportSession) => {
      const stored = await db.em().findOneOrFail(TransactionImportSession, { transactionImportSessionKey: session.transactionImportSessionKey }, { filters: false });
      return { committedAt: stored.committedAt, detailsDeletedAt: stored.detailsDeletedAt, rowCounts: stored.rowCounts, s3Key: stored.s3Key, status: stored.status, warnings: stored.warnings };
    };

    it('deletes the rows and file of every household\'s sessions committed over 7 days ago, and keeps their summary', async () => {
      const ours = await seedHousehold(db.em());
      const theirs = await seedHousehold(db.em());
      const ourOld = await addSession(ours, { committedAt: daysAgo(8), expiresAt: daysAgo(1), status: TransactionImportSessionStatus.SUCCEEDED });
      const theirOld = await addSession(theirs, { committedAt: daysAgo(8), expiresAt: daysAgo(1), rows: 4, status: TransactionImportSessionStatus.PARTIAL });
      const ourRecent = await addSession(ours, { committedAt: daysAgo(6), expiresAt: daysAgo(-1), status: TransactionImportSessionStatus.SUCCEEDED });
      const theirRecent = await addSession(theirs, { committedAt: daysAgo(6), expiresAt: daysAgo(-1), status: TransactionImportSessionStatus.PARTIAL });
      // A commit under way is never touched, however old the session, live job or not.
      const committing = await addSession(theirs, { correlationId: 'transaction-import:commit:old', expiresAt: daysAgo(20), status: TransactionImportSessionStatus.IMPORTING });
      const stalled = await addSession(ours, { correlationId: 'transaction-import:commit:stalled', expiresAt: daysAgo(20), status: TransactionImportSessionStatus.IMPORTING });
      await addOperation('transaction-import:commit:old', BackgroundOperationStatus.RUNNING, minutesAgo(1));
      await db.em().nativeUpdate(TransactionImportSession, { transactionImportSessionKey: { $in: [committing.transactionImportSessionKey, stalled.transactionImportSessionKey] } }, { createdAt: daysAgo(20), updatedAt: daysAgo(20) });
      await db.em().nativeUpdate(TransactionImportSession, { transactionImportSessionKey: ourOld.transactionImportSessionKey }, { warnings: [{ code: 'skipped_lines', detail: 'CONTINENTE MATOSINHOS' }] });

      const files = storage();
      const result = await sweepTransactionImportSessions({ em: db.em(), now, storage: files });

      expect(result).toMatchObject({ cleared: 2, fileErrors: 0, files: 2, rows: 7, sessions: 0 });
      expect(await remaining()).toEqual(new Set([ourOld, theirOld, ourRecent, theirRecent, committing, stalled].map((session) => session.transactionImportSessionKey)));
      expect(await rowsOf(ourOld)).toBe(0);
      expect(await rowsOf(theirOld)).toBe(0);
      expect(files.deleted.sort()).toEqual([ourOld, theirOld].map((session) => `csv/${session.s3Key}`).sort());

      expect(await summaryOf(ourOld)).toEqual({
        committedAt: daysAgo(8),
        detailsDeletedAt: now,
        rowCounts: expect.objectContaining({ imported: 2, new: 0, skipped: 1 }),
        s3Key: ourOld.s3Key,
        status: TransactionImportSessionStatus.SUCCEEDED,
        warnings: null,
      });
      expect(await summaryOf(theirOld)).toMatchObject({ detailsDeletedAt: now, rowCounts: expect.objectContaining({ imported: 3, skipped: 1 }), status: TransactionImportSessionStatus.PARTIAL });

      for (const kept of [ourRecent, theirRecent, committing, stalled]) {
        expect(await rowsOf(kept)).toBe(3);
        expect((await summaryOf(kept)).detailsDeletedAt).toBeNull();
      }

      // A second run finds nothing more to do.
      expect(await sweepTransactionImportSessions({ em: db.em(), now, storage: storage() })).toMatchObject({ cleared: 0, files: 0, rows: 0, sessions: 0 });
    });

    it('judges a session committed before the commit time was recorded by when it last changed', async () => {
      const household = await seedHousehold(db.em());
      const old = await addSession(household, { expiresAt: daysAgo(1), status: TransactionImportSessionStatus.SUCCEEDED });
      const recent = await addSession(household, { expiresAt: daysAgo(1), status: TransactionImportSessionStatus.SUCCEEDED });
      await db.em().nativeUpdate(TransactionImportSession, { transactionImportSessionKey: old.transactionImportSessionKey }, { updatedAt: daysAgo(8) });
      await db.em().nativeUpdate(TransactionImportSession, { transactionImportSessionKey: recent.transactionImportSessionKey }, { updatedAt: daysAgo(6) });

      const result = await sweepTransactionImportSessions({ em: db.em(), now, storage: storage() });

      expect(result).toMatchObject({ cleared: 1, sessions: 0 });
      expect(await rowsOf(old)).toBe(0);
      expect(await rowsOf(recent)).toBe(3);
    });

    it('keeps a committed session\'s file while another session still reads it, and deletes it with the last one', async () => {
      const household = await seedHousehold(db.em());
      const shared = `account-${household.account.accountKey}-shared.csv`;
      const committed = await addSession(household, { committedAt: daysAgo(8), expiresAt: daysAgo(1), s3Key: shared, status: TransactionImportSessionStatus.SUCCEEDED });
      const retried = await addSession(household, { expiresAt: daysAgo(-1), s3Key: shared, status: TransactionImportSessionStatus.READY });

      const first = storage();
      expect(await sweepTransactionImportSessions({ em: db.em(), now, storage: first })).toMatchObject({ cleared: 1, files: 0 });
      expect(first.deleted).toEqual([]);

      // Once the other session has expired too, the file goes with it, the summary stays.
      const later = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const second = storage();
      expect(await sweepTransactionImportSessions({ em: db.em(), now: later, storage: second })).toMatchObject({ cleared: 0, files: 1, sessions: 1 });
      expect(second.deleted).toEqual([`csv/${shared}`]);
      expect(await remaining()).toEqual(new Set([committed.transactionImportSessionKey]));
      expect(retried.transactionImportSessionKey).not.toBe(committed.transactionImportSessionKey);
    });

    it('clears committed sessions in bounded batches too, and the next run carries on', async () => {
      const household = await seedHousehold(db.em());
      for (let index = 0; index < 3; index += 1) await addSession(household, { committedAt: daysAgo(8), expiresAt: daysAgo(1), rows: 2, status: TransactionImportSessionStatus.SUCCEEDED });
      for (let index = 0; index < 2; index += 1) await addSession(household, { expiresAt: daysAgo(1), rows: 2, status: TransactionImportSessionStatus.READY });

      const first = await sweepTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
      expect(first).toMatchObject({ batches: 2, more: true });
      expect(first.cleared + first.sessions).toBe(4);

      const second = await sweepTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
      expect(second).toMatchObject({ more: false });
      expect(first.cleared + second.cleared).toBe(3);
      expect(first.sessions + second.sessions).toBe(2);
    });
  });
});
