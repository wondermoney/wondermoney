import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { QUEUE_REGISTRY } from '@service/queue/queues';

/**
 * Apply one rule, or every active rule, to a household's existing transactions
 * (`services/rules/rule-run.service.ts`). Started by a person from the rules screen.
 */
export const RULE_APPLY_QUEUE = 'rule.apply';

export interface RuleApplyPayload {
  correlationId: string;
}

export const ensureRuleApplyQueue = (boss: Pick<PgBossLike, 'createQueue'>) => boss.createQueue(RULE_APPLY_QUEUE, {
  // A large history takes a while, but each batch commits with its progress, so a retry only does
  // what is left.
  expireInSeconds: 3_600,
  // The worker heartbeats the job while it runs: a worker that dies hands the job back within a
  // minute or two instead of at expiry, and the retry carries on from the last batch.
  heartbeatSeconds: 60,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 30,
  retryLimit: 3,
});

export function enqueueRuleApplyJob(payload: RuleApplyPayload, deps: { enqueue: Enqueue }): Promise<unknown> {
  return deps.enqueue.send(RULE_APPLY_QUEUE, payload, { singletonKey: payload.correlationId });
}

QUEUE_REGISTRY.set(RULE_APPLY_QUEUE, { ensure: ensureRuleApplyQueue, name: RULE_APPLY_QUEUE });
