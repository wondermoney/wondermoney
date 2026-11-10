import type { EntityManager } from '@mikro-orm/postgresql';
import { transactionImport } from '@wondermoney/shared';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { TransactionImportSessionStatus } from '@entity/TransactionImportSession';
import s3Service from '@service/storage/s3';

/**
 * The daily sweep of staged imports (`jobs/transaction-import.queue.ts`), in every household. Rows
 * hold a statement's lines, so none stay longer than they are of use:
 *
 *   expired  a session waiting for the person stops being usable when it expires; it is deleted,
 *            with its rows and its uploaded file.
 *   cleared  {@link COMMITTED_RETENTION_MS} after a commit (`succeeded`, `partial`), its rows and
 *            file are deleted and the session stays as a summary: status, dates and the row
 *            counts by status (`rowCounts`), with `detailsDeletedAt` set.
 *
 * Never touched: a session being committed (`importing`, whether its job is live or stopped and
 * waiting to be resumed), and one whose file a live job is still reading (`parsing`).
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
  /** Committed sessions whose rows and file were deleted; their summary is kept. */
  cleared: number;
  /** Files that could not be removed; their sessions and rows are deleted all the same. */
  fileErrors: number;
  files: number;
  /** Whether the run stopped at `maxBatches` with work left. */
  more: boolean;
  rows: number;
  /** Expired, uncommitted sessions deleted. */
  sessions: number;
}

export interface TransactionImportSweepStorage {
  deleteObject(bucket: string, key: string): Promise<void>;
}

/** A statement file is a few thousand rows at most, so 50 sessions keep a transaction small. */
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 200;
/** How long a committed session keeps its rows and file. */
export const COMMITTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Uncommitted and waiting for the person (or closed by them): these expire. */
const SWEPT_STATUSES = [
  TransactionImportSessionStatus.WAITING_FOR_UPLOAD,
  TransactionImportSessionStatus.NEEDS_MAPPING,
  TransactionImportSessionStatus.READY,
  TransactionImportSessionStatus.FAILED,
  TransactionImportSessionStatus.CANCELLED,
  TransactionImportSessionStatus.EXPIRED,
];
/** Committed: these keep a summary. */
const COMMITTED_STATUSES = [TransactionImportSessionStatus.SUCCEEDED, TransactionImportSessionStatus.PARTIAL];

/** As in `TransactionImportService.jobIsLive`: a job silent this long has stopped. */
const RUNNING_JOB_SILENCE_MS = 5 * 60 * 1000;
const QUEUED_JOB_SILENCE_MS = 15 * 60 * 1000;

interface BatchOutcome {
  files: { bucket: string; key: string }[];
  rows: number;
  sessions: number;
}

interface Candidate {
  s3_bucket: string;
  s3_key: string;
  transaction_import_session_key: number;
}

/** One kind of work: which sessions it takes, and what it does to a locked batch of them. */
interface Step {
  apply: (tx: EntityManager, sessions: Candidate[], now: Date) => Promise<number>;
  counter: 'cleared' | 'sessions';
  params: (now: Date) => unknown[];
  where: string;
}

const defaultStorage: TransactionImportSweepStorage = { deleteObject: (bucket, key) => s3Service.deleteObject(bucket, key) };

export async function sweepTransactionImportSessions(input: TransactionImportSweepInput): Promise<TransactionImportSweepResult> {
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES;
  const storage = input.storage ?? defaultStorage;
  const result: TransactionImportSweepResult = { batches: 0, cleared: 0, fileErrors: 0, files: 0, more: false, rows: 0, sessions: 0 };

  for (const step of [EXPIRED, COMMITTED]) {
    while (result.batches < maxBatches) {
      const batch = await runBatch(input.em.fork(), step, input.now, batchSize);
      if (batch.sessions === 0) break;
      result.batches += 1;
      result[step.counter] += batch.sessions;
      result.rows += batch.rows;
      for (const file of batch.files) {
        try {
          await storage.deleteObject(file.bucket, file.key);
          result.files += 1;
        } catch {
          result.fileErrors += 1;
        }
      }
      if (batch.sessions < batchSize) break;
    }
  }
  if (result.batches === maxBatches) {
    for (const step of [EXPIRED, COMMITTED]) result.more ||= await hasCandidates(input.em.fork(), step, input.now);
  }
  return result;
}

/** Expired, uncommitted sessions: deleted, rows and all. */
const EXPIRED: Step = {
  apply: async (tx, sessions) => {
    const keys = sessions.map((session) => session.transaction_import_session_key);
    const rows = await deleteRows(tx, keys);
    await tx.getConnection().execute(`delete from transaction_import_session where transaction_import_session_key in (${placeholders(keys)})`, keys, 'run', tx.getTransactionContext());
    return rows;
  },
  counter: 'sessions',
  params: (now) => [
    ...SWEPT_STATUSES,
    TransactionImportSessionStatus.PARSING,
    BackgroundOperationStatus.RUNNING,
    new Date(now.getTime() - RUNNING_JOB_SILENCE_MS),
    BackgroundOperationStatus.QUEUED,
    new Date(now.getTime() - QUEUED_JOB_SILENCE_MS),
    now,
  ],
  where: `(
    (s.status in (${SWEPT_STATUSES.map(() => '?').join(', ')}))
    or (s.status = ? and not exists (
      select 1 from background_operation o
      where o.correlation_id = s.correlation_id and o.deleted_at is null and (
        (o.status = ? and coalesce(o.last_heartbeat_at, o.started_at, o.created_at) > ?)
        or (o.status = ? and coalesce(o.queued_at, o.created_at) > ?)
      )
    ))
  ) and s.expires_at <= ?`,
};

/**
 * Sessions committed over {@link COMMITTED_RETENTION_MS} ago: the row counts are kept on the
 * session, then the rows and what the file told about itself (its accounts, its warnings) go. A
 * session committed before `committed_at` was recorded is judged by when it last changed, which
 * was its commit.
 */
const COMMITTED: Step = {
  apply: async (tx, sessions, now) => {
    const connection = tx.getConnection();
    const keys = sessions.map((session) => session.transaction_import_session_key);
    const grouped = await connection.execute<{ count: number | string; status: transactionImport.ImportRowStatus; transaction_import_session_key: number }[]>(
      `select transaction_import_session_key, status, count(*) as count from transaction_import_row where transaction_import_session_key in (${placeholders(keys)}) group by transaction_import_session_key, status`,
      keys,
      'all',
      tx.getTransactionContext(),
    );
    const rows = await deleteRows(tx, keys);
    for (const key of keys) {
      const counts = transactionImport.countRows([]);
      for (const group of grouped) if (group.transaction_import_session_key === key) counts[group.status] += Number(group.count);
      await connection.execute(
        `update transaction_import_session set row_counts = cast(? as jsonb), details_deleted_at = ?, account_mapping = null, source_accounts = null, warnings = null, updated_at = ?
         where transaction_import_session_key = ?`,
        [JSON.stringify(counts), now, now, key],
        'run',
        tx.getTransactionContext(),
      );
    }
    return rows;
  },
  counter: 'cleared',
  params: (now) => [...COMMITTED_STATUSES, new Date(now.getTime() - COMMITTED_RETENTION_MS)],
  where: `s.status in (${COMMITTED_STATUSES.map(() => '?').join(', ')}) and s.details_deleted_at is null and coalesce(s.committed_at, s.updated_at) <= ?`,
};

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ');

async function deleteRows(tx: EntityManager, keys: number[]): Promise<number> {
  const deleted = await tx.getConnection().execute<{ affectedRows: number }>(`delete from transaction_import_row where transaction_import_session_key in (${placeholders(keys)})`, keys, 'run', tx.getTransactionContext());
  return deleted.affectedRows;
}

/**
 * One transaction: lock up to `limit` of the step's sessions (skipping any another transaction
 * holds, such as a commit chunk), apply the step, and name the files no session still reads.
 */
async function hasCandidates(em: EntityManager, step: Step, now: Date): Promise<boolean> {
  const found = await em.getConnection().execute<unknown[]>(`select 1 from transaction_import_session s where ${step.where} limit 1`, step.params(now));
  return found.length > 0;
}

async function runBatch(em: EntityManager, step: Step, now: Date, limit: number): Promise<BatchOutcome> {
  return em.transactional(async (tx) => {
    const connection = tx.getConnection();
    const sessions = await connection.execute<Candidate[]>(
      `select s.transaction_import_session_key, s.s3_bucket, s.s3_key from transaction_import_session s
       where ${step.where}
       order by s.transaction_import_session_key
       limit ? for update skip locked`,
      [...step.params(now), limit],
      'all',
      tx.getTransactionContext(),
    );
    if (sessions.length === 0) return { files: [], rows: 0, sessions: 0 };
    const rows = await step.apply(tx, sessions, now);

    // A retried upload can leave two sessions on one file; keep it while another still reads it.
    // A summary left by a cleared session reads nothing.
    const files = [...new Map(sessions.map((session) => [`${session.s3_bucket}\u0000${session.s3_key}`, { bucket: session.s3_bucket, key: session.s3_key }])).values()];
    const stillRead = await connection.execute<{ s3_bucket: string; s3_key: string }[]>(
      `select distinct s3_bucket, s3_key from transaction_import_session where details_deleted_at is null and (s3_bucket, s3_key) in (${files.map(() => '(?, ?)').join(', ')})`,
      files.flatMap((file) => [file.bucket, file.key]),
      'all',
      tx.getTransactionContext(),
    );
    const kept = new Set(stillRead.map((file) => `${file.s3_bucket}\u0000${file.s3_key}`));
    return { files: files.filter((file) => !kept.has(`${file.bucket}\u0000${file.key}`)), rows, sessions: sessions.length };
  });
}
