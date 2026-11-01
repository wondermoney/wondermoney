import * as Sentry from '@sentry/node';
import type { JobWithMetadata } from 'pg-boss';
import type { Logger } from 'pino';

import { normalizeBankSyncError } from '@app/analytics/bank-sync-contract';
import { type AccountAutoSyncRequisitionJobPayload, buildAccountAutoSyncRequisitionCorrelationId } from '@app/jobs/account-auto-sync.queue';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import schedulerService from '@service/account/account-auto-sync-scheduler.service';
import accountInitialSyncAccountService from '@service/account/account-initial-sync-account.service';
import accountInitialSyncTransactionService from '@service/account/account-initial-sync-transaction.service';
import {
  classifyBankSyncError,
  runBankSyncPhases,
  safeAccountCount,
  safeInstitutionId,
} from '@service/bank-sync-run/bank-sync-run';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { enableBankingCredentialService } from '@service/enable-banking/enable-banking-credential.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossLike } from '@service/queue/pgboss-client';
import { EnableBankingCredentialInvalidError } from '@utils/errors';

interface BgDeps {
  attachQueueJob: (correlationId: string, queueJobId: string) => Promise<boolean>;
  claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>;
  createQueuedOperation: (input: { correlationId: string; operationType: string; resourceId: string }) => Promise<unknown>;
  finishJob: (correlationId: string, queueJobId: string, input: { retryable?: boolean; stage?: string; status: BackgroundOperationStatus }) => Promise<boolean>;
  heartbeatJob: (correlationId: string, queueJobId: string, input: { progress?: Record<string, unknown>; stage?: string }) => Promise<boolean>;
  markAttemptFailedForRetry: (correlationId: string, queueJobId: string, input: { errorCode?: string; stage?: string }) => Promise<boolean>;
}

interface IncidentDeps {
  assertIncident: (input: { correlationId: string; flow: 'scheduled-refresh'; incidentId: string; producer: 'pgboss-scheduled'; requisitionId: string; userVisible: false }) => Promise<unknown>;
  completeOrAllocateLegacyIncident?: BankSyncIncidentService['completeOrAllocateLegacyIncident'];
  finalizeAttempt: (input: { accountCount?: number; attempt: number; errorCategory?: string; errorCode?: string; final: boolean; incidentId: string; institutionId?: string; result: 'failed' | 'full_success' | 'partial'; treatmentEligible: false }) => Promise<unknown>;
  startAttempt: (input: { incidentId: string; queueAttempt: number; queueJobId: string }) => Promise<{ attempt: number; completedAt?: Date; final?: boolean; result?: string }>;
}

class AccountAutoSyncOutcomeError extends Error {}
class AccountAutoSyncPersistenceError extends Error {}

// `EnableBankingCredentialInvalidError`: a per-user BYOK credential that's
// missing/inactive/undecryptable can't be fixed by pg-boss retrying the same job — only the
// user re-entering it in Settings can, so it's treated the same as the other permanent,
// "retrying can't possibly help" error names below.
const PERMANENT_AUTO_SYNC_ERROR_NAMES = ['BadRequestError', 'ConflictError', 'EnableBankingCredentialInvalidError', 'NotFoundError', 'ValidationError'];

// Auto-sync classifies a credential failure as `authentication` (existing bank-sync error category/code
// in `analytics/bank-sync-contract.ts`) rather than the generic `invalid_requisition` that the
// shared classifier would otherwise emit for a permanent error.
const AUTO_SYNC_EXTRA_ERROR_CODES = [
  { code: 'authentication', match: (error: unknown) => error instanceof Error && error.name === 'EnableBankingCredentialInvalidError' },
] as const;

export const handleAccountAutoSyncRequisitionJob = async (job: JobWithMetadata<AccountAutoSyncRequisitionJobPayload>, deps: { accountService?: typeof accountInitialSyncAccountService; analyticsOutbox?: unknown; backgroundOperationService?: BgDeps; bankSyncIncidentService?: IncidentDeps; enableBankingCredentialService?: Pick<typeof enableBankingCredentialService, 'getDecryptedCredential'>; enqueue?: Enqueue; logger?: Pick<Logger, 'info' | 'warn'>; transactionService?: typeof accountInitialSyncTransactionService } = {}) => {
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const jobData = job.data;
  // `provider === 'enable_banking'` is the only branch point in this file, as in
  // `account-initial-sync.worker.ts`. `syncTargetKeyRaw`/`requisitionId` are the same opaque
  // provider-agnostic identity fields used there. Enable Banking is the only provider: a payload
  // without `provider: 'enable_banking'` is a legacy requisition job and is rejected rather than
  // coerced, since the two key fields index different tables.
  const isEnableBanking = jobData.provider === 'enable_banking';
  const syncTargetKeyRaw = isEnableBanking ? jobData.enableBankingConnectionKey : undefined;
  const requisitionId = isEnableBanking ? jobData.connectionId : undefined;
  const { correlationId } = jobData;
  const key = Number(syncTargetKeyRaw);
  const scheduleRunId = jobData.scheduleRunId || (syncTargetKeyRaw ? scheduleRunIdFromCorrelation(correlationId, syncTargetKeyRaw) : undefined);
  if (!isEnableBanking || !correlationId || !requisitionId || !scheduleRunId || !syncTargetKeyRaw || !Number.isSafeInteger(key) || key <= 0
    || correlationId !== buildAccountAutoSyncRequisitionCorrelationId(scheduleRunId, syncTargetKeyRaw)) throw new Error('Account auto sync payload is invalid');
  const incidents = deps.bankSyncIncidentService ?? new BankSyncIncidentService({
    em: (await import('@app/database/di')).DI.em,
    transitionBackgroundOperation: async (em, context) => {
      const changed = await backgroundOperationService.applyBankSyncTransition(em, {
        correlationId, errorCode: context.event.error_code, final: context.event.final, queueJobId: job.id,
        result: context.event.result, stage: `account.auto-sync.requisition:${context.event.result}`,
      });
      if (!changed) throw new Error('Account auto sync background transition failed');
    },
  });
  // Every job is enqueued by this repo's own code and always carries an incidentId (see
  // `account-auto-sync-scheduler.service.ts`).
  const incidentId = jobData.incidentId;
  if (!incidentId) throw new Error('Account auto sync job is missing incidentId');
  await incidents.assertIncident({ correlationId, flow: 'scheduled-refresh', incidentId, producer: 'pgboss-scheduled', requisitionId, userVisible: false });
  const claimed = await bg.claimJobStart(correlationId, job.id);
  if (!claimed) return false;
  const releaseClaim = async () => {
    if (!await bg.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'internal', stage: 'account.auto-sync.requisition:persistence-failed' })) throw new AccountAutoSyncPersistenceError('Account auto sync claim could not be released');
  };
  let attempt: number;
  try {
    const started = await incidents.startAttempt({ incidentId, queueAttempt: job.retryCount + 1, queueJobId: job.id });
    attempt = started.attempt;
    if (started.completedAt) {
      if (started.result === 'full_success') return true;
      if (started.final) return false;
      await releaseClaim();
      throw new AccountAutoSyncOutcomeError('Account auto sync queue attempt was already finalized for retry');
    }
  } catch (error) {
    if (error instanceof AccountAutoSyncOutcomeError) throw error;
    await releaseClaim();
    throw new AccountAutoSyncPersistenceError(String(error));
  }
  const finalize = async (result: 'failed' | 'full_success' | 'partial', errorCode?: string, nonRetryable = false, accountResult?: { accountsTotal?: number; institutionIds?: string[] }) => {
    const final = result === 'full_success' || nonRetryable || job.retryCount >= job.retryLimit;
    const safe = result === 'full_success' ? undefined : normalizeBankSyncError({ code: errorCode ?? 'provider_unavailable' });
    try { await incidents.finalizeAttempt({ accountCount: safeAccountCount(accountResult?.accountsTotal), attempt, errorCategory: safe?.error_category, errorCode: safe?.error_code, final, incidentId, institutionId: safeInstitutionId(accountResult?.institutionIds), result, treatmentEligible: false }); } catch (error) { await releaseClaim(); throw new AccountAutoSyncPersistenceError(String(error)); }
    return final;
  };
  try {
    // Resolve the owning appuser's own Enable Banking BYOK credential as an *earlier failure
    // point* inside this same try/catch, so it shares the error handling below. A missing/inactive/undecryptable credential becomes `EnableBankingCredentialInvalidError`,
    // which `classifyBankSyncError` below treats as non-retryable (a per-user secret that pg-boss
    // backoff can never fix on its own), classified via the existing `authentication` bank-sync
    // error category/code (see `safeThrownErrorCode`) rather than a new one.
    const phases = await runBankSyncPhases({
      accountService: deps.accountService ?? accountInitialSyncAccountService,
      correlationId,
      enableBankingConnectionKey: key,
      enqueue: deps.enqueue,
      fetchWindowDays: 5,
      prePhase: async () => {
        const { appuserKey } = jobData;
        if (!Number.isSafeInteger(appuserKey) || appuserKey <= 0) throw new EnableBankingCredentialInvalidError('Enable Banking auto sync job has no valid owning appuser');
        let credential: Awaited<ReturnType<typeof enableBankingCredentialService.getDecryptedCredential>>;
        try {
          credential = await (deps.enableBankingCredentialService ?? enableBankingCredentialService).getDecryptedCredential(appuserKey);
        } catch (error) {
          throw new EnableBankingCredentialInvalidError(error instanceof Error ? error.message : 'Enable Banking credential could not be decrypted');
        }
        if (!credential) throw new EnableBankingCredentialInvalidError('Enable Banking credential is missing or inactive for this appuser');
      },
      queueJobId: job.id,
      transactionService: deps.transactionService ?? accountInitialSyncTransactionService,
    });
    if (phases.status === 'failed') {
      const errorCode = phases.failedAt === 'account' ? 'account_phase_failed' : 'transaction_phase_failed';
      if (await finalize('failed', errorCode, false, phases.account)) return false;
      throw new AccountAutoSyncOutcomeError('account.auto-sync.requisition:failed');
    }
    if (phases.status === 'partial') {
      if (await finalize('partial', 'data_validation', false, phases.account)) return false;
      throw new AccountAutoSyncOutcomeError('account.auto-sync.requisition:partial');
    }
    await finalize('full_success', undefined, false, phases.account);
    return true;
  } catch (error) {
    if (error instanceof AccountAutoSyncOutcomeError || error instanceof AccountAutoSyncPersistenceError) throw error;
    const { code, isPermanent } = classifyBankSyncError(error, { extraCodes: AUTO_SYNC_EXTRA_ERROR_CODES, permanentErrorNames: PERMANENT_AUTO_SYNC_ERROR_NAMES });
    const final = await finalize('failed', code, isPermanent);
    if (final) return false;
    throw error;
  }
};

export const handleAccountAutoSyncScheduleJob = async (job: JobWithMetadata<{ correlationId?: string }>, deps: { backgroundOperationService?: BgDeps; boss?: Pick<PgBossLike, 'send'>; logger?: Pick<Logger, 'warn'>; schedulerService?: typeof schedulerService } = {}) => {
  const correlationId = job.data.correlationId ?? `account.auto-sync.schedule:${job.id}`;
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  try { await bg.createQueuedOperation({ correlationId, operationType: 'account.auto-sync.schedule', resourceId: 'account-auto-sync:scheduled-scan' }); } catch (error) { if (!isDuplicate(error)) throw error; }
  const claimed = await bg.claimJobStart(correlationId, job.id); if (!claimed) return false;
  const persistFailure = async (status: BackgroundOperationStatus.FAILED | BackgroundOperationStatus.PARTIAL, stage: string) => {
    if (job.retryCount >= job.retryLimit) {
      if (!await bg.finishJob(correlationId, job.id, { retryable: false, stage, status })) throw new AccountAutoSyncPersistenceError('account.auto-sync schedule finish failed');
      return true;
    } else if (!await bg.markAttemptFailedForRetry(correlationId, job.id, { stage })) throw new AccountAutoSyncPersistenceError('account.auto-sync schedule retry transition failed');
    return false;
  };
  try {
    const result = await (deps.schedulerService ?? schedulerService).enqueueDueAccountSyncs({ boss: deps.boss, scheduleRunId: job.id });
    await bg.heartbeatJob(correlationId, job.id, { progress: result, stage: 'account.auto-sync.schedule:scan-complete' });
    const status = result.failed > 0 && result.enqueued + result.skipped > 0 ? BackgroundOperationStatus.PARTIAL : result.failed > 0 ? BackgroundOperationStatus.FAILED : BackgroundOperationStatus.SUCCEEDED;
    const stage = `account.auto-sync.schedule:${status.toLowerCase()}`;
    if (status !== BackgroundOperationStatus.SUCCEEDED) {
      if (await persistFailure(status, stage)) return false;
      throw new AccountAutoSyncOutcomeError(stage);
    }
    if (!await bg.finishJob(correlationId, job.id, { retryable: false, stage, status })) throw new AccountAutoSyncPersistenceError('account.auto-sync schedule finish failed');
    return true;
  } catch (error) {
    if (error instanceof AccountAutoSyncOutcomeError || error instanceof AccountAutoSyncPersistenceError) throw error;
    const terminal = await persistFailure(BackgroundOperationStatus.FAILED, 'account.auto-sync.schedule:failed');
    if (terminal) {
      Sentry.captureException(new Error('Account auto sync schedule exhausted after unexpected failure'), { tags: { job: 'account.auto-sync.schedule', stage: 'retries-exhausted' } });
      return false;
    }
    throw error;
  }
};

function isDuplicate(error: unknown) { return /unique|duplicate|constraint/i.test(String(error instanceof Error ? error.message : error)); }

function scheduleRunIdFromCorrelation(correlationId: string | undefined, requisitionKey: string): string | undefined {
  if (!correlationId) return undefined;
  const prefix = 'account.auto-sync.requisition:';
  const suffix = `:${requisitionKey}`;
  return correlationId.startsWith(prefix) && correlationId.endsWith(suffix) ? correlationId.slice(prefix.length, -suffix.length) : undefined;
}
