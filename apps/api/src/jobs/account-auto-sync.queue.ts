export const ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE = 'account.auto-sync.schedule';
export const ACCOUNT_AUTO_SYNC_CRON = '0 */4 * * *';
export const ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE = 'account.auto-sync.requisition';
export const ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE = 'account.auto-sync.requisition';
// Retries are sized to what the job does. The schedule queue only scans the database, so it
// keeps pg-boss's usual short backoff. The requisition queue calls the bank, where a retry
// spends the account's PSD2 unattended-access quota (often four calls a day): one retry, half
// an hour later. A failed run also waits out the connection's own interval before the next
// scheduled scan picks it up again (see `lastSyncAttemptAt`).
const ACCOUNT_AUTO_SYNC_SCHEDULE_MAX_RETRIES = 3;
// Explicit rather than pg-boss's 900 s default: a requisition job does the same shape of
// provider work as an initial sync, so both are sized to the work.
const ACCOUNT_AUTO_SYNC_BASE_OPTIONS = {
  expireInSeconds: 3_600,
  retentionSeconds: 1_209_600,
} as const;
const ACCOUNT_AUTO_SYNC_SCHEDULE_RETRY_OPTIONS = {
  ...ACCOUNT_AUTO_SYNC_BASE_OPTIONS,
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: ACCOUNT_AUTO_SYNC_SCHEDULE_MAX_RETRIES,
} as const;
const ACCOUNT_AUTO_SYNC_PROVIDER_MAX_RETRIES = 1;
const ACCOUNT_AUTO_SYNC_PROVIDER_RETRY_DELAY_SECONDS = 1_800;
const ACCOUNT_AUTO_SYNC_PROVIDER_RETRY_OPTIONS = {
  ...ACCOUNT_AUTO_SYNC_BASE_OPTIONS,
  retryBackoff: false,
  retryDelay: ACCOUNT_AUTO_SYNC_PROVIDER_RETRY_DELAY_SECONDS,
  retryLimit: ACCOUNT_AUTO_SYNC_PROVIDER_MAX_RETRIES,
} as const;
const ACCOUNT_AUTO_SYNC_QUEUE_OPTIONS = {
  policy: 'exclusive',
  ...ACCOUNT_AUTO_SYNC_SCHEDULE_RETRY_OPTIONS,
} as const;
const ACCOUNT_AUTO_SYNC_PROVIDER_QUEUE_OPTIONS = {
  policy: 'exclusive',
  ...ACCOUNT_AUTO_SYNC_PROVIDER_RETRY_OPTIONS,
} as const;

/**
 * A discriminated union on `provider`, like `AccountInitialSyncJobPayload` in
 * `jobs/account-initial-sync.queue.ts`. The legacy-requisition variant carries no `provider` field
 * at all; it stays in the type so `account-auto-sync.worker.ts` can recognise such a payload and
 * reject it rather than coerce it.
 */
export type AccountAutoSyncRequisitionJobPayload = AccountAutoSyncRequisitionJobPayloadBank | AccountAutoSyncRequisitionJobPayloadGoCardless;

/** Any provider behind the `BankProvider` interface. */
export interface AccountAutoSyncRequisitionJobPayloadBank {
  // Included (unlike the initial-sync payload) because this job's handler needs to resolve the
  // owning appuser's credential before syncing.
  appuserKey: number;
  /** `BankConnection.bankConnectionKey`, the provider-agnostic key. */
  bankConnectionKey: string;
  connectionId: string;
  correlationId: string;
  incidentId: string;
  provider: string;
  scheduleRunId: string;
}

export interface AccountAutoSyncRequisitionJobPayloadGoCardless {
  correlationId: string;
  incidentId: string;
  nordigenRequisitionKey: string;
  // Declared only so `job.provider !== undefined` discriminates the union at the type level —
  // never actually present on the wire (see the module docblock above).
  provider?: undefined;
  requisitionId: string;
  scheduleRunId: string;
}

export const buildAccountAutoSyncRequisitionCorrelationId = (runId: string, nordigenRequisitionKey: string) => `account.auto-sync.requisition:${runId}:${nordigenRequisitionKey}`;

interface AccountAutoSyncQueueBoss {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
  updateQueue?: (queue: string, options: Record<string, unknown>) => Promise<unknown>;
}

const ensureAccountAutoSyncQueue = async (boss: AccountAutoSyncQueueBoss, queue: string, options: Record<string, unknown>) => {
  await boss.createQueue(queue, options);
  const { policy: _policy, ...retryOptions } = options;
  await boss.updateQueue?.(queue, retryOptions);
};

export const ensureAccountAutoSyncScheduleQueue = (boss: AccountAutoSyncQueueBoss) => ensureAccountAutoSyncQueue(boss, ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE, ACCOUNT_AUTO_SYNC_QUEUE_OPTIONS);

export const ensureAccountAutoSyncRequisitionQueue = (boss: AccountAutoSyncQueueBoss) => ensureAccountAutoSyncQueue(boss, ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE, ACCOUNT_AUTO_SYNC_PROVIDER_QUEUE_OPTIONS);

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
