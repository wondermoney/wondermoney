import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimJobStartMock,
  createQueueMock,
  deleteQueueMock,
  finishJobMock,
  onMock,
  scheduleMock,
  sendAfterMock,
  sendMock,
  startMock,
  stopMock,
  unscheduleMock,
  workMock,
} = vi.hoisted(() => ({
  claimJobStartMock: vi.fn().mockResolvedValue(true),
  createQueueMock: vi.fn().mockResolvedValue(undefined),
  deleteQueueMock: vi.fn().mockResolvedValue(undefined),
  finishJobMock: vi.fn().mockResolvedValue(true),
  onMock: vi.fn(),
  scheduleMock: vi.fn().mockResolvedValue(undefined),
  sendAfterMock: vi.fn().mockResolvedValue('job-id'),
  sendMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  unscheduleMock: vi.fn().mockResolvedValue(undefined),
  workMock: vi.fn(),
}));

const {
  handleAccountAutoSyncRequisitionJobMock,
  handleAccountAutoSyncScheduleJobMock,
  handleAccountInitialSyncJobMock,
  handleAnalyticsOutboxJobMock,
  handleAssetPriceRefreshJobMock,
  handleBankRecoveryDispatchJobMock,
  handleBankRecoveryJobMock,
  handleDemoDataRefreshJobMock,
  handleExchangeRateRefreshJobMock,
  handleHistoricalAssetPriceBackfillJobMock,
  handlePortfolioCsvImportConfirmedJobMock,
  handlePortfolioSnapshotAutoJobMock,
  handlePortfolioSnapshotManualJobMock,
  handleScheduledEmailsJobMock,
} = vi.hoisted(() => ({
  handleAccountAutoSyncRequisitionJobMock: vi.fn().mockResolvedValue(true),
  handleAccountAutoSyncScheduleJobMock: vi.fn().mockResolvedValue(true),
  handleAccountInitialSyncJobMock: vi.fn().mockResolvedValue(true),
  handleAnalyticsOutboxJobMock: vi.fn().mockResolvedValue({ blocked: 0, delivered: 1, scanned: 1 }),
  handleAssetPriceRefreshJobMock: vi.fn().mockResolvedValue(true),
  handleBankRecoveryDispatchJobMock: vi.fn().mockResolvedValue(true),
  handleBankRecoveryJobMock: vi.fn().mockResolvedValue(true),
  handleDemoDataRefreshJobMock: vi.fn().mockResolvedValue(true),
  handleExchangeRateRefreshJobMock: vi.fn().mockResolvedValue(true),
  handleHistoricalAssetPriceBackfillJobMock: vi.fn().mockResolvedValue(true),
  handlePortfolioCsvImportConfirmedJobMock: vi.fn().mockResolvedValue(true),
  handlePortfolioSnapshotAutoJobMock: vi.fn().mockResolvedValue(true),
  handlePortfolioSnapshotManualJobMock: vi.fn().mockResolvedValue(true),
  handleScheduledEmailsJobMock: vi.fn().mockResolvedValue(true),
}));
const { handleAccountCsvImportJobMock } = vi.hoisted(() => ({
  handleAccountCsvImportJobMock: vi.fn().mockResolvedValue(true),
}));
const { recoverOnceMock } = vi.hoisted(() => ({
  recoverOnceMock: vi.fn().mockResolvedValue({ needsAction: 0, processed: 0, reenqueued: 0, skipped: 0 }),
}));
const getWorkHandler = (queue: string) => {
  const call = workMock.mock.calls.find(([name]) => name === queue);
  if (!call) return undefined;
  return (typeof call[1] === 'function' ? call[1] : call[2]) as unknown;
};
const callNames = (calls: unknown[][]) => calls.map(([name]) => String(name));

vi.mock('@utils/logger', async () => {
  // Booting the worker transitively imports app.ts, which feeds this logger into
  // pino-http (logger-http.ts). pino-http needs a genuine pino instance (it reads
  // .child(), .levels, etc.), so return a real but silenced logger — a hand-rolled
  // stub throws "prevLogger.child is not a function" / "Cannot read '.values'" at load.
  const { default: pino } = await vi.importActual<{ default: typeof import('pino') }>('pino');
  return { default: pino({ level: 'silent' }) };
});
vi.mock('@service/sentry', () => ({}));

vi.mock('@service/operations/background-operation.service', () => ({
  default: { claimJobStart: claimJobStartMock, finishJob: finishJobMock },
}));
vi.mock('@app/jobs/account-auto-sync.worker', () => ({
  handleAccountAutoSyncRequisitionJob: handleAccountAutoSyncRequisitionJobMock,
  handleAccountAutoSyncScheduleJob: handleAccountAutoSyncScheduleJobMock,
}));
vi.mock('@app/jobs/analytics-outbox.worker', () => ({
  handleAnalyticsOutboxJob: handleAnalyticsOutboxJobMock,
}));
vi.mock('@app/jobs/portfolio-snapshot.worker', () => ({
  handlePortfolioSnapshotAutoJob: handlePortfolioSnapshotAutoJobMock,
  handlePortfolioSnapshotManualJob: handlePortfolioSnapshotManualJobMock,
}));
vi.mock('@app/jobs/asset-price-refresh.worker', () => ({ handleAssetPriceRefreshJob: handleAssetPriceRefreshJobMock }));
vi.mock('@app/jobs/exchange-rate-refresh.worker', () => ({ handleExchangeRateRefreshJob: handleExchangeRateRefreshJobMock }));
vi.mock('@app/jobs/demo-data-refresh.worker', () => ({ handleDemoDataRefreshJob: handleDemoDataRefreshJobMock }));
vi.mock('@app/jobs/historical-asset-price-backfill.worker', () => ({
  handleHistoricalAssetPriceBackfillJob: handleHistoricalAssetPriceBackfillJobMock,
}));
vi.mock('@app/jobs/scheduled-emails.worker', () => ({ handleScheduledEmailsJob: handleScheduledEmailsJobMock }));
vi.mock('@app/jobs/account-initial-sync.worker', () => ({
  handleAccountInitialSyncJob: handleAccountInitialSyncJobMock,
}));
vi.mock('@app/jobs/bank-recovery.worker', () => ({ handleBankRecoveryJob: handleBankRecoveryJobMock }));
vi.mock('@app/jobs/transaction-enrichment.worker', () => ({ handleTransactionEnrichmentGptJob: vi.fn().mockResolvedValue(true) }));
vi.mock('@app/jobs/bank-recovery-dispatch.worker', () => ({
  handleBankRecoveryDispatchJob: handleBankRecoveryDispatchJobMock,
}));
vi.mock('@app/jobs/account-csv-import.worker', () => ({ handleAccountCsvImportJob: handleAccountCsvImportJobMock }));
vi.mock('@app/jobs/portfolio-csv-import-confirmed.worker', () => ({
  handlePortfolioCsvImportConfirmedJob: handlePortfolioCsvImportConfirmedJobMock,
}));
vi.mock('@service/operations/background-operation-recovery.service', () => ({ default: { recoverOnce: recoverOnceMock } }));

import {
  DEMO_DATA_REFRESH_SINGLETON_KEY,
} from '@app/jobs/demo-data-refresh.queue';
import { enqueueFoundationJob } from '@app/jobs/queue';
import { createWorker } from '@app/jobs/worker';

describe('worker startup bootstrap', () => {
  it('captures startup failures in sentry before exiting', async () => {
    const captureException = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const connectDatabase = vi.fn().mockRejectedValue(new Error('startup failed'));
    const startWorkerHealthServer = vi.fn();
    const stop = vi.fn().mockResolvedValue(undefined);
    const createWorkerMock = vi.fn(() => ({ start: vi.fn(), stop }));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);

    vi.resetModules();
    vi.doMock('@sentry/node', () => ({ captureException, close }));
    vi.doMock('@app/database/di', () => ({ closeDatabase: vi.fn().mockResolvedValue(undefined), connectDatabase }));
    vi.doMock('@app/jobs/worker', () => ({ createWorker: createWorkerMock, WORKER_SHUTDOWN_TIMEOUT_MS: 12_000 }));
    vi.doMock('@app/worker-health', () => ({ startWorkerHealthServer }));
    vi.doMock('@utils/graceful-shutdown', () => ({ setupGracefulShutdown: vi.fn(() => ({ shutdown: vi.fn() })) }));

    await import('../../worker');
    await Promise.resolve();

    expect(captureException).toHaveBeenCalledWith(expect.any(Error));
    expect(close).toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    exitMock.mockRestore();
  });
});

const createBossMock = (overrides: Record<string, unknown> = {}) => ({
  createQueue: createQueueMock,
  deleteQueue: deleteQueueMock,
  findJobs: vi.fn().mockResolvedValue([]),
  on: onMock,
  schedule: scheduleMock,
  send: sendMock,
  sendAfter: sendAfterMock,
  start: startMock,
  stop: stopMock,
  unschedule: unscheduleMock,
  work: workMock,
  ...overrides,
});

const backgroundOperationServiceMock = () => ({
  attachQueueJob: vi.fn().mockResolvedValue(true),
  claimJobStart: claimJobStartMock,
  createQueuedOperation: vi.fn().mockResolvedValue(true),
  finishJob: finishJobMock,
  heartbeatJob: vi.fn().mockResolvedValue(true),
  markAttemptFailedForRetry: vi.fn().mockResolvedValue(true),
});

describe('createWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('registers queue handlers and lifecycle listeners', async () => {
    const boss = createBossMock();
    const createBoss = vi.fn(() => boss);
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(createBoss).toHaveBeenCalledOnce();
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
    expect(startMock).toHaveBeenCalledBefore(createQueueMock);
    // `arrayContaining`, not `toEqual`, and no exact count: pg-boss queue registration is
    // append-only, so pinning the exact set turned every new queue (and every dead-letter queue
    // added alongside one) into an unrelated test failure. What actually matters is that each
    // queue below still gets created, that creation happens after start() and before work(), and
    // that a dead-letter queue exists before the queue that points at it.
    expect(callNames(createQueueMock.mock.calls)).toEqual(expect.arrayContaining([
      'foundation.health-check',
      'account.initial-sync',
      'bank-recovery.send',
      'bank-recovery.dispatch',
      'account.csv-import',
      'portfolio.csv-import-confirmed',
      'portfolio.csv-parse-preview',
      'portfolio.snapshot.auto',
      'portfolio.snapshot.manual',
      'account.auto-sync.schedule',
      'account.auto-sync.requisition',
      'analytics.outbox',
      'background-operation.recovery',
      'asset-price.refresh',
      'demo-data.refresh',
      'exchange-rate.refresh',
      'asset-price.historical-backfill',
      'certificado-aforro.rate-sync',
      'worker.heartbeat',
      // ensureFinancialEmailQueues always creates all six financial-email queues (budget,
      // weekly, monthlyStory), regardless of which stream's schedule/consumer flags are
      // enabled — Monthly Money Story ships with no feature flag, so its queues must exist
      // unconditionally, and the budget/weekly queue definitions come along for free since
      // the underlying pg-boss createQueue call is idempotent and harmless on its own.
      'email.budget.coordinator',
      'email.budget.user',
      'email.weekly.coordinator',
      'email.weekly.user',
      'email.monthly_story.coordinator',
      'email.monthly_story.user',
      'lifecycle.send',
      'lifecycle.cron',
      'transaction.enrichment.gpt.dlq',
      'transaction.enrichment.gpt',
    ]));
    // pg-boss rejects a queue whose deadLetter target does not exist yet, so ordering here is a
    // real startup constraint rather than an implementation detail.
    const createdQueues = callNames(createQueueMock.mock.calls);
    expect(createdQueues.indexOf('transaction.enrichment.gpt.dlq')).toBeLessThan(
      createdQueues.indexOf('transaction.enrichment.gpt'),
    );
    expect(createQueueMock).toHaveBeenCalledWith(
      'asset-price.historical-backfill',
      expect.not.objectContaining({ policy: 'short', singletonKey: expect.anything() }),
    );
    expect(createQueueMock).toHaveBeenCalledBefore(workMock);
    expect(workMock).toHaveBeenCalledWith('foundation.health-check', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('account.initial-sync', { includeMetadata: true }, expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('account.csv-import', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('portfolio.csv-import-confirmed', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('portfolio.csv-parse-preview', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('account.auto-sync.schedule', { includeMetadata: true }, expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('account.auto-sync.requisition', { includeMetadata: true }, expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('analytics.outbox', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('asset-price.refresh', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('demo-data.refresh', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('exchange-rate.refresh', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('asset-price.historical-backfill', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('portfolio.snapshot.auto', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('portfolio.snapshot.manual', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('bank-recovery.send', { includeMetadata: true }, expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('bank-recovery.dispatch', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('transaction.enrichment.gpt', { includeMetadata: true }, expect.any(Function));
    // Monthly Money Story's delivery consumer is always-on (no feature flag), unlike the
    // budget/weekly consumers above which stay gated behind their own ENABLE_*_CONSUMER flags.
    expect(workMock).toHaveBeenCalledWith('email.monthly_story.user', expect.any(Function));
    expect(workMock).not.toHaveBeenCalledWith('email.monthly_story.coordinator', expect.anything(), expect.anything());
    expect(callNames(workMock.mock.calls)).toEqual(expect.arrayContaining([
      'foundation.health-check',
      'account.initial-sync',
      'bank-recovery.send',
      'bank-recovery.dispatch',
      'account.csv-import',
      'portfolio.csv-import-confirmed',
      'portfolio.csv-parse-preview',
      'account.auto-sync.schedule',
      'asset-price.refresh',
      'exchange-rate.refresh',
      'demo-data.refresh',
      'asset-price.historical-backfill',
      'portfolio.snapshot.auto',
      'portfolio.snapshot.manual',
      'certificado-aforro.rate-sync',
      'lifecycle.send',
      'lifecycle.cron',
      'email.monthly_story.user',
      'account.auto-sync.requisition',
      'background-operation.recovery',
      'analytics.outbox',
      'worker.heartbeat',
      'transaction.enrichment.gpt',
    ]));
    // Every queue this worker consumes must also have been created by it — a consumer registered
    // against a queue that was never created silently never receives work.
    expect(createdQueues).toEqual(expect.arrayContaining(callNames(workMock.mock.calls)));
    expect(scheduleMock).not.toHaveBeenCalledWith(
      'asset-price.historical-backfill',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(workMock).toHaveBeenCalledWith('background-operation.recovery', expect.any(Function));
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(unscheduleMock).not.toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledOnce();
  });

  it('registers schedules when PGBOSS_SCHEDULE is explicitly true', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(scheduleMock).toHaveBeenCalledWith('background-operation.recovery', '*/15 * * * *', {}, {
      key: 'background-operation.recovery',
      singletonKey: 'background-operation.recovery',
      tz: 'UTC',
    });
    expect(scheduleMock).toHaveBeenCalledWith('analytics.outbox', '* * * * *', {}, {
      key: 'analytics.outbox',
      singletonKey: 'analytics.outbox',
      tz: 'UTC',
    });
    // Paused as part of the free/BYOK pivot — bank-recovery dispatch nudges users to finish
    // connecting a bank account, which pulls more hosted financial data; the scheduler owner
    // tears the schedule down instead of registering it.
    expect(scheduleMock).not.toHaveBeenCalledWith('bank-recovery.dispatch', expect.anything(), expect.anything(), expect.anything());
    expect(unscheduleMock).toHaveBeenCalledWith('bank-recovery.dispatch', 'bank-recovery.dispatch');
    // Billing-era schedules and queues left behind by earlier deploys are removed, not re-registered.
    expect(unscheduleMock).toHaveBeenCalledWith('card-expiry.warning', 'card-expiry.warning');
    expect(unscheduleMock).toHaveBeenCalledWith('referral-reward.sweep', 'referral-reward.sweep');
    expect(deleteQueueMock).toHaveBeenCalledWith('trial-lifecycle.send');
    expect(callNames(scheduleMock.mock.calls)).not.toEqual(expect.arrayContaining(['card-expiry.warning']));
    // No exact count: scheduling is append-only, so a new cron would otherwise fail this test for
    // no behavioural reason. What matters is asserted above and below — which schedules exist,
    // which are deliberately torn down, and that every schedule is keyed and UTC-anchored.
    for (const [, , , options] of scheduleMock.mock.calls as [string, string, unknown, { key?: string; singletonKey?: string; tz?: string }][]) {
      expect(options.key).toBeTruthy();
      expect(options.singletonKey).toBe(options.key);
    }
    expect(callNames(scheduleMock.mock.calls)).toEqual(expect.arrayContaining([
      'account.auto-sync.schedule',
      'analytics.outbox',
      'background-operation.recovery',
      'asset-price.refresh',
      'exchange-rate.refresh',
      'portfolio.snapshot.auto',
      'certificado-aforro.rate-sync',
      'lifecycle.cron',
      // Monthly Money Story is paused as part of the free/BYOK pivot too — the scheduler owner
      // tears that schedule down (see the unschedule assertions below) instead of registering it.
    ]));
    const dispatchQueueCall = createQueueMock.mock.invocationCallOrder[
      createQueueMock.mock.calls.findIndex(([name]) => name === 'bank-recovery.dispatch')
    ];
    const dispatchUnscheduleCall = unscheduleMock.mock.invocationCallOrder[
      unscheduleMock.mock.calls.findIndex(([name]) => name === 'bank-recovery.dispatch')
    ];
    expect(dispatchQueueCall).toBeLessThan(dispatchUnscheduleCall ?? 0);
    expect(scheduleMock).not.toHaveBeenCalledWith('demo-data.refresh', expect.anything(), expect.anything(), expect.anything());
    expect(unscheduleMock).toHaveBeenNthCalledWith(1, 'demo-data.refresh', DEMO_DATA_REFRESH_SINGLETON_KEY);
    expect(unscheduleMock).toHaveBeenCalledWith('email.monthly_story.coordinator', 'email.monthly_story.first_of_month.lisbon');
    expect(scheduleMock).not.toHaveBeenCalledWith('email.monthly_story.coordinator', expect.anything(), expect.anything(), expect.anything());
  });

  it('does not schedule demo data refresh when scheduler is enabled and demo refresh is disabled', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    const boss = createBossMock();
    const warn = vi.fn();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn },
    });

    await worker.start();

    expect(scheduleMock).not.toHaveBeenCalledWith('demo-data.refresh', expect.anything(), expect.anything(), expect.anything());
    expect(unscheduleMock).toHaveBeenNthCalledWith(1, 'demo-data.refresh', DEMO_DATA_REFRESH_SINGLETON_KEY);
    expect(warn).toHaveBeenCalledWith(
      { env: undefined, queue: 'demo-data.refresh', scheduleOwner: false },
      'demo data refresh schedule owner env is missing or false; demo-data.refresh schedule will not be registered',
    );
  });

  it('schedules demo data refresh when scheduler is enabled and demo refresh is enabled', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    vi.stubEnv('ENABLE_PGBOSS_DEMO_DATA_REFRESH', 'true');
    const boss = createBossMock();
    const warn = vi.fn();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn },
    });

    await worker.start();

    expect(scheduleMock).toHaveBeenCalledWith(
      'demo-data.refresh',
      '15 1 * * *',
      {},
      { key: 'demo-data.refresh.daily', singletonKey: 'demo-data.refresh.daily', tz: 'UTC' },
    );
    expect(unscheduleMock).toHaveBeenNthCalledWith(1, 'demo-data.refresh', DEMO_DATA_REFRESH_SINGLETON_KEY);
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'demo-data.refresh' }),
      expect.stringContaining('demo data refresh schedule owner env is missing or false'),
    );
  });

  it('schedules the worker heartbeat only when PGBOSS_SCHEDULE and HETRIX_WORKER_HEARTBEAT_URL are set', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    vi.stubEnv('HETRIX_WORKER_HEARTBEAT_URL', 'https://sm.hetrixtools.net/hb/?s=test');
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(scheduleMock).toHaveBeenCalledWith('worker.heartbeat', '*/2 * * * *', {}, {
      key: 'worker.heartbeat',
      singletonKey: 'worker.heartbeat',
      tz: 'UTC',
    });
    expect(unscheduleMock).toHaveBeenCalledWith('worker.heartbeat');
  });

  it('does not schedule the worker heartbeat when the heartbeat URL is absent', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(scheduleMock).not.toHaveBeenCalledWith('worker.heartbeat', expect.anything(), expect.anything(), expect.anything());
    // Still unscheduled to clear any stale schedule from a prior deploy that had the URL set.
    expect(unscheduleMock).toHaveBeenCalledWith('worker.heartbeat');
  });

  it('skips schedule registration and unschedule when PGBOSS_SCHEDULE is disabled', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'false');
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(createQueueMock).toHaveBeenCalled();
    expect(workMock).toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(unscheduleMock).not.toHaveBeenCalled();
  });

  it('delegates both bank recovery queues inside request contexts and supplies queue transport', async () => {
    const runInRequestContext = vi.fn(((fn: () => Promise<unknown>) => fn()) as <T>(
      fn: () => Promise<T>,
    ) => Promise<T>);
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      runInRequestContext: runInRequestContext as unknown as NonNullable<Parameters<typeof createWorker>[0]>['runInRequestContext'],
    });

    await worker.start();
    const sendHandler = getWorkHandler('bank-recovery.send') as (jobs: { data: unknown; id: string }[]) => Promise<unknown>;
    const dispatchHandler = getWorkHandler('bank-recovery.dispatch') as (jobs: { data: unknown; id: string }[]) => Promise<unknown>;
    await sendHandler([{ data: {}, id: 'send-job' }]);
    await dispatchHandler([{ data: {}, id: 'dispatch-job' }]);

    expect(handleBankRecoveryJobMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'send-job' }), expect.any(Object));
    expect(handleBankRecoveryDispatchJobMock).toHaveBeenCalledWith(boss);
    expect(runInRequestContext).toHaveBeenCalledTimes(2);

    const initialSyncHandler = getWorkHandler('account.initial-sync') as (jobs: { data: unknown; id: string }[]) => Promise<unknown>;
    await initialSyncHandler([{ data: {}, id: 'initial-job' }]);
    expect(handleAccountInitialSyncJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'initial-job' }),
      expect.objectContaining({
        boss,
        enqueue: expect.objectContaining({ send: expect.any(Function), sendAfter: expect.any(Function) }),
      }),
    );

    const csvImportHandler = getWorkHandler('account.csv-import') as (jobs: { data: unknown; id: string }[]) => Promise<unknown>;
    await csvImportHandler([{ data: {}, id: 'csv-job' }]);
    expect(handleAccountCsvImportJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'csv-job' }),
      expect.objectContaining({ enqueue: expect.objectContaining({ send: expect.any(Function), sendAfter: expect.any(Function) }) }),
    );

    const autoSyncHandler = getWorkHandler('account.auto-sync.requisition') as (jobs: { data: unknown; id: string }[]) => Promise<unknown>;
    await autoSyncHandler([{ data: {}, id: 'auto-sync-job' }]);
    expect(handleAccountAutoSyncRequisitionJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auto-sync-job' }),
      expect.objectContaining({ enqueue: expect.objectContaining({ send: expect.any(Function), sendAfter: expect.any(Function) }) }),
    );
  });

  it('delegates analytics outbox jobs inside a request context', async () => {
    const runInRequestContext = vi.fn(((fn: () => Promise<unknown>) => fn()) as <T>(
      fn: () => Promise<T>,
    ) => Promise<T>);
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => createBossMock()),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      runInRequestContext: runInRequestContext as unknown as NonNullable<Parameters<typeof createWorker>[0]>['runInRequestContext'],
    });

    await worker.start();
    // pg-boss hands every handler a *batch*; the shared job-instrumentation wrapper iterates it.
    const handler = getWorkHandler('analytics.outbox') as (jobs: { data: Record<string, unknown>; id: string }[]) => Promise<unknown>;
    await handler([{ data: {}, id: 'job-1' }]);

    expect(runInRequestContext).toHaveBeenCalledOnce();
    expect(handleAnalyticsOutboxJobMock).toHaveBeenCalledOnce();
  });

  it('treats unset PGBOSS_SCHEDULE as non-scheduler', async () => {
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.start();

    expect(scheduleMock).not.toHaveBeenCalled();
    expect(unscheduleMock).not.toHaveBeenCalled();
  });

  it('scheduler owner registers both financial crons, in Lisbon time', async () => {
    // Budget and weekly used to sit behind ENABLE_BUDGET_EMAIL_* / ENABLE_WEEKLY_EMAIL_*,
    // which no environment ever set, so neither had run since the feature landed. They ship
    // unconditionally now; the guard against mailing anyone is in the candidate query, not here.
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    const worker = createWorker({ backgroundOperationService: backgroundOperationServiceMock(), createBoss: vi.fn(() => createBossMock()), logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } });
    await worker.start();
    expect(scheduleMock).toHaveBeenCalledWith('email.budget.coordinator', '0 9 * * *', {}, expect.objectContaining({ tz: 'Europe/Lisbon' }));
    expect(scheduleMock).toHaveBeenCalledWith('email.weekly.coordinator', expect.any(String), {}, expect.objectContaining({ tz: 'Europe/Lisbon' }));
    expect(workMock).toHaveBeenCalledWith('email.budget.coordinator', { includeMetadata: true }, expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('email.weekly.coordinator', { includeMetadata: true }, expect.any(Function));
  });

  it('non-owner budget consumer registers delivery only without schedule mutation', async () => {
    vi.stubEnv('PGBOSS_SCHEDULE', 'false');
    const worker = createWorker({ backgroundOperationService: backgroundOperationServiceMock(), createBoss: vi.fn(() => createBossMock()), logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } });
    await worker.start();
    expect(createQueueMock).toHaveBeenCalledWith('email.budget.user', expect.any(Object));
    expect(workMock).toHaveBeenCalledWith('email.budget.user', expect.any(Function));
    expect(workMock).not.toHaveBeenCalledWith('email.budget.coordinator', expect.anything(), expect.anything());
    expect(scheduleMock).not.toHaveBeenCalledWith('email.budget.coordinator', expect.anything(), expect.anything(), expect.anything());
    expect(unscheduleMock).not.toHaveBeenCalledWith('email.budget.coordinator', expect.anything());
  });

  it('still tears down the Monthly Money Story cron while shipping its queues', async () => {
    // Monthly Story never had a flag. Its queues and consumers ship everywhere, but the
    // scheduler owner actively unschedules its cron — marketing lifecycle mail is paused for
    // the free/BYOK pivot, and simply not calling schedule() would leave a previously
    // registered schedule firing forever.
    vi.stubEnv('PGBOSS_SCHEDULE', 'true');
    const worker = createWorker({ backgroundOperationService: backgroundOperationServiceMock(), createBoss: vi.fn(() => createBossMock()), logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } });
    await worker.start();
    expect(createQueueMock).toHaveBeenCalledWith('email.monthly_story.coordinator', expect.any(Object));
    expect(createQueueMock).toHaveBeenCalledWith('email.monthly_story.user', expect.any(Object));
    expect(scheduleMock).not.toHaveBeenCalledWith('email.monthly_story.coordinator', expect.anything(), expect.anything(), expect.anything());
    expect(unscheduleMock).toHaveBeenCalledWith('email.monthly_story.coordinator', 'email.monthly_story.first_of_month.lisbon');
    expect(workMock).toHaveBeenCalledWith('email.monthly_story.user', expect.any(Function));
  });

  it('a non-scheduler worker still consumes both delivery queues', async () => {
    // Delivery consumers are independent of scheduler ownership: every worker drains them,
    // only the owner registers the crons that fill them.
    vi.stubEnv('PGBOSS_SCHEDULE', 'false');
    const worker = createWorker({ backgroundOperationService: backgroundOperationServiceMock(), createBoss: vi.fn(() => createBossMock()), logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } });
    await worker.start();
    expect(workMock).toHaveBeenCalledWith('email.weekly.user', expect.any(Function));
    expect(workMock).toHaveBeenCalledWith('email.budget.user', expect.any(Function));
    expect(workMock).not.toHaveBeenCalledWith('email.weekly.coordinator', expect.anything(), expect.anything());
  });

  it('delegates background operation recovery jobs inside request context', async () => {
    const runInRequestContext = vi.fn(((fn: () => Promise<unknown>) => fn()) as <T>(
      fn: () => Promise<T>,
    ) => Promise<T>);
    const boss = createBossMock();
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => boss),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      runInRequestContext: runInRequestContext as unknown as NonNullable<Parameters<typeof createWorker>[0]>['runInRequestContext'],
    });
    await worker.start();
    // pg-boss hands every handler a *batch*; the shared job-instrumentation wrapper iterates it.
    const handler = getWorkHandler('background-operation.recovery') as (jobs: { data: Record<string, unknown>; id: string }[]) => Promise<unknown>;
    await handler([{ data: {}, id: 'job-1' }]);
    expect(recoverOnceMock).toHaveBeenCalledWith({ boss, logger: expect.any(Object) });
    expect(runInRequestContext).toHaveBeenCalled();
  });

  it('skips jobs without correlation ids and already claimed jobs', async () => {
    claimJobStartMock.mockResolvedValueOnce(false);
    const worker = createWorker({
      backgroundOperationService: backgroundOperationServiceMock(),
      createBoss: vi.fn(() => createBossMock()),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    await worker.start();
    const handler = getWorkHandler('foundation.health-check') as (
      jobs: { data?: { correlationId?: string }; id: string }[],
    ) => Promise<unknown>;
    await handler([
      { data: {}, id: 'job-2' },
      { data: { correlationId: 'corr-2' }, id: 'job-3' },
    ]);
    expect(finishJobMock).toHaveBeenCalledTimes(0);
  });

  it('enqueues foundation jobs with correlation data', async () => {
    await enqueueFoundationJob(
      { correlationId: 'corr-123', payload: { action: 'ping' } },
      { enqueue: { send: sendMock, sendAfter: sendAfterMock } } as unknown as Parameters<typeof enqueueFoundationJob>[1],
    );

    expect(sendMock).toHaveBeenCalledWith(
      'foundation.health-check',
      { action: 'ping', correlationId: 'corr-123' },
      { singletonKey: 'corr-123' },
    );
  });

  it('stops the boss gracefully on shutdown', async () => {
    const worker = createWorker({
      createBoss: vi.fn(() => createBossMock()),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.stop();

    expect(stopMock).toHaveBeenCalledWith({ graceful: true, timeout: expect.any(Number) });
  });

  it('logs and rethrows stop failures', async () => {
    const error = new Error('stop failed');
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const worker = createWorker({
      createBoss: vi.fn(() => createBossMock({ stop: vi.fn().mockRejectedValue(error) })),
      logger,
    });

    await expect(worker.stop()).rejects.toThrow('stop failed');
    expect(logger.error).toHaveBeenCalledWith({ error }, 'Failed to stop pg-boss worker');
  });

  it('stops once even if shutdown is called multiple times and handles start failure cleanup', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const worker = createWorker({
      createBoss: vi.fn(() => createBossMock({ start: vi.fn().mockRejectedValue(new Error('start failed')), stop })),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await expect(worker.start()).rejects.toThrow('start failed');
    await worker.stop();
    await worker.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not stop twice during repeated shutdown', async () => {
    const worker = createWorker({
      createBoss: vi.fn(() => createBossMock()),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await worker.stop();
    await worker.stop();

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
