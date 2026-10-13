export const ACCOUNT_CSV_IMPORT_QUEUE = 'account.csv-import';
// `expireInSeconds` explicit: a CSV import is bounded work a user is waiting on, and
// pg-boss's 900 s default was inherited rather than chosen.
export const ACCOUNT_CSV_IMPORT_QUEUE_OPTIONS = { expireInSeconds: 900, policy: 'exclusive', retryLimit: 0 } as const;

export interface AccountCsvImportJobPayload {
  accountKey: number;
  bankName?: string;
  bucket: string;
  correlationId: string;
  key: string;
}

export const ensureAccountCsvImportQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(ACCOUNT_CSV_IMPORT_QUEUE, ACCOUNT_CSV_IMPORT_QUEUE_OPTIONS);

export const enqueueAccountCsvImportJob = async (job: AccountCsvImportJobPayload, deps: { enqueue: Enqueue }) =>
  deps.enqueue.send(ACCOUNT_CSV_IMPORT_QUEUE, job, { singletonKey: job.correlationId });

QUEUE_REGISTRY.set(ACCOUNT_CSV_IMPORT_QUEUE, { ensure: (boss) => ensureAccountCsvImportQueue(boss as Pick<PgBossLike, 'createQueue'>), name: ACCOUNT_CSV_IMPORT_QUEUE });
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';
