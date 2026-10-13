import type { ProducerOperations } from './pgboss-client';

/**
 * The queues this process may enqueue onto.
 *
 * Every name here has a producer that reaches it through the `Enqueue` seam, so a typo in a queue
 * name is a compile error rather than a job that silently lands nowhere. Cron-only queues
 * (`asset-price.refresh`, `certificado-aforro.rate-sync`) are
 * deliberately absent: nothing enqueues to them, they are scheduled by `boss.schedule`.
 */
export type QueueName =
  | 'account.csv-import'
  | 'account.initial-sync'
  | 'asset-price.historical-backfill'
  | 'bank-recovery.send'
  | 'demo-data.refresh'
  | 'email.budget.coordinator'
  | 'email.budget.user'
  | 'email.monthly_story.coordinator'
  | 'email.monthly_story.user'
  | 'email.weekly.coordinator'
  | 'email.weekly.user'
  | 'foundation.health-check'
  | 'lifecycle.send'
  | 'portfolio.csv-import-confirmed'
  | 'portfolio.csv-parse-preview'
  | 'portfolio.snapshot.auto'
  | 'portfolio.snapshot.manual'
  | 'transaction.enrichment.gpt';

/**
 * A registered queue.
 *
 * Per-queue policy (expireInSeconds, policy, retryLimit, dead-letter wiring, …) stays in each
 * `*.queue.ts` `createQueue`/`ensureQueue` helper — this registry answers "which queues may this
 * process enqueue onto, and how do we make one exist?", not "how should each queue behave?".
 */
export interface QueueDefinition {
  ensure: (boss: ProducerOperations) => Promise<unknown>;
  name: QueueName;
}

/**
 * Populated by side-effect registration in each `*.queue.ts` at module load. A queue whose module
 * has not been imported is not registered — which is correct: the producer helper lives in that same
 * module, so reaching `send` guarantees the import.
 */
export const QUEUE_REGISTRY = new Map<QueueName, QueueDefinition>();

export const getRegisteredQueueNames = (): readonly QueueName[] => [...QUEUE_REGISTRY.keys()];

export const ensureQueue = (boss: ProducerOperations, name: QueueName): Promise<unknown> => {
  const definition = QUEUE_REGISTRY.get(name);
  if (!definition) throw new Error(`No queue registered for "${name}"`);
  return definition.ensure(boss);
};
