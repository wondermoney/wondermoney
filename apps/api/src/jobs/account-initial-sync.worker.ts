import type { JobWithMetadata } from 'pg-boss';
import type { Logger } from 'pino';

import { normalizeBankSyncError } from '@app/analytics/bank-sync-contract';
import { DI } from '@app/database/di';
import { type AccountInitialSyncJobPayload, buildAccountInitialSyncCorrelationId } from '@app/jobs/account-initial-sync.queue';
import { enqueueBankRecoveryAfter } from '@app/jobs/bank-recovery.queue';
import accountInitialSyncAccountService from '@service/account/account-initial-sync-account.service';
import accountInitialSyncTransactionService from '@service/account/account-initial-sync-transaction.service';
import {
  classifyBankSyncError,
  runBankSyncPhases,
  safeAccountCount,
  safeInstitutionId,
} from '@service/bank-sync-run/bank-sync-run';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';
import { bankRecoveryTreatmentMode } from '@service/bank-sync/bank-sync-producer-policy';
import backgroundOperationService from '@service/operations/background-operation.service';
import { createWorkerEnqueueAdapter } from '@service/queue/enqueue';
import type { Enqueue } from '@service/queue/enqueue';
import type { PgBossSendAfterLike } from '@service/queue/pgboss-client';
import logger from '@utils/logger';

interface IncidentDeps {
  assertIncident: (input: { correlationId: string; flow: 'initial-add'; incidentId: string; producer: 'pgboss-initial'; requisitionId: string; userVisible: true }) => Promise<{ distinctId: string }>;
  completeOrAllocateLegacyIncident?: BankSyncIncidentService['completeOrAllocateLegacyIncident'];
  finalizeAttempt: (input: { accountCount?: number; attempt: number; errorCategory?: string; errorCode?: string; final: boolean; incidentId: string; institutionId?: string; result: 'failed' | 'full_success' | 'partial'; treatmentMode: 'internal-allowlist' | 'live' | null }) => Promise<unknown>;
  startAttempt: (input: { incidentId: string; queueAttempt: number; queueJobId: string }) => Promise<{ attempt: number; completedAt?: Date; final?: boolean; result?: string }>;
}

interface ScheduleIntent {
  deliveryKey: number;
  eligibleAfter: Date;
  incidentId: string;
  templateVersion: string;
}

interface WorkerDeps {
  accountInitialSyncAccountService?: typeof accountInitialSyncAccountService;
  accountInitialSyncTransactionService?: typeof accountInitialSyncTransactionService;
  backgroundOperationService?: { claimJobStart: (correlationId: string, queueJobId: string) => Promise<boolean>; markAttemptFailedForRetry: (correlationId: string, queueJobId: string, input: { errorCode?: string; stage?: string }) => Promise<boolean> };
  bankSyncIncidentService?: IncidentDeps;
  boss?: PgBossSendAfterLike;
  enqueue?: Enqueue;
  logger?: Pick<Logger, 'info' | 'warn'>;
  sendAfter?: PgBossSendAfterLike['sendAfter'];
}

class BankSyncOutcomeError extends Error {}
class BankSyncPersistenceError extends Error {}

export const handleAccountInitialSyncJob = async (job: JobWithMetadata<AccountInitialSyncJobPayload>, deps: WorkerDeps = {}) => {
  const { correlationId } = job.data;
  const log = deps.logger ?? logger;
  // `provider === 'enable_banking'` is the only branch point in this file — every other
  // reference below reads the normalized `syncTargetKeyRaw`/`requisitionId` (an opaque analytics
  // identity for either provider, see `account-initial-sync-enqueue.service.ts`'s docblock) so the
  // incident/background-operation/recovery machinery underneath never has to know which provider
  // it's looking at. Enable Banking is the only provider: a payload without
  // `provider: 'enable_banking'` is a legacy requisition job (or a legacy retry payload) and is
  // rejected rather than coerced — `nordigenRequisitionKey` and `enableBankingConnectionKey`
  // index different tables, so falling back would resolve the wrong entity whenever the two
  // happen to share a number.
  const jobData = job.data;
  const isEnableBanking = jobData.provider === 'enable_banking';
  const syncTargetKeyRaw = isEnableBanking ? jobData.enableBankingConnectionKey : undefined;
  const requisitionId = isEnableBanking ? jobData.connectionId : undefined;
  const key = Number(syncTargetKeyRaw);
  if (!isEnableBanking || !correlationId || !requisitionId || !syncTargetKeyRaw || !Number.isSafeInteger(key) || key <= 0
    || correlationId !== buildAccountInitialSyncCorrelationId(syncTargetKeyRaw)) {
    log.warn({ jobId: job.id, provider: jobData.provider ?? 'legacy', queue: 'account.initial-sync' }, 'Account initial sync job payload is invalid');
    return false;
  }
  const incidents = deps.bankSyncIncidentService ?? new BankSyncIncidentService({
    em: DI.em,
    transitionBackgroundOperation: async (em, context) => {
      const changed = await backgroundOperationService.applyBankSyncTransition(em, {
        correlationId, errorCode: context.event.error_code, final: context.event.final, queueJobId: job.id,
        result: context.event.result, stage: `account.initial-sync:${context.event.result}`,
      });
      if (!changed) throw new Error('Account initial sync background transition failed');
    },
  });
  // Every job is enqueued by this repo's own code and always carries an incidentId (see
  // `account-initial-sync-enqueue.service.ts`).
  const incidentId = job.data.incidentId;
  if (!incidentId) throw new Error('Account initial sync job is missing incidentId');
  const incident = await incidents.assertIncident({ correlationId, flow: 'initial-add', incidentId, producer: 'pgboss-initial', requisitionId, userVisible: true });
  const bg = deps.backgroundOperationService ?? backgroundOperationService;
  const claimed = await bg.claimJobStart(correlationId, job.id);
  if (!claimed) return false;
  const releaseClaim = async () => {
    if (!await bg.markAttemptFailedForRetry(correlationId, job.id, { errorCode: 'internal', stage: 'account.initial-sync:persistence-failed' })) {
      throw new BankSyncPersistenceError('Bank sync persistence failed and claim could not be released');
    }
  };
  let attempt: number;
  try {
    const started = await incidents.startAttempt({ incidentId, queueAttempt: job.retryCount + 1, queueJobId: job.id });
    attempt = started.attempt;
    if (started.completedAt) {
      if (started.result === 'full_success') return true;
      if (started.final) return false;
      await releaseClaim();
      throw new BankSyncOutcomeError('Account initial sync queue attempt was already finalized for retry');
    }
  } catch (error) {
    if (error instanceof BankSyncOutcomeError) throw error;
    await releaseClaim();
    throw new BankSyncPersistenceError(error instanceof Error ? error.message : 'Bank sync attempt persistence failed');
  }
  const finalize = async (result: 'failed' | 'full_success' | 'partial', errorCode?: string, nonRetryable = false, accountResult?: { accountsTotal?: number; institutionIds?: string[] }) => {
    const final = result === 'full_success' || nonRetryable || job.retryCount >= job.retryLimit;
    const safe = errorCode ? normalizeBankSyncError({ code: errorCode }) : undefined;
    try {
      const finalized = await incidents.finalizeAttempt({
        accountCount: safeAccountCount(accountResult?.accountsTotal), attempt, errorCategory: safe?.error_category, errorCode: safe?.error_code, final, incidentId,
        institutionId: safeInstitutionId(accountResult?.institutionIds), result,
        treatmentMode: result !== 'full_success' ? bankRecoveryTreatmentMode(incident.distinctId) : null,
      });
      const intent = scheduleIntentFrom(finalized);
      if (intent) {
        try {
          const boss = deps.boss ?? (deps.sendAfter ? { sendAfter: deps.sendAfter } : undefined);
          if (!boss) throw new Error('Bank recovery queue transport unavailable');
          await enqueueBankRecoveryAfter({
            deliveryKey: intent.deliveryKey,
            incidentId: intent.incidentId,
            templateVersion: intent.templateVersion,
          }, { enqueue: createWorkerEnqueueAdapter(boss) }, intent.eligibleAfter);
        } catch {
          log.warn({ deliveryKey: intent.deliveryKey, incidentId: intent.incidentId }, 'Bank recovery scheduling deferred to dispatcher');
        }
      }
    } catch (error) {
      await releaseClaim();
      throw new BankSyncPersistenceError(error instanceof Error ? error.message : 'Bank sync outcome persistence failed');
    }
    return final;
  };
  try {
    const phases = await runBankSyncPhases({
      accountService: deps.accountInitialSyncAccountService ?? accountInitialSyncAccountService,
      correlationId,
      enableBankingConnectionKey: key,
      enqueue: deps.enqueue,
      fetchWindowDays: 365,
      queueJobId: job.id,
      transactionService: deps.accountInitialSyncTransactionService ?? accountInitialSyncTransactionService,
    });
    if (phases.status === 'failed') {
      const errorCode = phases.failedAt === 'account' ? 'account_phase_failed' : 'transaction_phase_failed';
      const final = await finalize('failed', errorCode, false, phases.account);
      if (final) return false;
      throw new BankSyncOutcomeError(`account.initial-sync:${phases.failedAt}-phase-failed`);
    }
    if (phases.status === 'partial') {
      const final = await finalize('partial', 'data_validation', false, phases.account);
      if (final) return false;
      throw new BankSyncOutcomeError('account.initial-sync:partial');
    }
    await finalize('full_success', undefined, false, phases.account);
    log.info({ attempt, correlationId, final: true, jobId: job.id }, 'Account initial sync job completed');
    return true;
  } catch (error) {
    if (error instanceof BankSyncOutcomeError || error instanceof BankSyncPersistenceError) throw error;
    const { code, isPermanent } = classifyBankSyncError(error, { permanentErrorNames: PERMANENT_BANK_SYNC_ERROR_NAMES });
    const final = await finalize('failed', code, isPermanent);
    if (final) return false;
    throw error;
  }
};

const PERMANENT_BANK_SYNC_ERROR_NAMES = ['BadRequestError', 'ConflictError', 'NotFoundError', 'ValidationError'];

function scheduleIntentFrom(value: unknown): ScheduleIntent | undefined {
  if (!value || typeof value !== 'object' || !('scheduleIntent' in value)) return undefined;
  return (value as { scheduleIntent?: ScheduleIntent }).scheduleIntent;
}
