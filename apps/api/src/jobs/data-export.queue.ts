import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const DATA_EXPORT_QUEUE = 'user.data-export';
export const DATA_EXPORT_CLEANUP_QUEUE = 'user.data-export.cleanup';

// One attempt: a failed export is reported to the person, who can start another. An hour is
// room for a very large household; the job heartbeats its background operation as it goes.
const DATA_EXPORT_QUEUE_OPTIONS = { expireInSeconds: 3600, policy: 'exclusive', retryLimit: 0 } as const;
// Deleting the stored file is idempotent, so a failed delete simply runs again.
const DATA_EXPORT_CLEANUP_QUEUE_OPTIONS = { expireInSeconds: 300, retryBackoff: true, retryLimit: 5 } as const;

export interface DataExportJobPayload {
  correlationId: string;
}

interface QueueCreator { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }

export const ensureDataExportQueue = (boss: QueueCreator) => boss.createQueue(DATA_EXPORT_QUEUE, DATA_EXPORT_QUEUE_OPTIONS);
export const ensureDataExportCleanupQueue = (boss: QueueCreator) => boss.createQueue(DATA_EXPORT_CLEANUP_QUEUE, DATA_EXPORT_CLEANUP_QUEUE_OPTIONS);

export const enqueueDataExportJob = (job: DataExportJobPayload, deps: { enqueue: Enqueue }) =>
  deps.enqueue.send(DATA_EXPORT_QUEUE, job, { singletonKey: job.correlationId });

/** Delete the stored archive once its download window has passed. */
export const enqueueDataExportCleanupJob = (job: DataExportJobPayload, at: Date, deps: { enqueue: Enqueue }) =>
  deps.enqueue.sendAfter(DATA_EXPORT_CLEANUP_QUEUE, job, { singletonKey: job.correlationId }, at);

QUEUE_REGISTRY.set(DATA_EXPORT_QUEUE, { ensure: (boss) => ensureDataExportQueue(boss), name: DATA_EXPORT_QUEUE });
QUEUE_REGISTRY.set(DATA_EXPORT_CLEANUP_QUEUE, { ensure: (boss) => ensureDataExportCleanupQueue(boss), name: DATA_EXPORT_CLEANUP_QUEUE });
