import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { TransactionImportRow, TransactionImportRowDecision, TransactionImportRowStatus } from '@entity/TransactionImportRow';
import { TransactionImportSession, TransactionImportSessionStatus } from '@entity/TransactionImportSession';

import { sweepExpiredTransactionImportSessions } from '../transaction-import-sweep';

/*
 * A staged import nobody commits holds a bank statement's lines. Once it has expired, the daily
 * sweep deletes it, its rows and its uploaded file, in every household. A session still open, one
 * being committed, and one being read by a live job are left alone; so is a committed one.
 */
describe('the daily sweep of expired imports', () => {
  const db = useTestDatabase();
  const now = new Date('2026-11-09T03:30:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

  async function addSession(household: Household, input: { correlationId?: string; expiresAt: Date; rows?: number; s3Key?: string; status: TransactionImportSessionStatus }) {
    const em = db.em();
    const session = em.create(TransactionImportSession, {
      accountKey: household.account,
      appuserKey: household.appuser,
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
      em.create(TransactionImportRow, { decision: TransactionImportRowDecision.IMPORT, raw: { line: `row ${row}` }, sourceRow: row, status: TransactionImportRowStatus.NEW, transactionImportSessionKey: session }, { partial: true });
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
    const result = await sweepExpiredTransactionImportSessions({ em: db.em(), now, storage: files });

    expect(result).toMatchObject({ fileErrors: 0, files: 5, rows: 9, sessions: 5 });
    expect(await remaining()).toEqual(new Set([fresh, committing, stalledCommit, committed].map((session) => session.transactionImportSessionKey)));
    for (const gone of [ourReady, ourUpload, theirMapping, theirFailed, theirCancelled]) expect(await rowsOf(gone)).toBe(0);
    expect(await rowsOf(fresh)).toBe(3);
    expect(await rowsOf(committing)).toBe(3);
    expect(await rowsOf(stalledCommit)).toBe(3);
    expect(files.deleted.sort()).toEqual([ourReady, ourUpload, theirMapping, theirFailed, theirCancelled].map((session) => `csv/${session.s3Key}`).sort());

    // A second run finds nothing more to do.
    expect(await sweepExpiredTransactionImportSessions({ em: db.em(), now, storage: storage() })).toMatchObject({ files: 0, rows: 0, sessions: 0 });
  });

  it('deletes an expired session stuck reading its file only once its job has stopped', async () => {
    const household = await seedHousehold(db.em());
    const reading = await addSession(household, { correlationId: 'transaction-import:parse:live', expiresAt: daysAgo(1), status: TransactionImportSessionStatus.PARSING });
    const stuck = await addSession(household, { correlationId: 'transaction-import:parse:dead', expiresAt: daysAgo(1), status: TransactionImportSessionStatus.PARSING });
    await addOperation('transaction-import:parse:live', BackgroundOperationStatus.RUNNING, minutesAgo(1));
    await addOperation('transaction-import:parse:dead', BackgroundOperationStatus.RUNNING, minutesAgo(90));

    const result = await sweepExpiredTransactionImportSessions({ em: db.em(), now, storage: storage() });

    expect(result).toMatchObject({ sessions: 1 });
    expect(await remaining()).toEqual(new Set([reading.transactionImportSessionKey]));
    expect(stuck.transactionImportSessionKey).not.toBe(reading.transactionImportSessionKey);
  });

  it('works in bounded batches, up to a limit per run, and the next run carries on', async () => {
    const household = await seedHousehold(db.em());
    for (let index = 0; index < 5; index += 1) await addSession(household, { expiresAt: daysAgo(1), rows: 2, status: TransactionImportSessionStatus.READY });

    const first = await sweepExpiredTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
    expect(first).toMatchObject({ batches: 2, more: true, rows: 8, sessions: 4 });
    expect((await remaining()).size).toBe(1);

    const second = await sweepExpiredTransactionImportSessions({ batchSize: 2, em: db.em(), maxBatches: 2, now, storage: storage() });
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
    const result = await sweepExpiredTransactionImportSessions({
      em: db.em(),
      now,
      storage: { deleteObject: (_bucket, key) => (key === broken.s3Key ? Promise.reject(new Error('storage is down')) : Promise.resolve(void deleted.push(key))) },
    });

    expect(result).toMatchObject({ fileErrors: 1, files: 0, sessions: 2 });
    expect(deleted).toEqual([]);
    expect(await remaining()).toEqual(new Set([retried.transactionImportSessionKey]));
    expect(await rowsOf(broken)).toBe(0);
  });
});
