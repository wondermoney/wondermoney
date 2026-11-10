import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/**
 * Rebuild one account's running balances (`services/account/account-recalculation.service.ts`).
 * Started by a person from the account menu, or by an edit to a manual account's opening balance.
 */
export const ACCOUNT_RECALCULATE_QUEUE = 'account.recalculate';

export interface AccountRecalculatePayload {
  correlationId: string;
}

export const ensureAccountRecalculateQueue = (boss: Pick<PgBossLike, 'createQueue'>) => boss.createQueue(ACCOUNT_RECALCULATE_QUEUE, {
  // One account in one database transaction: seconds, even for a long history.
  expireInSeconds: 900,
  // A worker that dies hands the job back within a minute or two instead of at expiry. The run
  // rolled back with it, so the retry starts over.
  heartbeatSeconds: 60,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 30,
  retryLimit: 2,
});

export function enqueueAccountRecalculateJob(payload: AccountRecalculatePayload, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.send(ACCOUNT_RECALCULATE_QUEUE, payload, { singletonKey: payload.correlationId });
}

QUEUE_REGISTRY.set(ACCOUNT_RECALCULATE_QUEUE, { ensure: ensureAccountRecalculateQueue, name: ACCOUNT_RECALCULATE_QUEUE });
