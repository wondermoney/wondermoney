import { z } from 'zod';

import { deadLetterQueueName, ensureDeadLetterQueue } from '@app/jobs/dead-letter';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

export const BANK_RECOVERY_QUEUE = 'bank-recovery.send';

const bankRecoveryPayloadSchema = z.object({
  deliveryKey: z.number().int().positive(),
  incidentId: z.string().uuid(),
  templateVersion: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
}).strict();

export type BankRecoveryPayload = z.infer<typeof bankRecoveryPayloadSchema>;

export const ensureBankRecoveryQueue = async (boss: Pick<PgBossLike, 'createQueue'>) => {
  await ensureDeadLetterQueue(boss, BANK_RECOVERY_QUEUE);
  return boss.createQueue(BANK_RECOVERY_QUEUE, {
    deadLetter: deadLetterQueueName(BANK_RECOVERY_QUEUE),
    // One render + one Resend call behind a DB claim. 15 minutes (the pg-boss
    // default) is three orders of magnitude more than this ever needs, and a job
    // that hangs that long is holding the queue's only slot.
    expireInSeconds: 300,
    policy: 'exclusive',
    retentionSeconds: 1_209_600,
    retryBackoff: true,
    retryDelay: 60,
    retryLimit: 3,
  });
};

export function enqueueBankRecoveryAfter(
  input: unknown,
  deps: { enqueue: Enqueue },
  eligibleAfter: Date,
): Promise<unknown> {
  const payload = parseBankRecoveryPayload(input);
  if (!(eligibleAfter instanceof Date) || Number.isNaN(eligibleAfter.getTime())) {
    throw new Error('Invalid bank recovery eligibility date');
  }
  return deps.enqueue.sendAfter(BANK_RECOVERY_QUEUE, payload, {
    singletonKey: `${payload.incidentId}:${payload.templateVersion}`,
  }, eligibleAfter);
}

export function parseBankRecoveryPayload(payload: unknown): BankRecoveryPayload {
  return bankRecoveryPayloadSchema.parse(payload);
}

QUEUE_REGISTRY.set(BANK_RECOVERY_QUEUE, { ensure: ensureBankRecoveryQueue, name: BANK_RECOVERY_QUEUE });
