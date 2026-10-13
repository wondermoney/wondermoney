import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const FOUNDATION_QUEUE = 'foundation.health-check';
export const FOUNDATION_QUEUE_OPTIONS = {
  // An ops ping. Explicit so no queue in this system silently inherits the 900 s default.
  expireInSeconds: 300,
  policy: 'exclusive',
} as const;

interface FoundationJobPayload {
  correlationId: string;
  payload?: Record<string, unknown>;
}

export const enqueueFoundationJob = async (
  job: FoundationJobPayload,
  deps: { enqueue: Enqueue },
) =>
  deps.enqueue.send(
    FOUNDATION_QUEUE,
    {
      ...job.payload,
      correlationId: job.correlationId,
    },
    {
      singletonKey: job.correlationId,
    },
  );

export const ensureFoundationQueue = (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.createQueue(FOUNDATION_QUEUE, FOUNDATION_QUEUE_OPTIONS);

QUEUE_REGISTRY.set(FOUNDATION_QUEUE, { ensure: ensureFoundationQueue, name: FOUNDATION_QUEUE });
