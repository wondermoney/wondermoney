import * as Sentry from '@sentry/node';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { payloadKeys } from '@app/jobs/job-instrumentation';
import logger from '@utils/logger';

/**
 * Dead-letter queues for the queues where a poisoned payload is plausible.
 *
 * === Why these queues and not all of them ===
 *
 * A dead-letter queue is only useful where the failure can be *inspected and
 * replayed*: a job whose payload deterministically fails (a renderer that throws
 * on one user's data, a recipient the provider permanently rejects, a schema the
 * handler no longer understands after a deploy). That describes the email queues.
 * It does not describe cron ticks with an empty payload, where re-running the
 * schedule is the recovery and the payload carries no information.
 *
 * === Why every DLQ gets the same consumer ===
 *
 * The only correct thing to do with a dead-lettered job is to make a human aware
 * of it with enough context to find the original. There is no per-queue recovery
 * that can be automated safely — replaying an email job that may already have
 * been delivered is precisely the double-send this system works hard to avoid.
 * So the consumer alerts, logs, and consumes. It never rethrows: a job that
 * dead-letters out of a dead-letter queue has nowhere left to go.
 */

/** Naming mirrors the pre-existing `transaction.enrichment.gpt.dlq`. */
export const deadLetterQueueName = (queue: string): string => `${queue}.dlq`;

/**
 * Dead-lettered jobs are evidence, not work. They are never retried (retrying is
 * what exhausted the original), and they are kept for 30 days so a Monday-morning
 * investigation of a Friday-night incident still has the payload.
 */
const DEAD_LETTER_QUEUE_OPTIONS = {
  policy: 'standard',
  retentionSeconds: 2_592_000,
  retryLimit: 0,
} as const;

export const ensureDeadLetterQueue = (
  boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown> },
  queue: string,
): Promise<unknown> => boss.createQueue(deadLetterQueueName(queue), { ...DEAD_LETTER_QUEUE_OPTIONS });

/**
 * Generic dead-letter consumer: raises one Sentry event per dead-lettered job,
 * fingerprinted on the originating queue so a burst collapses into one issue.
 * Payload *keys* only — these payloads address real people.
 */
export async function handleDeadLetterJob(
  originQueue: string,
  job: Job<unknown>,
  deps: { logger?: Pick<Logger, 'error'> } = {},
): Promise<void> {
  const log = deps.logger ?? logger;
  const keys = payloadKeys(job.data);

  try {
    Sentry.captureMessage(`Job dead-lettered from ${originQueue}`, {
      extra: { deadLetterQueue: deadLetterQueueName(originQueue), payloadKeys: keys, queue: originQueue },
      fingerprint: ['pgboss-dead-letter', originQueue],
      level: 'error',
      tags: { jobId: job.id, queue: originQueue },
    });
  } catch {
    // Telemetry must never take the consumer down with it.
  }

  log.error({ jobId: job.id, payloadKeys: keys, queue: originQueue }, 'Job dead-lettered');
  return Promise.resolve();
}
