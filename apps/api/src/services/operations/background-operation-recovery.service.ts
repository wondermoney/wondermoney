import type { Logger } from 'pino';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { getBackgroundOperationRetrySpec } from '@service/operations/background-operation-retry-registry';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { RecoveryTransport } from '@service/queue/recovery-transport';

const RECOVERY_STALE_MINUTES = 30;

export interface RecoverOnceInput { boss: RecoveryTransport; limit?: number; logger?: Pick<Logger, 'error' | 'info' | 'warn'>; now?: Date }
interface RecoveryCandidate { correlationId: string; operationType: string; queueJobId: null | string; resourceId?: string; retryable: boolean; status: BackgroundOperationStatus }

const hasQueueJob = (candidate: RecoveryCandidate) => candidate.queueJobId !== null;
const isLiveQueueState = (state: string) => ['active', 'created', 'retry'].includes(state);
const isRetryableQueueFailure = (state: string) => ['cancelled', 'failed', 'missing'].includes(state);
const resolveQueueState = (jobs: { state?: string }[]) => {
  if (jobs.length === 0) return 'missing';
  const states = jobs.map(({ state }) => state).filter((state): state is string => typeof state === 'string');
  const liveState = states.find(isLiveQueueState);
  if (liveState) return liveState;
  const failureState = states.find(isRetryableQueueFailure);
  if (failureState) return failureState;
  if (states.includes('completed')) return 'completed';
  return states[0] ?? 'missing';
};

class BackgroundOperationRecoveryService {
  async recoverOnce({ boss, limit = 50, logger = console, now = new Date() }: RecoverOnceInput) {
    const candidates = await backgroundOperationService.findRecoveryCandidates({ limit, now });
    const summary = { needsAction: 0, processed: candidates.length, reenqueued: 0, skipped: 0 };

    for (const candidate of candidates as RecoveryCandidate[]) {
      const recoveryToken = crypto.randomUUID();
      const staleBefore = new Date(now.getTime() - RECOVERY_STALE_MINUTES * 60 * 1000);
      const spec = getBackgroundOperationRetrySpec(candidate.operationType);
      const singletonKey = spec ? await (spec.buildSingletonKey?.(candidate) ?? Promise.resolve(candidate.correlationId)).catch(() => candidate.correlationId) : candidate.correlationId;
      const queueState = spec ? resolveQueueState(await boss.findJobs(spec.queueName, candidate.queueJobId ? { id: candidate.queueJobId } : { key: singletonKey })) : 'missing';

      const markNeedsAction = async (errorCode: string, stage: string) => {
        await backgroundOperationService.markRecoveryNeedsAction({ correlationId: candidate.correlationId, expectedQueueJobId: candidate.queueJobId, expectedStatus: candidate.status, staleBefore }, errorCode, stage);
        summary.needsAction += 1;
      };

      if (!spec) {
        summary.skipped += 1;
        await markNeedsAction('recovery:unrecoverable', 'recovery:skip');
        logger.warn({ action: 'skip', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'unknown-operation-type', retryable: candidate.retryable, status: candidate.status }, 'Skipping unrecoverable background operation');
        continue;
      }

      const claim = async () => backgroundOperationService.claimForRecovery({ correlationId: candidate.correlationId, expectedQueueJobId: candidate.queueJobId, expectedStatus: candidate.status, recoveryToken, staleBefore });
      const enqueue = async () => {
        try {
          await spec.ensureQueue(boss);
          const payload = await spec.buildPayload(candidate);
          const newJobId = await boss.send(spec.queueName, payload, { singletonKey });
          if (!newJobId) {
            if (candidate.status === BackgroundOperationStatus.QUEUED && !candidate.queueJobId && candidate.retryable) {
              await backgroundOperationService.releaseRecoveryClaimForRetry({ correlationId: candidate.correlationId, expectedQueueJobId: null, expectedStatus: candidate.status, recoveryToken });
              summary.skipped += 1;
              return false;
            }
            await backgroundOperationService.markClaimedRecoveryNeedsAction(candidate.correlationId, recoveryToken, 'recovery:no-job-id', 'recovery:send-null'); summary.needsAction += 1; return false;
          }
          await backgroundOperationService.attachRecoveredQueueJob(candidate.correlationId, candidate.queueJobId, newJobId, recoveryToken);
          logger.info({ action: 'requeue', correlationId: candidate.correlationId, newQueueJobId: newJobId, oldQueueJobId: candidate.queueJobId, operationType: candidate.operationType, queueState, retryable: candidate.retryable, status: candidate.status }, 'Recovered background operation');
          summary.reenqueued += 1; return true;
        } catch {
          await backgroundOperationService.markClaimedRecoveryNeedsAction(candidate.correlationId, recoveryToken, 'recovery:enqueue-failed', 'recovery:enqueue-failed');
          summary.needsAction += 1;
          return false;
        }
      };

      if (candidate.status === BackgroundOperationStatus.QUEUED && !candidate.queueJobId && candidate.retryable && (isRetryableQueueFailure(queueState) || queueState === 'completed')) { if (await claim()) await enqueue(); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && !candidate.queueJobId && isLiveQueueState(queueState)) { summary.skipped += 1; logger.info({ action: 'noop', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'singleton-live-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation still in progress'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && !candidate.queueJobId && queueState === 'completed') { await markNeedsAction('recovery:completed', 'recovery:completed'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'completed-singleton-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && queueState === 'missing' && candidate.retryable) { if (await claim()) await enqueue(); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && !candidate.retryable && !candidate.queueJobId) { await markNeedsAction('recovery:non-retryable', 'recovery:no-op'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'non-retryable-queued-no-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && queueState === 'missing' && !candidate.retryable) { await markNeedsAction('recovery:non-retryable', 'recovery:no-op'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'non-retryable-queued-missing-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && queueState === 'completed') { await markNeedsAction('recovery:completed', 'recovery:completed'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'completed-queue-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && isLiveQueueState(queueState)) { summary.skipped += 1; logger.info({ action: 'noop', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'active-queue-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation still in progress'); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && isRetryableQueueFailure(queueState) && candidate.retryable) { if (await claim()) await enqueue(); continue; }
      if (candidate.status === BackgroundOperationStatus.QUEUED && hasQueueJob(candidate) && isRetryableQueueFailure(queueState) && !candidate.retryable) { await markNeedsAction('recovery:non-retryable', 'recovery:no-op'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'non-retryable-queued-failure', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.RUNNING && isLiveQueueState(queueState)) { await markNeedsAction('recovery:active-job', 'recovery:active-job'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'stale-active-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.RUNNING && queueState === 'completed') { await markNeedsAction('recovery:completed', 'recovery:completed'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'completed-queue-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status === BackgroundOperationStatus.RUNNING && ['cancelled', 'failed', 'missing'].includes(queueState) && candidate.retryable) { if (await claim()) await enqueue(); continue; }
      if (candidate.status === BackgroundOperationStatus.RUNNING && ['cancelled', 'failed', 'missing'].includes(queueState) && !candidate.retryable) { await markNeedsAction('recovery:non-retryable', 'recovery:no-op'); logger.warn({ action: 'needs-action', correlationId: candidate.correlationId, operationType: candidate.operationType, queueJobId: candidate.queueJobId, queueState, reason: 'non-retryable-stale-job', retryable: candidate.retryable, status: candidate.status }, 'Background operation needs manual action'); continue; }
      if (candidate.status !== BackgroundOperationStatus.QUEUED && candidate.status !== BackgroundOperationStatus.RUNNING) summary.skipped += 1;
    }

    return summary;
  }
}

export default new BackgroundOperationRecoveryService();
