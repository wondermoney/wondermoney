export const ACCOUNT_INITIAL_SYNC_QUEUE = 'account.initial-sync';
const ACCOUNT_INITIAL_SYNC_RETRY_OPTIONS = {
  // A first sync pulls up to 365 days of transactions across every account behind one
  // consent, then rebuilds the balance chain. pg-boss's 900 s default was inherited, not
  // chosen, and is the wrong number for this job. One hour is sized to the real work.
  expireInSeconds: 3_600,
  retentionSeconds: 1_209_600,
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: 3,
} as const;
export const ACCOUNT_INITIAL_SYNC_QUEUE_OPTIONS = {
  policy: 'exclusive',
  ...ACCOUNT_INITIAL_SYNC_RETRY_OPTIONS,
} as const;

/**
 * Phase 1d: widened to a discriminated union rather than renamed/unified fields, so an
 * already-enqueued (pre-deploy) GoCardless job payload — this queue's retention is 14 days,
 * `ACCOUNT_INITIAL_SYNC_RETRY_OPTIONS.retentionSeconds` — still deserializes and dispatches
 * exactly as before. The GoCardless variant intentionally carries no `provider` field at all
 * (not even `'gocardless'`) so its wire shape is byte-for-byte unchanged from before this phase;
 * `account-initial-sync.worker.ts` treats "not `enable_banking`" as the GoCardless default.
 */
export type AccountInitialSyncJobPayload = AccountInitialSyncJobPayloadEnableBanking | AccountInitialSyncJobPayloadGoCardless;

export interface AccountInitialSyncJobPayloadEnableBanking {
  connectionId: string;
  correlationId: string;
  enableBankingConnectionKey: string;
  incidentId: string;
  provider: 'enable_banking';
}

export interface AccountInitialSyncJobPayloadGoCardless {
  correlationId: string;
  incidentId: string;
  nordigenRequisitionKey: string;
  // Declared only so `job.provider === 'enable_banking'` discriminates the union at the type
  // level — never actually present on the wire (see the module docblock above).
  provider?: undefined;
  requisitionId: string;
}

/** Works for either provider's key — it's just an opaque string prefix, never inspected. */
export const buildAccountInitialSyncCorrelationId = (syncTargetKey: string) =>
  `account.initial-sync:${syncTargetKey}`;

export const ensureAccountInitialSyncQueue = async (boss: { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>; updateQueue?: (queue: string, options: Record<string, unknown>) => Promise<unknown> }) => {
  await boss.createQueue(ACCOUNT_INITIAL_SYNC_QUEUE, ACCOUNT_INITIAL_SYNC_QUEUE_OPTIONS);
  await boss.updateQueue?.(ACCOUNT_INITIAL_SYNC_QUEUE, ACCOUNT_INITIAL_SYNC_RETRY_OPTIONS);
};

export const enqueueAccountInitialSyncJob = async (
  job: AccountInitialSyncJobPayload,
  deps: { enqueue: Enqueue },
) => {
  const data = job.provider === 'enable_banking'
    ? { connectionId: job.connectionId, correlationId: job.correlationId, enableBankingConnectionKey: job.enableBankingConnectionKey, incidentId: job.incidentId, provider: job.provider }
    : { correlationId: job.correlationId, incidentId: job.incidentId, nordigenRequisitionKey: job.nordigenRequisitionKey, requisitionId: job.requisitionId };

  return deps.enqueue.send(ACCOUNT_INITIAL_SYNC_QUEUE, data, { singletonKey: job.correlationId });
};

QUEUE_REGISTRY.set(ACCOUNT_INITIAL_SYNC_QUEUE, { ensure: (boss) => ensureAccountInitialSyncQueue(boss as unknown as { createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>; updateQueue?: (queue: string, options: Record<string, unknown>) => Promise<unknown> }), name: ACCOUNT_INITIAL_SYNC_QUEUE });
import type { Enqueue } from '@service/queue/enqueue';
import { QUEUE_REGISTRY } from '@service/queue/queues';
