import { z } from 'zod';

import { deadLetterQueueName, ensureDeadLetterQueue } from '@app/jobs/dead-letter';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const LIFECYCLE_SEND_QUEUE = 'lifecycle.send';

const payloadSchema = z.object({
  appuserKey: z.number().int().positive(),
  campaign: z.enum(LifecycleCampaign),
  step: z.string().min(1).max(64),
  templateVersion: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
}).strict();
export type LifecycleSendPayload = z.infer<typeof payloadSchema>;

export const parseLifecycleSendPayload = (value: unknown): LifecycleSendPayload => payloadSchema.parse(value);

export const ensureLifecycleSendQueue = async (boss: Pick<PgBossLike, 'createQueue'>): Promise<void> => {
  await ensureDeadLetterQueue(boss, LIFECYCLE_SEND_QUEUE);
  await boss.createQueue(LIFECYCLE_SEND_QUEUE, { deadLetter: deadLetterQueueName(LIFECYCLE_SEND_QUEUE), expireInSeconds: 300, policy: 'exclusive', retentionSeconds: 2_592_000, retryBackoff: true, retryDelay: 60, retryLimit: 1 });
};

/** Enqueues one lifecycle send. singletonKey dedups (campaign, user, step). */
export function enqueueLifecycleSend(value: unknown, deps: { enqueue: Enqueue }, scheduledFor: Date): Promise<unknown> {
  const payload = parseLifecycleSendPayload(value);
  if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) throw new Error('Invalid lifecycle scheduled date');
  return deps.enqueue.sendAfter(LIFECYCLE_SEND_QUEUE, payload, { singletonKey: `${payload.campaign}:${payload.appuserKey}:${payload.step}` }, scheduledFor);
}

QUEUE_REGISTRY.set(LIFECYCLE_SEND_QUEUE, { ensure: ensureLifecycleSendQueue, name: LIFECYCLE_SEND_QUEUE });

export const LIFECYCLE_CRON_QUEUE = 'lifecycle.cron';
export const LIFECYCLE_CRON_SCHEDULE = '0 9 * * *';
const LIFECYCLE_CRON_KEY = 'lifecycle.cron.v1';

export const ensureLifecycleCronQueue = async (boss: Pick<PgBossLike, 'createQueue'>): Promise<void> => {
  // Daily sweep: `retryLimit: 0` meant one transient DB blip skipped a whole day of
  // lifecycle enrolment. The sweeps are idempotent (every enroller upserts on
  // (user, campaign, step)), so a retry is safe.
  await boss.createQueue(LIFECYCLE_CRON_QUEUE, { expireInSeconds: 1_800, policy: 'exclusive', retentionSeconds: 2_592_000, retryBackoff: true, retryDelay: 300, retryLimit: 2 });
};

export const scheduleLifecycleCron = (boss: Pick<PgBossLike, 'schedule'>): Promise<unknown> => boss.schedule(
  LIFECYCLE_CRON_QUEUE, LIFECYCLE_CRON_SCHEDULE, {},
  { key: LIFECYCLE_CRON_KEY, singletonKey: LIFECYCLE_CRON_KEY, tz: 'UTC' },
);
