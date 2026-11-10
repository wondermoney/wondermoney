import type { EntityManager } from '@mikro-orm/postgresql';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { TransactionImportSessionStatus } from '@entity/TransactionImportSession';
import s3Service from '@service/storage/s3';

/**
 * The daily sweep of staged imports nobody committed (`jobs/transaction-import.queue.ts`). A
 * session that is waiting for the person stops being usable when it expires, but its rows hold the
 * statement's lines; this deletes such sessions in every household, with their rows and their
 * uploaded file. The person's own next import also deletes theirs (`TransactionImportService`).
 *
 * Never deleted: a session being committed (`importing`, whether its job is live or stopped and
 * waiting to be resumed), a committed one (`succeeded`, `partial`), and one whose file a live job
 * is still reading (`parsing`).
 */
export interface TransactionImportSweepInput {
  /** Sessions per database transaction (each with all of its rows). */
  batchSize?: number;
  em: EntityManager;
  /** Batches per run; what is left waits for the next run. */
  maxBatches?: number;
  now: Date;
  storage?: TransactionImportSweepStorage;
}

export interface TransactionImportSweepResult {
  batches: number;
  /** Files that could not be removed; their sessions and rows are deleted all the same. */
  fileErrors: number;
  files: number;
  /** Whether the run stopped at `maxBatches` with expired sessions left. */
  more: boolean;
  rows: number;
  sessions: number;
}

export interface TransactionImportSweepStorage {
  deleteObject(bucket: string, key: string): Promise<void>;
}

/** A statement file is a few thousand rows at most, so 50 sessions keep a transaction small. */
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 200;

/** Uncommitted and waiting for the person (or closed by them): these expire. */
const SWEPT_STATUSES = [
  TransactionImportSessionStatus.WAITING_FOR_UPLOAD,
  TransactionImportSessionStatus.NEEDS_MAPPING,
  TransactionImportSessionStatus.READY,
  TransactionImportSessionStatus.FAILED,
  TransactionImportSessionStatus.CANCELLED,
  TransactionImportSessionStatus.EXPIRED,
];

/** As in `TransactionImportService.jobIsLive`: a job silent this long has stopped. */
const RUNNING_JOB_SILENCE_MS = 5 * 60 * 1000;
const QUEUED_JOB_SILENCE_MS = 15 * 60 * 1000;

interface Candidate {
  s3_bucket: string;
  s3_key: string;
  transaction_import_session_key: number;
}

const defaultStorage: TransactionImportSweepStorage = { deleteObject: (bucket, key) => s3Service.deleteObject(bucket, key) };

export async function sweepExpiredTransactionImportSessions(input: TransactionImportSweepInput): Promise<TransactionImportSweepResult> {
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES;
  const storage = input.storage ?? defaultStorage;
  const result: TransactionImportSweepResult = { batches: 0, fileErrors: 0, files: 0, more: false, rows: 0, sessions: 0 };

  while (result.batches < maxBatches) {
    const batch = await deleteBatch(input.em.fork(), input.now, batchSize);
    if (batch.sessions.length === 0) break;
    result.batches += 1;
    result.sessions += batch.sessions.length;
    result.rows += batch.rows;
    for (const file of batch.files) {
      try {
        await storage.deleteObject(file.bucket, file.key);
        result.files += 1;
      } catch {
        result.fileErrors += 1;
      }
    }
    if (batch.sessions.length < batchSize) return result;
  }
  result.more = result.batches === maxBatches && (await hasCandidates(input.em.fork(), input.now));
  return result;
}

const candidateWhere = `(
    (s.status in (${SWEPT_STATUSES.map(() => '?').join(', ')}))
    or (s.status = ? and not exists (
      select 1 from background_operation o
      where o.correlation_id = s.correlation_id and o.deleted_at is null and (
        (o.status = ? and coalesce(o.last_heartbeat_at, o.started_at, o.created_at) > ?)
        or (o.status = ? and coalesce(o.queued_at, o.created_at) > ?)
      )
    ))
  ) and s.expires_at <= ?`;

const candidateParams = (now: Date) => [
  ...SWEPT_STATUSES,
  TransactionImportSessionStatus.PARSING,
  BackgroundOperationStatus.RUNNING,
  new Date(now.getTime() - RUNNING_JOB_SILENCE_MS),
  BackgroundOperationStatus.QUEUED,
  new Date(now.getTime() - QUEUED_JOB_SILENCE_MS),
  now,
];

/**
 * One transaction: lock up to `limit` expired sessions (skipping any another transaction holds,
 * such as a commit chunk), delete their rows and them, and name the files no remaining session
 * reads.
 */
async function deleteBatch(em: EntityManager, now: Date, limit: number) {
  return em.transactional(async (tx) => {
    const connection = tx.getConnection();
    const sessions = await connection.execute<Candidate[]>(
      `select s.transaction_import_session_key, s.s3_bucket, s.s3_key from transaction_import_session s
       where ${candidateWhere}
       order by s.transaction_import_session_key
       limit ? for update skip locked`,
      [...candidateParams(now), limit],
      'all',
      tx.getTransactionContext(),
    );
    if (sessions.length === 0) return { files: [], rows: 0, sessions };
    const keys = sessions.map((session) => session.transaction_import_session_key);
    const placeholders = keys.map(() => '?').join(', ');
    const rows = await connection.execute<{ affectedRows: number }>(
      `delete from transaction_import_row where transaction_import_session_key in (${placeholders})`,
      keys,
      'run',
      tx.getTransactionContext(),
    );
    await connection.execute(`delete from transaction_import_session where transaction_import_session_key in (${placeholders})`, keys, 'run', tx.getTransactionContext());

    // A retried upload can leave two sessions on one file; keep it while another still reads it.
    const files = [...new Map(sessions.map((session) => [`${session.s3_bucket}\u0000${session.s3_key}`, { bucket: session.s3_bucket, key: session.s3_key }])).values()];
    const stillRead = files.length === 0 ? [] : await connection.execute<{ s3_bucket: string; s3_key: string }[]>(
      `select distinct s3_bucket, s3_key from transaction_import_session where (s3_bucket, s3_key) in (${files.map(() => '(?, ?)').join(', ')})`,
      files.flatMap((file) => [file.bucket, file.key]),
      'all',
      tx.getTransactionContext(),
    );
    const kept = new Set(stillRead.map((file) => `${file.s3_bucket}\u0000${file.s3_key}`));
    return { files: files.filter((file) => !kept.has(`${file.bucket}\u0000${file.key}`)), rows: rows.affectedRows, sessions };
  });
}

async function hasCandidates(em: EntityManager, now: Date): Promise<boolean> {
  const found = await em.getConnection().execute<unknown[]>(`select 1 from transaction_import_session s where ${candidateWhere} limit 1`, candidateParams(now));
  return found.length > 0;
}
