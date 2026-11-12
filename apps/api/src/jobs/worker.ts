import type { Job, JobWithMetadata } from 'pg-boss';
import type { Logger } from 'pino';

import {
  ACCOUNT_AUTO_SYNC_CRON,
  ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE,
  ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE,
  type AccountAutoSyncRequisitionJobPayload,
  ensureAccountAutoSyncRequisitionQueue,
  ensureAccountAutoSyncScheduleQueue,
  scheduleAccountAutoSyncJob,
} from '@app/jobs/account-auto-sync.queue';
import {
  handleAccountAutoSyncRequisitionJob,
  handleAccountAutoSyncScheduleJob,
} from '@app/jobs/account-auto-sync.worker';
import {
  ACCOUNT_INITIAL_SYNC_QUEUE,
  type AccountInitialSyncJobPayload,
  ensureAccountInitialSyncQueue,
} from '@app/jobs/account-initial-sync.queue';
import { handleAccountInitialSyncJob } from '@app/jobs/account-initial-sync.worker';
import { ACCOUNT_RECALCULATE_QUEUE, type AccountRecalculatePayload, ensureAccountRecalculateQueue } from '@app/jobs/account-recalculate.queue';
import {
  ANALYTICS_OUTBOX_CRON,
  ANALYTICS_OUTBOX_QUEUE,
  ensureAnalyticsOutboxQueue,
  scheduleAnalyticsOutboxJob,
} from '@app/jobs/analytics-outbox.queue';
import { handleAnalyticsOutboxJob } from '@app/jobs/analytics-outbox.worker';
import {
  API_TOKEN_EXPIRY_CRON,
  API_TOKEN_EXPIRY_QUEUE,
  ensureApiTokenExpiryQueue,
  scheduleApiTokenExpiryJob,
} from '@app/jobs/api-token-expiry.queue';
import {
  ASSET_PRICE_REFRESH_CRON,
  ASSET_PRICE_REFRESH_QUEUE,
  ensureAssetPriceRefreshQueue,
  scheduleAssetPriceRefreshJob,
} from '@app/jobs/asset-price-refresh.queue';
import {
  ASSISTANT_PROPOSAL_EXPIRY_CRON,
  ASSISTANT_PROPOSAL_EXPIRY_QUEUE,
  ensureAssistantProposalExpiryQueue,
  scheduleAssistantProposalExpiryJob,
} from '@app/jobs/assistant-proposal-expiry.queue';
import {
  BACKGROUND_OPERATION_RECOVERY_CRON,
  BACKGROUND_OPERATION_RECOVERY_QUEUE,
  ensureBackgroundOperationRecoveryQueue,
  scheduleBackgroundOperationRecoveryJob,
} from '@app/jobs/background-operation-recovery.queue';
import {
  BANK_RECOVERY_DISPATCH_QUEUE,
  ensureBankRecoveryDispatchQueue,
  unscheduleBankRecoveryDispatchJob,
} from '@app/jobs/bank-recovery-dispatch.queue';
import { handleBankRecoveryDispatchJob } from '@app/jobs/bank-recovery-dispatch.worker';
import { BANK_RECOVERY_QUEUE, ensureBankRecoveryQueue } from '@app/jobs/bank-recovery.queue';
import { handleBankRecoveryJob } from '@app/jobs/bank-recovery.worker';
import {
  BANK_SYNC_ALERT_SEND_QUEUE,
  BANK_SYNC_ALERT_SWEEP_CRON,
  BANK_SYNC_ALERT_SWEEP_QUEUE,
  ensureBankSyncAlertSendQueue,
  ensureBankSyncAlertSweepQueue,
  scheduleBankSyncAlertSweep,
} from '@app/jobs/bank-sync-alert.queue';
import {
  BUDGET_YEAR_EXTENSION_CRON,
  BUDGET_YEAR_EXTENSION_QUEUE,
  ensureBudgetYearExtensionQueue,
  scheduleBudgetYearExtensionJob,
} from '@app/jobs/budget-year-extension.queue';
import {
  CERTIFICADO_AFORRO_RATE_SYNC_CRON,
  CERTIFICADO_AFORRO_RATE_SYNC_MONITOR_SLUG,
  CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
  ensureCertificadoAforroRateSyncQueue,
  scheduleCertificadoAforroRateSyncAutoJob,
} from '@app/jobs/certificado-aforro-rate-sync.queue';
import {
  CREDIT_CARD_DUE_REMINDER_CRON,
  CREDIT_CARD_DUE_REMINDER_QUEUE,
  ensureCreditCardDueReminderQueue,
  scheduleCreditCardDueReminderJob,
} from '@app/jobs/credit-card-due-reminder.queue';
import { type CronMonitorOptions, withCronMonitor } from '@app/jobs/cron-monitor';
import {
  DATA_EXPORT_CLEANUP_QUEUE,
  DATA_EXPORT_QUEUE,
  type DataExportJobPayload,
  ensureDataExportCleanupQueue,
  ensureDataExportQueue,
} from '@app/jobs/data-export.queue';
import {
  DATA_RESTORE_CLEANUP_QUEUE,
  DATA_RESTORE_QUEUE,
  type DataRestoreCleanupJobPayload,
  type DataRestoreJobPayload,
  ensureDataRestoreCleanupQueue,
  ensureDataRestoreQueue,
} from '@app/jobs/data-restore.queue';
import { deadLetterQueueName, handleDeadLetterJob } from '@app/jobs/dead-letter';
import {
  DEMO_DATA_REFRESH_CRON,
  DEMO_DATA_REFRESH_QUEUE,
  ensureDemoDataRefreshQueue,
  scheduleDemoDataRefreshJob,
  unscheduleDemoDataRefreshJob,
} from '@app/jobs/demo-data-refresh.queue';
import {
  ensureExchangeRateRefreshQueue,
  EXCHANGE_RATE_REFRESH_CRON,
  EXCHANGE_RATE_REFRESH_QUEUE,
  scheduleExchangeRateRefreshJob,
} from '@app/jobs/exchange-rate-refresh.queue';
import {
  BUDGET_EMAIL_COORDINATOR_QUEUE,
  BUDGET_EMAIL_CRON,
  BUDGET_EMAIL_DELIVERY_QUEUE,
  ensureFinancialEmailQueues,
  FINANCIAL_EMAIL_QUEUES,
  FINANCIAL_EMAIL_TIME_ZONE,
  type FinancialEmailCoordinatorPayload,
  type FinancialEmailUserPayload,
  MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE,
  MONTHLY_STORY_EMAIL_CRON,
  MONTHLY_STORY_EMAIL_DELIVERY_QUEUE,
  scheduleBudgetEmails,
  scheduleWeeklyEmails,
  unscheduleBudgetEmails,
  unscheduleMonthlyStoryEmails,
  unscheduleWeeklyEmails,
  WEEKLY_EMAIL_COORDINATOR_QUEUE,
  WEEKLY_EMAIL_CRON,
  WEEKLY_EMAIL_DELIVERY_QUEUE,
} from '@app/jobs/financial-emails.queue';
import { ensureFxReconvertQueue, FX_RECONVERT_QUEUE, type FxReconvertPayload } from '@app/jobs/fx-reconvert.queue';
import {
  ensureHistoricalAssetPriceBackfillQueue,
  HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE,
} from '@app/jobs/historical-asset-price-backfill.queue';
import {
  ensureInstanceHeartbeatQueue,
  INSTANCE_HEARTBEAT_QUEUE,
  scheduleInstanceHeartbeatJob,
  sendInstanceHeartbeatNow,
} from '@app/jobs/instance-heartbeat.queue';
import { instrumentedBatch } from '@app/jobs/job-instrumentation';
import {
  ensurePortfolioCsvImportConfirmedQueue,
  PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE,
  type PortfolioCsvImportConfirmedJobPayload,
} from '@app/jobs/portfolio-csv-import-confirmed.queue';
import {
  ensurePortfolioCsvParsePreviewQueue,
  PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE,
  type PortfolioCsvParsePreviewJobPayload,
} from '@app/jobs/portfolio-csv-parse-preview.queue';
import {
  ensurePortfolioSnapshotAutoQueue,
  ensurePortfolioSnapshotManualQueue,
  PORTFOLIO_SNAPSHOT_AUTO_CRON,
  PORTFOLIO_SNAPSHOT_AUTO_QUEUE,
  PORTFOLIO_SNAPSHOT_MANUAL_QUEUE,
  schedulePortfolioSnapshotAutoJob,
} from '@app/jobs/portfolio-snapshot.queue';
import { ensureFoundationQueue, FOUNDATION_QUEUE } from '@app/jobs/queue';
import {
  ensureQueueDepthMonitorQueue,
  QUEUE_DEPTH_MONITOR_CRON,
  QUEUE_DEPTH_MONITOR_MONITOR_SLUG,
  QUEUE_DEPTH_MONITOR_QUEUE,
  scheduleQueueDepthMonitorJob,
} from '@app/jobs/queue-depth-monitor.queue';
import { handleQueueDepthMonitorJob } from '@app/jobs/queue-depth-monitor.worker';
import { removeRetiredQueues } from '@app/jobs/retired-queues';
import { ensureRuleApplyQueue, RULE_APPLY_QUEUE, type RuleApplyPayload } from '@app/jobs/rule-apply.queue';
import { handleTransactionEnrichmentDlqJob } from '@app/jobs/transaction-enrichment-dlq.worker';
import { ensureTransactionEnrichmentGptQueue, TRANSACTION_ENRICHMENT_GPT_DLQ, TRANSACTION_ENRICHMENT_GPT_QUEUE } from '@app/jobs/transaction-enrichment.queue';
import { handleTransactionEnrichmentGptJob } from '@app/jobs/transaction-enrichment.worker';
import {
  ensureTransactionImportQueue,
  ensureTransactionImportSweepQueue,
  scheduleTransactionImportSweep,
  TRANSACTION_IMPORT_QUEUE,
  TRANSACTION_IMPORT_SWEEP_CRON,
  TRANSACTION_IMPORT_SWEEP_QUEUE,
  type TransactionImportJobPayload,
} from '@app/jobs/transaction-import.queue';
import { type BackgroundOperationServiceDeps } from '@app/jobs/types';
import {
  ensureWorkerHeartbeatQueue,
  scheduleWorkerHeartbeatJob,
  unscheduleWorkerHeartbeatJob,
  WORKER_HEARTBEAT_CRON,
  WORKER_HEARTBEAT_QUEUE,
} from '@app/jobs/worker-heartbeat.queue';
import { handleWorkerHeartbeatJob } from '@app/jobs/worker-heartbeat.worker';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import backgroundOperationRecoveryService from '@service/operations/background-operation-recovery.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import { purgeExpiredOperationSecrets } from '@service/operations/operation-secret.service';
import { createWorkerEnqueueAdapter } from '@service/queue/enqueue';
import { createPgBossClient, type PgBossLike } from '@service/queue/pgboss-client';
import logger from '@utils/logger';

// allow: SIZE_OK - one composition root keeps queue setup and handler registration auditable together.

/**
 * === Shutdown budgets ===
 *
 * These were both 30 s — the inner `boss.stop({ timeout })` and the outer race in
 * `setupGracefulShutdown`. Equal budgets meant the one case that matters (a redeploy with
 * a long job in flight, i.e. pg-boss using its whole drain window) rejected the outer
 * race, abandoned `closeDatabase()`, and exited 1.
 *
 * They are now nested, and both sized to the real deadline: **Docker's default
 * `stop_grace_period` is 10 seconds**, after which the container is SIGKILLed regardless
 * of what this code intends. A 30 s drain was fiction — the worker was being killed
 * mid-job at 10 s either way. 6 s to drain, 8 s for the whole close, ~2 s of headroom
 * before SIGKILL.
 *
 * If Coolify is ever configured with a longer grace period, raise `SHUTDOWN_TIMEOUT_MS`
 * below — but raise the container's stop grace period *first*, or the larger number is
 * fiction again. It was an env override (`PGBOSS_DRAIN_TIMEOUT_MS`) that no environment ever
 * set; since changing the outer grace period is itself a deploy, a constant is the honest
 * place for the inner one.
 */
/**
 * Documented here so the numbers below are checkable against the constraint that produced
 * them. Exported and never imported on purpose — it is the *external* fact (Coolify's
 * container stop grace period) that the drain timeouts are derived from, and inlining it
 * into a comment would let the two drift silently. It is documentation rather than dead code.
 *
 * @public
 */
export const CONTAINER_STOP_GRACE_MS = 10_000;
/** Inner budget: how long pg-boss may spend draining in-flight handlers. */
const SHUTDOWN_TIMEOUT_MS = 6_000;
/** Outer budget: the whole `close()` (health server + pg-boss drain). Strictly larger than the inner one. */
export const WORKER_SHUTDOWN_TIMEOUT_MS = SHUTDOWN_TIMEOUT_MS + 2_000;
const schedulerEnabled = () => {
  const value = process.env['PGBOSS_SCHEDULE'];
  if (value === undefined) return false;

  return ['1', 'on', 'true', 'yes'].includes(value.toLowerCase());
};
const demoDataRefreshEnabled = () => process.env['ENABLE_PGBOSS_DEMO_DATA_REFRESH'] === 'true';
const demoDataRefreshFlagValue = () => process.env['ENABLE_PGBOSS_DEMO_DATA_REFRESH'];
// Only the scheduler owner that also has the external heartbeat URL configured
// (i.e. the prod worker) registers the ping; everywhere else it stays dormant.
const workerHeartbeatEnabled = () => Boolean(process.env['HETRIX_WORKER_HEARTBEAT_URL']?.trim());

interface WorkerDeps {
  backgroundOperationService?: BackgroundOperationServiceDeps;
  createBoss?: () => PgBossLike;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  runInRequestContext?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export const createWorker = (deps: WorkerDeps = {}) => {
  const boss = deps.createBoss?.() ?? createPgBossClient();
  const enqueue = createWorkerEnqueueAdapter(boss);
  // Handlers typed against `BackgroundOperationServiceDeps` receive this resolved seam.
  // The four handlers that declare the concrete `backgroundOperationService` instance in
  // their dependency type (a nominal class with private members) cannot accept this
  // structural value and are wired to the real service directly.
  const backgroundOperationServiceImpl: BackgroundOperationServiceDeps =
    deps.backgroundOperationService ?? backgroundOperationService;
  const log = deps.logger ?? logger;
  const runInRequestContext =
    deps.runInRequestContext ??
    (async <T>(fn: () => Promise<T>) => {
      const [{ DI }, { RequestContext: MikroRequestContext }] = await Promise.all([
        import('@app/database/di'),
        import('@mikro-orm/core'),
      ]);
      return MikroRequestContext.create(DI.em, fn);
    });
  let stopping = false;
  let running = false;

  /**
   * Wraps a single-job handler so every rejection reaches Sentry before pg-boss swallows
   * it. `boss.on('error')` below only fires for pg-boss's *internal* errors — a thrown
   * handler never reaches it, which is how a queue could fail every job for days with
   * nothing but a stdout line to show for it. See `job-instrumentation.ts`.
   */
  const workJobs = <TJob extends { data?: unknown; id: string }>(queue: string, run: (job: TJob) => Promise<unknown>) =>
    instrumentedBatch<TJob>(queue, run);

  /**
   * As `workJobs`, plus a Sentry cron check-in.
   *
   * A schedule that stops firing produces *silence*, and silence is indistinguishable
   * from success — so the failure has no signal at all unless something expects a
   * check-in and complains when it does not arrive. That matters here more than usual:
   * every schedule registration below is conditional on `schedulerEnabled()` reading
   * `PGBOSS_SCHEDULE`, so one mistyped Coolify env var silently stops **every** cron in
   * the system while `/health` stays green.
   */
  const workCronJobs = <TJob extends { data?: unknown; id: string }>(
    queue: string,
    monitor: CronMonitorOptions,
    run: (job: TJob) => Promise<unknown>,
  ) => instrumentedBatch<TJob>(queue, (job) => withCronMonitor(monitor, () => run(job)));

  /** Queues whose exhausted jobs are copied to a dead-letter queue this worker consumes. */
  const deadLetteredQueues = [
    ...FINANCIAL_EMAIL_QUEUES,
    BANK_RECOVERY_QUEUE,
    BANK_SYNC_ALERT_SEND_QUEUE,
  ];

  const start = async () => {
    boss.on('error', (error: unknown) => {
      log.error({ error }, 'pg-boss worker error');
    });

    await boss.start();
    await ensureFoundationQueue(boss);
    await ensureAccountInitialSyncQueue(boss);
    await ensureBankRecoveryQueue(boss);
    await ensureBankRecoveryDispatchQueue(boss);
    await ensureDataExportQueue(boss);
    await ensureDataExportCleanupQueue(boss);
    await ensureDataRestoreQueue(boss);
    await ensureDataRestoreCleanupQueue(boss);
    await ensureTransactionImportQueue(boss);
    await ensureTransactionImportSweepQueue(boss);
    await ensurePortfolioCsvImportConfirmedQueue(boss);
    await ensurePortfolioCsvParsePreviewQueue(boss);
    await ensurePortfolioSnapshotAutoQueue(boss);
    await ensurePortfolioSnapshotManualQueue(boss);
    await ensureAccountAutoSyncScheduleQueue(boss);
    await ensureAccountAutoSyncRequisitionQueue(boss);
    await ensureAnalyticsOutboxQueue(boss);
    await ensureBackgroundOperationRecoveryQueue(boss);
    await ensureAssetPriceRefreshQueue(boss);
    await ensureDemoDataRefreshQueue(boss);
    await ensureExchangeRateRefreshQueue(boss);
    await ensureFxReconvertQueue(boss);
    await ensureRuleApplyQueue(boss);
    await ensureAccountRecalculateQueue(boss);
    await ensureHistoricalAssetPriceBackfillQueue(boss);
    await ensureCertificadoAforroRateSyncQueue(boss);
    await ensureBudgetYearExtensionQueue(boss);
    await ensureApiTokenExpiryQueue(boss);
    await ensureAssistantProposalExpiryQueue(boss);
    await ensureWorkerHeartbeatQueue(boss);
    await ensureInstanceHeartbeatQueue(boss);
    // monthlyStory ships unconditionally (no feature flag), so its queues must always exist —
    // budget/weekly queue creation piggybacks on the same call since ensureFinancialEmailQueues
    // is idempotent and gating it behind the budget/weekly flags would leave the monthly-story
    // queues uncreated (and boss.work() below would throw "Queue does not exist") whenever both
    // legacy streams are disabled.
    await ensureFinancialEmailQueues(boss);
    await ensureBankSyncAlertSweepQueue(boss);
    await ensureBankSyncAlertSendQueue(boss);
    await ensureCreditCardDueReminderQueue(boss);
    await ensureTransactionEnrichmentGptQueue(boss);
    await ensureQueueDepthMonitorQueue(boss);
    if (schedulerEnabled()) {
      const demoRefreshOwnerEnabled = demoDataRefreshEnabled();
      await unscheduleDemoDataRefreshJob(boss, log);
      // Schedules and queues of retired features from earlier deploys — see retired-queues.ts.
      await removeRetiredQueues(boss);
      if (!demoRefreshOwnerEnabled) {
        log.warn(
          { env: demoDataRefreshFlagValue(), queue: DEMO_DATA_REFRESH_QUEUE, scheduleOwner: false },
          'demo data refresh schedule owner env is missing or false; demo-data.refresh schedule will not be registered',
        );
      }
      await scheduleAccountAutoSyncJob(boss);
      // The one check that notices a queue which stopped draining, whatever the cause.
      await scheduleQueueDepthMonitorJob(boss);
      await scheduleAnalyticsOutboxJob(boss);
      await scheduleBackgroundOperationRecoveryJob(boss);
      // Paused as part of the free/BYOK pivot — chasing incomplete bank connections to pull more
      // hosted financial data contradicts the cost-driven reason for this pivot. Revert this one
      // line if there's a support-ticket-reduction reason to keep it (flagged for founder review).
      await unscheduleBankRecoveryDispatchJob(boss);
      await scheduleAssetPriceRefreshJob(boss);
      if (demoRefreshOwnerEnabled) {
        await scheduleDemoDataRefreshJob(boss);
        log.info({ queue: DEMO_DATA_REFRESH_QUEUE, scheduleOwner: true }, 'demo data refresh schedule registered');
      }
      await scheduleExchangeRateRefreshJob(boss);
      await schedulePortfolioSnapshotAutoJob(boss);
      await scheduleCertificadoAforroRateSyncAutoJob(boss);
      await scheduleBudgetYearExtensionJob(boss);
      await scheduleApiTokenExpiryJob(boss);
      await scheduleAssistantProposalExpiryJob(boss);
      // Unschedule-then-conditionally-schedule keeps the schedule from drifting
      // when the heartbeat URL is added or removed between deploys.
      await unscheduleWorkerHeartbeatJob(boss);
      if (workerHeartbeatEnabled()) await scheduleWorkerHeartbeatJob(boss);
      // What `GET /v1/health/ready` reads to tell whether the worker still finishes jobs.
      await scheduleInstanceHeartbeatJob(boss);
      await scheduleBankSyncAlertSweep(boss);
      await scheduleTransactionImportSweep(boss);
      await scheduleCreditCardDueReminderJob(boss);
      await unscheduleBudgetEmails(boss);
      await unscheduleWeeklyEmails(boss);
      await scheduleBudgetEmails(boss);
      await scheduleWeeklyEmails(boss);
      // Paused as part of the free/BYOK pivot — marketing lifecycle emails are stopped. No feature
      // flag ever gated Monthly Money Story, so an explicit unschedule call is required here to
      // tear down the recurring pg-boss schedule a prior deploy registered; simply removing the
      // `schedule(...)` call below would leave that schedule firing forever.
      await unscheduleMonthlyStoryEmails(boss);
    }

    await boss.work<{ correlationId?: string; payload?: Record<string, unknown> }>(
      FOUNDATION_QUEUE,
      workJobs<Job<{ correlationId?: string; payload?: Record<string, unknown> }>>(FOUNDATION_QUEUE, async (job) => {
        const correlationId = job.data.correlationId;
        if (!correlationId) {
          log.warn({ jobId: job.id, queue: FOUNDATION_QUEUE }, 'Foundation worker job missing correlation id');
          return;
        }

        const claimed = await backgroundOperationServiceImpl.claimJobStart(correlationId, job.id);
        if (!claimed) {
          log.warn(
            { correlationId, jobId: job.id, queue: FOUNDATION_QUEUE },
            'Foundation worker job already claimed',
          );
          return;
        }

        await backgroundOperationServiceImpl.finishJob(correlationId, job.id, {
          retryable: false,
          stage: 'foundation:complete',
          status: BackgroundOperationStatus.SUCCEEDED,
        });
        log.info({ correlationId, jobId: job.id, queue: FOUNDATION_QUEUE }, 'Foundation worker job completed');
      }),
    );

    await boss.work<AccountInitialSyncJobPayload>(
      ACCOUNT_INITIAL_SYNC_QUEUE,
      { includeMetadata: true },
      workJobs<JobWithMetadata<AccountInitialSyncJobPayload>>(ACCOUNT_INITIAL_SYNC_QUEUE, (job) =>
        runInRequestContext(() =>
          handleAccountInitialSyncJob(job, {
            backgroundOperationService: backgroundOperationServiceImpl,
            boss,
            enqueue,
            logger: log,
          }),
        ),
      ),
    );

    await boss.work(
      BANK_RECOVERY_QUEUE,
      { includeMetadata: true },
      workJobs<JobWithMetadata<unknown>>(BANK_RECOVERY_QUEUE, (job) =>
        runInRequestContext(() => handleBankRecoveryJob(job, { logger: log })),
      ),
    );

    await boss.work(BANK_RECOVERY_DISPATCH_QUEUE, workJobs<Job<unknown>>(BANK_RECOVERY_DISPATCH_QUEUE, () =>
      runInRequestContext(() => handleBankRecoveryDispatchJob(boss)),
    ));

    await boss.work<DataExportJobPayload>(
      DATA_EXPORT_QUEUE,
      workJobs<Job<DataExportJobPayload>>(DATA_EXPORT_QUEUE, async (job) => {
        const { handleDataExportJob } = await import('@app/jobs/data-export.worker');
        await runInRequestContext(() => handleDataExportJob(job, { enqueue }));
      }),
    );

    await boss.work<DataExportJobPayload>(
      DATA_EXPORT_CLEANUP_QUEUE,
      workJobs<Job<DataExportJobPayload>>(DATA_EXPORT_CLEANUP_QUEUE, async (job) => {
        const { handleDataExportCleanupJob } = await import('@app/jobs/data-export.worker');
        await runInRequestContext(() => handleDataExportCleanupJob(job, { enqueue }));
      }),
    );

    await boss.work<DataRestoreJobPayload>(
      DATA_RESTORE_QUEUE,
      workJobs<Job<DataRestoreJobPayload>>(DATA_RESTORE_QUEUE, async (job) => {
        const { handleDataRestoreJob } = await import('@app/jobs/data-restore.worker');
        await runInRequestContext(() => handleDataRestoreJob(job, { enqueue }));
      }),
    );

    await boss.work<DataRestoreCleanupJobPayload>(
      DATA_RESTORE_CLEANUP_QUEUE,
      workJobs<Job<DataRestoreCleanupJobPayload>>(DATA_RESTORE_CLEANUP_QUEUE, async (job) => {
        const { handleDataRestoreCleanupJob } = await import('@app/jobs/data-restore.worker');
        await runInRequestContext(() => handleDataRestoreCleanupJob(job, { enqueue }));
      }),
    );

    await boss.work<TransactionImportJobPayload>(
      TRANSACTION_IMPORT_QUEUE,
      workJobs<Job<TransactionImportJobPayload>>(TRANSACTION_IMPORT_QUEUE, async (job) => {
        const { handleTransactionImportJob } = await import('@app/jobs/transaction-import.worker');
        await runInRequestContext(() => handleTransactionImportJob(job, { enqueue }));
      }),
    );

    await boss.work<PortfolioCsvImportConfirmedJobPayload>(
      PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE,
      workJobs<Job<PortfolioCsvImportConfirmedJobPayload>>(PORTFOLIO_CSV_IMPORT_CONFIRMED_QUEUE, async (job) => {
        const { handlePortfolioCsvImportConfirmedJob } = await import('@app/jobs/portfolio-csv-import-confirmed.worker');
        await runInRequestContext(() => handlePortfolioCsvImportConfirmedJob(job, { enqueue }));
      }),
    );

    await boss.work<PortfolioCsvParsePreviewJobPayload>(
      PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE,
      workJobs<Job<PortfolioCsvParsePreviewJobPayload>>(PORTFOLIO_CSV_PARSE_PREVIEW_QUEUE, async (job) => {
        const { handlePortfolioCsvParsePreviewJob } = await import('@app/jobs/portfolio-csv-parse-preview.worker');
        await runInRequestContext(() => handlePortfolioCsvParsePreviewJob(job));
      }),
    );

    await boss.work<{ correlationId?: string }>(
      ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE,
      { includeMetadata: true },
      workCronJobs<JobWithMetadata<{ correlationId?: string }>>(
        ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE,
        { checkinMarginMinutes: 60, maxRuntimeMinutes: 60, monitorSlug: ACCOUNT_AUTO_SYNC_SCHEDULE_QUEUE, schedule: ACCOUNT_AUTO_SYNC_CRON },
        (job) =>
          runInRequestContext(() =>
            handleAccountAutoSyncScheduleJob(job, {
              backgroundOperationService: backgroundOperationServiceImpl,
              boss,
              logger: log,
              schedulerService: undefined,
            }),
          ),
      ),
    );

    await boss.work<{ correlationId?: string }>(
      ASSET_PRICE_REFRESH_QUEUE,
      workCronJobs<Job<{ correlationId?: string }>>(
        ASSET_PRICE_REFRESH_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 60, monitorSlug: ASSET_PRICE_REFRESH_QUEUE, schedule: ASSET_PRICE_REFRESH_CRON },
        async (job) => {
          const { handleAssetPriceRefreshJob } = await import('@app/jobs/asset-price-refresh.worker');
          await runInRequestContext(() =>
            handleAssetPriceRefreshJob(job, { backgroundOperationService: backgroundOperationServiceImpl }),
          );
        },
      ),
    );

    await boss.work<{ correlationId?: string }>(
      EXCHANGE_RATE_REFRESH_QUEUE,
      workCronJobs<Job<{ correlationId?: string }>>(
        EXCHANGE_RATE_REFRESH_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: EXCHANGE_RATE_REFRESH_QUEUE, schedule: EXCHANGE_RATE_REFRESH_CRON },
        async (job) => {
          const { handleExchangeRateRefreshJob } = await import('@app/jobs/exchange-rate-refresh.worker');
          await runInRequestContext(() =>
            handleExchangeRateRefreshJob(job, { backgroundOperationService, enqueue }),
          );
        },
      ),
    );

    await boss.work<Partial<RuleApplyPayload>>(
      RULE_APPLY_QUEUE,
      { includeMetadata: true },
      workJobs<JobWithMetadata<Partial<RuleApplyPayload>>>(RULE_APPLY_QUEUE, async (job) => {
        const { handleRuleApplyJob } = await import('@app/jobs/rule-apply.worker');
        await runInRequestContext(() => handleRuleApplyJob(job));
      }),
    );

    await boss.work<Partial<AccountRecalculatePayload>>(
      ACCOUNT_RECALCULATE_QUEUE,
      { includeMetadata: true },
      workJobs<JobWithMetadata<Partial<AccountRecalculatePayload>>>(ACCOUNT_RECALCULATE_QUEUE, async (job) => {
        const { handleAccountRecalculateJob } = await import('@app/jobs/account-recalculate.worker');
        await runInRequestContext(() => handleAccountRecalculateJob(job));
      }),
    );

    await boss.work<Partial<FxReconvertPayload>>(
      FX_RECONVERT_QUEUE,
      workJobs<Job<Partial<FxReconvertPayload>>>(FX_RECONVERT_QUEUE, async (job) => {
        const { handleFxReconvertJob } = await import('@app/jobs/fx-reconvert.worker');
        await runInRequestContext(() => handleFxReconvertJob(job));
      }),
    );

    await boss.work<{ asOfDate?: string; correlationId?: string; dryRun?: boolean }>(
      DEMO_DATA_REFRESH_QUEUE,
      workCronJobs<Job<{ asOfDate?: string; correlationId?: string; dryRun?: boolean }>>(
        DEMO_DATA_REFRESH_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: DEMO_DATA_REFRESH_QUEUE, schedule: DEMO_DATA_REFRESH_CRON },
        async (job) => {
          const { handleDemoDataRefreshJob } = await import('@app/jobs/demo-data-refresh.worker');
          await runInRequestContext(() => handleDemoDataRefreshJob(job, {}));
        },
      ),
    );

    await boss.work<{ correlationId?: string; items?: never[]; portfolioId?: number }>(
      HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE,
      workJobs<Job<{ correlationId?: string; items?: never[]; portfolioId?: number }>>(HISTORICAL_ASSET_PRICE_BACKFILL_QUEUE, async (job) => {
        const { handleHistoricalAssetPriceBackfillJob } =
          await import('@app/jobs/historical-asset-price-backfill.worker');
        await runInRequestContext(() =>
          handleHistoricalAssetPriceBackfillJob(job, {
            backgroundOperationService,
          }),
        );
      }),
    );

    await boss.work<{ correlationId?: string; cursor?: number }>(
      PORTFOLIO_SNAPSHOT_AUTO_QUEUE,
      workCronJobs<Job<{ correlationId?: string; cursor?: number }>>(
        PORTFOLIO_SNAPSHOT_AUTO_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: PORTFOLIO_SNAPSHOT_AUTO_QUEUE, schedule: PORTFOLIO_SNAPSHOT_AUTO_CRON },
        async (job) => {
          const { handlePortfolioSnapshotAutoJob } = await import('@app/jobs/portfolio-snapshot.worker');
          await runInRequestContext(() =>
            // `boss` is supplied so a full page can chain the next one; without it the
            // sweep silently stops after the first page.
            handlePortfolioSnapshotAutoJob(job, {
              backgroundOperationService: backgroundOperationServiceImpl,
              boss,
            }),
          );
        },
      ),
    );

    await boss.work<{ correlationId: string; portfolioId: number }>(
      PORTFOLIO_SNAPSHOT_MANUAL_QUEUE,
      workJobs<Job<{ correlationId: string; portfolioId: number }>>(PORTFOLIO_SNAPSHOT_MANUAL_QUEUE, async (job) => {
        const { handlePortfolioSnapshotManualJob } = await import('@app/jobs/portfolio-snapshot.worker');
        await runInRequestContext(() =>
          handlePortfolioSnapshotManualJob(job, {
            backgroundOperationService: backgroundOperationServiceImpl,
          }),
        );
      }),
    );

    await boss.work<Record<string, never>>(
      CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
      // Monthly-cadence data behind a daily poll: nobody would notice this
      // schedule going missing until a Certificado valuation was already stale.
      // See cron-monitor.ts for why this is needed on top of the worker heartbeat.
      workCronJobs<Job<Record<string, never>>>(
        CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
        { monitorSlug: CERTIFICADO_AFORRO_RATE_SYNC_MONITOR_SLUG, schedule: CERTIFICADO_AFORRO_RATE_SYNC_CRON },
        async (job) => {
          const { handleCertificadoAforroRateSyncAutoJob } = await import('@app/jobs/certificado-aforro-rate-sync.worker');
          await runInRequestContext(() => handleCertificadoAforroRateSyncAutoJob(job));
        },
      ),
    );

    await boss.work<Record<string, never>>(
      BUDGET_YEAR_EXTENSION_QUEUE,
      // Once a year: a schedule that silently stopped would only show on 1 January.
      workCronJobs<Job<Record<string, never>>>(
        BUDGET_YEAR_EXTENSION_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: BUDGET_YEAR_EXTENSION_QUEUE, schedule: BUDGET_YEAR_EXTENSION_CRON },
        async (job) => {
          const { handleBudgetYearExtensionJob } = await import('@app/jobs/budget-year-extension.worker');
          await runInRequestContext(() => handleBudgetYearExtensionJob(job, { logger: log }));
        },
      ),
    );

    await boss.work<Record<string, never>>(
      API_TOKEN_EXPIRY_QUEUE,
      workCronJobs<Job<Record<string, never>>>(
        API_TOKEN_EXPIRY_QUEUE,
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: API_TOKEN_EXPIRY_QUEUE, schedule: API_TOKEN_EXPIRY_CRON },
        async (job) => {
          const { handleApiTokenExpiryReminderJob } = await import('@app/jobs/api-token-expiry.worker');
          await runInRequestContext(() => handleApiTokenExpiryReminderJob(job, { logger: log }));
        },
      ),
    );

    await boss.work<Record<string, never>>(
      ASSISTANT_PROPOSAL_EXPIRY_QUEUE,
      workCronJobs<Job<Record<string, never>>>(
        ASSISTANT_PROPOSAL_EXPIRY_QUEUE,
        { checkinMarginMinutes: 30, maxRuntimeMinutes: 10, monitorSlug: ASSISTANT_PROPOSAL_EXPIRY_QUEUE, schedule: ASSISTANT_PROPOSAL_EXPIRY_CRON },
        async (job) => {
          const { handleAssistantProposalExpiryJob } = await import('@app/jobs/assistant-proposal-expiry.worker');
          await runInRequestContext(() => handleAssistantProposalExpiryJob(job, { logger: log }));
        },
      ),
    );

    await boss.work(BANK_SYNC_ALERT_SWEEP_QUEUE, workCronJobs<Job<unknown>>(
      BANK_SYNC_ALERT_SWEEP_QUEUE,
      { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: BANK_SYNC_ALERT_SWEEP_QUEUE, schedule: BANK_SYNC_ALERT_SWEEP_CRON },
      async () => {
        const { handleBankSyncAlertSweepJob } = await import('@app/jobs/bank-sync-alert.worker');
        await runInRequestContext(() => handleBankSyncAlertSweepJob({ enqueue, logger: log }));
      },
    ));
    await boss.work(TRANSACTION_IMPORT_SWEEP_QUEUE, workCronJobs<Job<unknown>>(
      TRANSACTION_IMPORT_SWEEP_QUEUE,
      { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: TRANSACTION_IMPORT_SWEEP_QUEUE, schedule: TRANSACTION_IMPORT_SWEEP_CRON },
      async () => {
        const { handleTransactionImportSweepJob } = await import('@app/jobs/transaction-import.worker');
        await runInRequestContext(() => handleTransactionImportSweepJob({ logger: log }));
      },
    ));
    await boss.work(BANK_SYNC_ALERT_SEND_QUEUE, workJobs<Job<unknown>>(BANK_SYNC_ALERT_SEND_QUEUE, async (job) => {
      const { handleBankSyncAlertSendJob } = await import('@app/jobs/bank-sync-alert.worker');
      await runInRequestContext(() => handleBankSyncAlertSendJob(job, { logger: log }));
    }));
    await boss.work(CREDIT_CARD_DUE_REMINDER_QUEUE, workCronJobs<Job<unknown>>(
      CREDIT_CARD_DUE_REMINDER_QUEUE,
      { checkinMarginMinutes: 120, maxRuntimeMinutes: 30, monitorSlug: CREDIT_CARD_DUE_REMINDER_QUEUE, schedule: CREDIT_CARD_DUE_REMINDER_CRON },
      async () => {
        const { handleCreditCardDueReminderJob } = await import('@app/jobs/credit-card-due-reminder.worker');
        await runInRequestContext(() => handleCreditCardDueReminderJob({ logger: log }));
      },
    ));

    if (schedulerEnabled()) {
      await boss.work(BUDGET_EMAIL_COORDINATOR_QUEUE, { includeMetadata: true }, workCronJobs<JobWithMetadata<Partial<FinancialEmailCoordinatorPayload>>>(
        BUDGET_EMAIL_COORDINATOR_QUEUE,
        // The financial-email crons are the only schedules in this system with a non-UTC
        // `tz`; a monitor told the wrong timezone alerts spuriously twice a year.
        { checkinMarginMinutes: 120, maxRuntimeMinutes: 60, monitorSlug: BUDGET_EMAIL_COORDINATOR_QUEUE, schedule: BUDGET_EMAIL_CRON, timezone: FINANCIAL_EMAIL_TIME_ZONE },
        async (job) => {
          const { handleBudgetEmailCoordinator } = await import('@app/jobs/financial-emails.worker');
          await runInRequestContext(() => handleBudgetEmailCoordinator(job, boss));
        },
      ));
    }
    if (schedulerEnabled()) {
      await boss.work(WEEKLY_EMAIL_COORDINATOR_QUEUE, { includeMetadata: true }, workCronJobs<JobWithMetadata<Partial<FinancialEmailCoordinatorPayload>>>(
        WEEKLY_EMAIL_COORDINATOR_QUEUE,
        { checkinMarginMinutes: 180, maxRuntimeMinutes: 60, monitorSlug: WEEKLY_EMAIL_COORDINATOR_QUEUE, schedule: WEEKLY_EMAIL_CRON, timezone: FINANCIAL_EMAIL_TIME_ZONE },
        async (job) => {
          const { handleWeeklyEmailCoordinator } = await import('@app/jobs/financial-emails.worker');
          await runInRequestContext(() => handleWeeklyEmailCoordinator(job, boss));
        },
      ));
    }
    await boss.work(BUDGET_EMAIL_DELIVERY_QUEUE, workJobs<Job<FinancialEmailUserPayload>>(BUDGET_EMAIL_DELIVERY_QUEUE, async (job) => {
      const { handleFinancialEmailUser } = await import('@app/jobs/financial-emails.worker');
      await runInRequestContext(() => handleFinancialEmailUser(job, 'budget'));
    }));
    await boss.work(WEEKLY_EMAIL_DELIVERY_QUEUE, workJobs<Job<FinancialEmailUserPayload>>(WEEKLY_EMAIL_DELIVERY_QUEUE, async (job) => {
      const { handleFinancialEmailUser } = await import('@app/jobs/financial-emails.worker');
      await runInRequestContext(() => handleFinancialEmailUser(job, 'weekly'));
    }));

    // No feature flag: Monthly Money Story's coordinator (scheduler-gated, like every other
    // cron-triggered coordinator) and delivery consumer (always-on, like every other queue
    // consumer) ship unconditionally wherever this worker runs.
    if (schedulerEnabled()) {
      await boss.work(MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, { includeMetadata: true }, workCronJobs<JobWithMetadata<Partial<FinancialEmailCoordinatorPayload>>>(
        MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE,
        { checkinMarginMinutes: 360, maxRuntimeMinutes: 60, monitorSlug: MONTHLY_STORY_EMAIL_COORDINATOR_QUEUE, schedule: MONTHLY_STORY_EMAIL_CRON, timezone: FINANCIAL_EMAIL_TIME_ZONE },
        async (job) => {
          const { handleMonthlyStoryEmailCoordinator } = await import('@app/jobs/financial-emails.worker');
          await runInRequestContext(() => handleMonthlyStoryEmailCoordinator(job, boss));
        },
      ));
    }
    await boss.work(MONTHLY_STORY_EMAIL_DELIVERY_QUEUE, workJobs<Job<FinancialEmailUserPayload>>(MONTHLY_STORY_EMAIL_DELIVERY_QUEUE, async (job) => {
      const { handleFinancialEmailUser } = await import('@app/jobs/financial-emails.worker');
      await runInRequestContext(() => handleFinancialEmailUser(job, 'monthlyStory'));
    }));

    await boss.work(
      ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE,
      { includeMetadata: true },
      workJobs<JobWithMetadata<AccountAutoSyncRequisitionJobPayload>>(
        ACCOUNT_AUTO_SYNC_REQUISITION_QUEUE,
        (job) =>
          runInRequestContext(() =>
            handleAccountAutoSyncRequisitionJob(job, {
              backgroundOperationService: backgroundOperationServiceImpl,
              enqueue,
              logger: log,
            }),
          ),
      ),
    );

    await boss.work(BACKGROUND_OPERATION_RECOVERY_QUEUE, workCronJobs<Job<unknown>>(
      BACKGROUND_OPERATION_RECOVERY_QUEUE,
      { checkinMarginMinutes: 30, maxRuntimeMinutes: 15, monitorSlug: BACKGROUND_OPERATION_RECOVERY_QUEUE, schedule: BACKGROUND_OPERATION_RECOVERY_CRON },
      async () => {
        try {
          const summary = await runInRequestContext(() =>
            backgroundOperationRecoveryService.recoverOnce({ boss, logger: log }),
          );
          // One-time secrets (a data export password) left behind by an operation that never read them.
          const purgedSecrets = await runInRequestContext(() => purgeExpiredOperationSecrets());
          log.info({ purgedSecrets, queue: BACKGROUND_OPERATION_RECOVERY_QUEUE, summary }, 'Background operation recovery completed');
        } catch (error) {
          log.error({ error, queue: BACKGROUND_OPERATION_RECOVERY_QUEUE }, 'Background operation recovery failed');
          throw error;
        }
      },
    ));

    await boss.work(ANALYTICS_OUTBOX_QUEUE, workCronJobs<Job<unknown>>(
      ANALYTICS_OUTBOX_QUEUE,
      // Once a minute. A tight margin here is the point: this is the queue whose silence
      // means product analytics stopped flowing.
      { checkinMarginMinutes: 10, maxRuntimeMinutes: 5, monitorSlug: ANALYTICS_OUTBOX_QUEUE, schedule: ANALYTICS_OUTBOX_CRON },
      async () => {
        const summary = await runInRequestContext(() => handleAnalyticsOutboxJob({ logger: log }));
        log.info({ queue: ANALYTICS_OUTBOX_QUEUE, summary }, 'Analytics outbox delivery completed');
      },
    ));

    await boss.work(QUEUE_DEPTH_MONITOR_QUEUE, workCronJobs<Job<unknown>>(
      QUEUE_DEPTH_MONITOR_QUEUE,
      { checkinMarginMinutes: 15, maxRuntimeMinutes: 5, monitorSlug: QUEUE_DEPTH_MONITOR_MONITOR_SLUG, schedule: QUEUE_DEPTH_MONITOR_CRON },
      () => runInRequestContext(() => handleQueueDepthMonitorJob({ logger: log })),
    ));

    // No RequestContext needed: the heartbeat only makes an outbound HTTP ping.
    await boss.work(WORKER_HEARTBEAT_QUEUE, workCronJobs<Job<unknown>>(
      WORKER_HEARTBEAT_QUEUE,
      { checkinMarginMinutes: 10, maxRuntimeMinutes: 2, monitorSlug: WORKER_HEARTBEAT_QUEUE, schedule: WORKER_HEARTBEAT_CRON },
      () => handleWorkerHeartbeatJob({ logger: log }),
    ));

    // Does nothing: pg-boss recording the completion is the whole point (instance-heartbeat.queue.ts).
    await boss.work(INSTANCE_HEARTBEAT_QUEUE, workJobs<Job<unknown>>(INSTANCE_HEARTBEAT_QUEUE, () => Promise.resolve()));

    await boss.work(TRANSACTION_ENRICHMENT_GPT_QUEUE, { includeMetadata: true }, workJobs<JobWithMetadata<unknown>>(
      TRANSACTION_ENRICHMENT_GPT_QUEUE, (job) => runInRequestContext(() => handleTransactionEnrichmentGptJob(job, { logger: log })),
    ));

    // The system's only dead-letter queue had no consumer and no alert: poisoned
    // enrichment jobs parked silently until retention deleted them, and the only visible
    // trace was `TransactionEnrichment` rows stuck non-terminal that nothing queried.
    await boss.work(TRANSACTION_ENRICHMENT_GPT_DLQ, workJobs<Job<unknown>>(
      TRANSACTION_ENRICHMENT_GPT_DLQ, (job) => runInRequestContext(() => handleTransactionEnrichmentDlqJob(job, { logger: log })),
    ));

    // One generic consumer per dead-letter queue, so an exhausted email job raises an
    // alert carrying its origin queue instead of disappearing into retention.
    for (const originQueue of deadLetteredQueues) {
      const dlq = deadLetterQueueName(originQueue);
      await boss.work(dlq, workJobs<Job<unknown>>(dlq, (job) => handleDeadLetterJob(originQueue, job, { logger: log })));
    }

    // After the consumer is registered, so it is picked up straight away.
    if (schedulerEnabled()) await sendInstanceHeartbeatNow(boss);

    running = true;
    log.info({ queue: FOUNDATION_QUEUE }, 'pg-boss worker started');
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    running = false;

    log.info({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Stopping pg-boss worker');
    try {
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
    } catch (error) {
      log.error({ error }, 'Failed to stop pg-boss worker');
      throw error;
    }
  };

  /** Feeds the worker `/health` endpoint: true once every queue handler is registered. */
  const isRunning = () => running;

  return { boss, isRunning, start, stop };
};
