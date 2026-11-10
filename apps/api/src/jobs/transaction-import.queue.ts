import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const TRANSACTION_IMPORT_QUEUE = 'transaction-import';

// One automatic retry: a worker that dies mid-commit stops heartbeating the job, pg-boss hands it
// back under the same id, and the commit resumes from the rows it already flipped to `imported`.
// Past that, the person can start the commit again (`POST .../commit`), which also resumes. An hour
// is room for a 10,000-row file on a small self-hosted worker.
const TRANSACTION_IMPORT_QUEUE_OPTIONS = { expireInSeconds: 3600, heartbeatSeconds: 60, policy: 'exclusive', retryDelay: 30, retryLimit: 1 } as const;

/** `parse` reads the file into rows; `commit` writes the rows decided `import`. */
export type TransactionImportJobMode = 'commit' | 'parse';

export interface TransactionImportJobPayload {
  correlationId: string;
  mode: TransactionImportJobMode;
}

interface QueueCreator { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }

export const ensureTransactionImportQueue = (boss: QueueCreator) => boss.createQueue(TRANSACTION_IMPORT_QUEUE, TRANSACTION_IMPORT_QUEUE_OPTIONS);

export const enqueueTransactionImportJob = (job: TransactionImportJobPayload, deps: { enqueue: Enqueue }) =>
  deps.enqueue.send(TRANSACTION_IMPORT_QUEUE, job, { singletonKey: job.correlationId });

QUEUE_REGISTRY.set(TRANSACTION_IMPORT_QUEUE, { ensure: (boss) => ensureTransactionImportQueue(boss), name: TRANSACTION_IMPORT_QUEUE });

/** The daily sweep that deletes expired, uncommitted imports and their rows and files, in every household. */
export const TRANSACTION_IMPORT_SWEEP_QUEUE = 'transaction-import.sweep';
/** 03:30 UTC: night in Europe, between the 03:00 price and snapshot jobs and the 05:00 rate sync. */
export const TRANSACTION_IMPORT_SWEEP_CRON = '30 3 * * *';

// Deleting an already deleted session is a no-op, so a retry after a database blip is safe.
export const ensureTransactionImportSweepQueue = (boss: QueueCreator) =>
  boss.createQueue(TRANSACTION_IMPORT_SWEEP_QUEUE, { expireInSeconds: 1_800, policy: 'exclusive', retentionSeconds: 1_209_600, retryBackoff: true, retryDelay: 300, retryLimit: 2 });

export const scheduleTransactionImportSweep = (boss: { schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.schedule(TRANSACTION_IMPORT_SWEEP_QUEUE, TRANSACTION_IMPORT_SWEEP_CRON, {}, { key: TRANSACTION_IMPORT_SWEEP_QUEUE, singletonKey: TRANSACTION_IMPORT_SWEEP_QUEUE, tz: 'UTC' });
