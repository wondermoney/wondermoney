export const ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE = 'account.auto-sync.schedule';
export const ACCOUNT_AUTO_SYNC_CRON = '0 */4 * * *';
export const ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE = 'account.auto-sync.requisition';
export const ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE = 'account.auto-sync.requisition';
// retryLimit + retryBackoff give us automatic retries with exponential backoff
// for transient failures (GoCardless 429s, network blips). retryDelay is the
// base delay in seconds; pg-boss applies an exponential curve when retryBackoff is true.
const ACCOUNT_AUTO_SYNC_MAX_RETRIES = 3;
const ACCOUNT_AUTO_SYNC_RETRY_OPTIONS = {
  // Explicit rather than pg-boss's 900 s default: a requisition job does the same shape of
  // provider work as an initial sync, so both are sized to the work.
  expireInSeconds: 3_600,
  retentionSeconds: 1_209_600,
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: ACCOUNT_AUTO_SYNC_MAX_RETRIES,
} as const;
export const ACCOUNT_AUTO_SYNC_QUEUE_OPTIONS = {
  policy: 'exclusive',
  ...ACCOUNT_AUTO_SYNC_RETRY_OPTIONS,
} as const;

/**
 * Phase 1e: widened to a discriminated union, mirroring `AccountInitialSyncJobPayload`'s exact
 * Phase 1d treatment in `jobs/account-initial-sync.queue.ts` (see that file's docblock for the
 * full rationale). The GoCardless variant intentionally carries no `provider` field at all — its
 * wire shape is byte-for-byte unchanged from before this phase — so `account-auto-sync.worker.ts`
 * treats "not `enable_banking`" as the GoCardless default, and any already-in-flight (pre-deploy)
 * GoCardless job still deserializes and dispatches exactly as before.
 */
export type AccountAutoSyncRequisitionJobPayload = AccountAutoSyncRequisitionJobPayloadEnableBanking | AccountAutoSyncRequisitionJobPayloadGoCardless;

export interface AccountAutoSyncRequisitionJobPayloadEnableBanking {
  // Included (unlike the initial-sync payload) because this job's handler needs to resolve the
  // owning appuser's *current* `EnableBankingCredential` before syncing (Phase 1e §3) — the
  // connection itself doesn't carry that identity in a way the worker can cheaply re-derive
  // without an extra DB round trip per job.
  appuserKey: number;
  connectionId: string;
  correlationId: string;
  enableBankingConnectionKey: string;
  incidentId: string;
  provider: 'enable_banking';
  scheduleRunId: string;
}

export interface AccountAutoSyncRequisitionJobPayloadGoCardless {
  correlationId: string;
  incidentId: string;
  nordigenRequisitionKey: string;
  // Declared only so `job.provider === 'enable_banking'` discriminates the union at the type
  // level — never actually present on the wire (see the module docblock above).
  provider?: undefined;
  requisitionId: string;
  scheduleRunId: string;
}

export const buildAccountAutoSyncRequisitionCorrelationId = (runId: string, nordigenRequisitionKey: string) => `account.auto-sync.requisition:${runId}:${nordigenRequisitionKey}`;

interface AccountAutoSyncQueueBoss {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
  updateQueue?: (queue: string, options: Record<string, unknown>) => Promise<unknown>;
}

const ensureAccountAutoSyncQueue = async (boss: AccountAutoSyncQueueBoss, queue: string) => {
  await boss.createQueue(queue, ACCOUNT_AUTO_SYNC_QUEUE_OPTIONS);
  await boss.updateQueue?.(queue, ACCOUNT_AUTO_SYNC_RETRY_OPTIONS);
};

export const ensureAccountAutoSyncScheduleQueue = (boss: AccountAutoSyncQueueBoss) => ensureAccountAutoSyncQueue(boss, ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE);

export const ensureAccountAutoSyncRequisitionQueue = (boss: AccountAutoSyncQueueBoss) => ensureAccountAutoSyncQueue(boss, ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE);

export const scheduleAccountAutoSyncJob = (boss: { schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }) =>
  boss.schedule(ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE, ACCOUNT_AUTO_SYNC_CRON, {}, { key: 'account-auto-sync-every-4-hours', singletonKey: 'account-auto-sync-every-4-hours', tz: 'UTC' });

export const enqueueAccountAutoSyncRequisitionJob = (
  job: AccountAutoSyncRequisitionJobPayload,
  deps: { boss?: { send: (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }; dedupeKey?: string; send?: (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>; singletonKey?: string } = {},
) => {
  const send = deps.send ?? deps.boss?.send.bind(deps.boss);
  if (!send) throw new Error('enqueueAccountAutoSyncRequisitionJob requires a started boss or send dependency');
  return send(ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE, { ...job }, { singletonKey: deps.singletonKey ?? deps.dedupeKey ?? job.correlationId });
};
