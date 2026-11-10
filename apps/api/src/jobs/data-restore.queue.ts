import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const DATA_RESTORE_QUEUE = 'user.data-restore';
export const DATA_RESTORE_CLEANUP_QUEUE = 'user.data-restore.cleanup';

// One attempt: a failed check or restore is reported to the person, who can try again. An hour is
// room for a very large household. The worker heartbeats the job while it runs, so a worker that
// dies fails it within a couple of minutes instead of at expiry; the job itself keeps its
// operation's heartbeat fresh (`DataRestoreService.run`), so recovery leaves a long restore alone.
const DATA_RESTORE_QUEUE_OPTIONS = { expireInSeconds: 3600, heartbeatSeconds: 60, policy: 'exclusive', retryLimit: 0 } as const;
// Deleting the uploaded file is idempotent, so a failed delete simply runs again.
const DATA_RESTORE_CLEANUP_QUEUE_OPTIONS = { expireInSeconds: 300, retryBackoff: true, retryLimit: 5 } as const;

export interface DataRestoreCleanupJobPayload {
  correlationId: string;
}

export interface DataRestoreJobPayload {
  correlationId: string;
  mode: DataRestoreMode;
}

/** `validate` reads the file and runs the restore as a dry run; `commit` runs it for real. */
export type DataRestoreMode = 'commit' | 'validate';

interface QueueCreator { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }

export const ensureDataRestoreQueue = (boss: QueueCreator) => boss.createQueue(DATA_RESTORE_QUEUE, DATA_RESTORE_QUEUE_OPTIONS);
export const ensureDataRestoreCleanupQueue = (boss: QueueCreator) => boss.createQueue(DATA_RESTORE_CLEANUP_QUEUE, DATA_RESTORE_CLEANUP_QUEUE_OPTIONS);

export const enqueueDataRestoreJob = (job: DataRestoreJobPayload, deps: { enqueue: Enqueue }) =>
  deps.enqueue.send(DATA_RESTORE_QUEUE, job, { singletonKey: `${job.correlationId}:${job.mode}` });

/** Delete the uploaded file a day after the restore started, whatever became of it. */
export const enqueueDataRestoreCleanupJob = (job: DataRestoreCleanupJobPayload, at: Date, deps: { enqueue: Enqueue }) =>
  deps.enqueue.sendAfter(DATA_RESTORE_CLEANUP_QUEUE, job, { singletonKey: job.correlationId }, at);

QUEUE_REGISTRY.set(DATA_RESTORE_QUEUE, { ensure: (boss) => ensureDataRestoreQueue(boss), name: DATA_RESTORE_QUEUE });
QUEUE_REGISTRY.set(DATA_RESTORE_CLEANUP_QUEUE, { ensure: (boss) => ensureDataRestoreCleanupQueue(boss), name: DATA_RESTORE_CLEANUP_QUEUE });
