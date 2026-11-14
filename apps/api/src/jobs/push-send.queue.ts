import { z } from 'zod';

import { deadLetterQueueName, ensureDeadLetterQueue } from '@app/jobs/dead-letter';
import { BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/**
 * Mobile push (`services/push`). One `send` job is one notification to one person's phones; the
 * worker turns it into text, sends it through the Expo push service and queues a `receipts` job
 * for 15 minutes later, which reads Expo's receipts and disables tokens Expo no longer delivers to.
 * Payloads carry no push token and no rendered text.
 */
export const PUSH_SEND_QUEUE = 'push-send';
/** Expo asks for receipts to be read about 15 minutes after sending; they are kept for 24 hours. */
export const PUSH_RECEIPT_DELAY_MS = 15 * 60 * 1000;

const budgetCrossingSchema = z.object({
  budgetKey: z.number().int().positive(),
  categoryName: z.string().max(255),
  month: z.number().int().min(1).max(12),
  state: z.enum(['at_limit', 'near', 'over']),
  year: z.number().int().min(2000).max(3000),
}).strict();

const notificationSchema = z.discriminatedUnion('kind', [
  z.object({ budgets: z.array(budgetCrossingSchema).min(1).max(50), kind: z.literal('budget_alert') }).strict(),
  z.object({ accountKey: z.number().int().positive(), daysUntilDue: z.number().int().min(0).max(60), kind: z.literal('credit_card_due') }).strict(),
  z.object({ event: z.enum(BankSyncAlertEventType), kind: z.literal('bank_sync_alert') }).strict(),
  z.object({ kind: z.literal('test') }).strict(),
]);

const payloadSchema = z.discriminatedUnion('type', [
  z.object({ appuserKey: z.number().int().positive(), notification: notificationSchema, type: z.literal('send') }).strict(),
  z.object({
    tickets: z.array(z.object({ id: z.string().min(1).max(128), pushDeviceKey: z.number().int().positive() }).strict()).min(1).max(1000),
    type: z.literal('receipts'),
  }).strict(),
]);

export type PushSendPayload = z.infer<typeof payloadSchema>;
export const parsePushSendPayload = (value: unknown): PushSendPayload => payloadSchema.parse(value);

export const ensurePushSendQueue = async (boss: Pick<PgBossLike, 'createQueue'>) => {
  await ensureDeadLetterQueue(boss, PUSH_SEND_QUEUE);
  // A retry follows only an answer from Expo that may clear (429, 5xx, no answer).
  return boss.createQueue(PUSH_SEND_QUEUE, {
    deadLetter: deadLetterQueueName(PUSH_SEND_QUEUE),
    expireInSeconds: 300,
    retentionSeconds: 604_800,
    retryBackoff: true,
    retryDelay: 60,
    retryLimit: 3,
  });
};

export function enqueuePushReceiptCheck(tickets: Extract<PushSendPayload, { type: 'receipts' }>['tickets'], at: Date, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.sendAfter(PUSH_SEND_QUEUE, parsePushSendPayload({ tickets, type: 'receipts' }), undefined, at);
}

export function enqueuePushSend(payload: Extract<PushSendPayload, { type: 'send' }>, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.send(PUSH_SEND_QUEUE, parsePushSendPayload(payload));
}

QUEUE_REGISTRY.set(PUSH_SEND_QUEUE, { ensure: ensurePushSendQueue, name: PUSH_SEND_QUEUE });
