import { z } from 'zod';

import { deadLetterQueueName, ensureDeadLetterQueue } from '@app/jobs/dead-letter';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/** The daily pass that decides bank sync alerts and records their deliveries. */
export const BANK_SYNC_ALERT_SWEEP_QUEUE = 'bank-sync-alert.sweep';
/** 08:00 UTC: morning in Europe, after the night's scheduled syncs. */
export const BANK_SYNC_ALERT_SWEEP_CRON = '0 8 * * *';

/** One delivery of one alert. */
export const BANK_SYNC_ALERT_SEND_QUEUE = 'bank-sync-alert.send';

const sendPayloadSchema = z.object({ deliveryKey: z.number().int().positive() }).strict();
export type BankSyncAlertSendPayload = z.infer<typeof sendPayloadSchema>;
export const parseBankSyncAlertSendPayload = (value: unknown): BankSyncAlertSendPayload => sendPayloadSchema.parse(value);

export const ensureBankSyncAlertSweepQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  // The sweep is idempotent (deliveries are unique per connection, event and episode), so a retry
  // after a database blip is safe and keeps a day's alerts from being skipped.
  boss.createQueue(BANK_SYNC_ALERT_SWEEP_QUEUE, { expireInSeconds: 1_800, policy: 'exclusive', retentionSeconds: 1_209_600, retryBackoff: true, retryDelay: 300, retryLimit: 2 });

export const scheduleBankSyncAlertSweep = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(BANK_SYNC_ALERT_SWEEP_QUEUE, BANK_SYNC_ALERT_SWEEP_CRON, {}, {
    key: BANK_SYNC_ALERT_SWEEP_QUEUE,
    singletonKey: BANK_SYNC_ALERT_SWEEP_QUEUE,
    tz: 'UTC',
  });

export const ensureBankSyncAlertSendQueue = async (boss: Pick<PgBossLike, 'createQueue'>) => {
  await ensureDeadLetterQueue(boss, BANK_SYNC_ALERT_SEND_QUEUE);
  // One render and one provider call behind a row claim. Retries only follow a provider refusal
  // before acceptance; the claim keeps a retried job from sending twice.
  return boss.createQueue(BANK_SYNC_ALERT_SEND_QUEUE, {
    deadLetter: deadLetterQueueName(BANK_SYNC_ALERT_SEND_QUEUE),
    expireInSeconds: 300,
    policy: 'exclusive',
    retentionSeconds: 1_209_600,
    retryBackoff: true,
    retryDelay: 300,
    retryLimit: 3,
  });
};

export function enqueueBankSyncAlertSend(deliveryKey: number, deps: { enqueue: Enqueue }): Promise<unknown> {
  const payload = parseBankSyncAlertSendPayload({ deliveryKey });
  return deps.enqueue.send(BANK_SYNC_ALERT_SEND_QUEUE, payload, { singletonKey: `bank-sync-alert:${deliveryKey}` });
}

QUEUE_REGISTRY.set(BANK_SYNC_ALERT_SEND_QUEUE, { ensure: ensureBankSyncAlertSendQueue, name: BANK_SYNC_ALERT_SEND_QUEUE });
