import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BACKGROUND_OPERATION_QUEUE_PROVIDER, BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { getBackgroundOperationRetrySpec } from '@service/operations/background-operation-retry-registry';
import { createOwnedProducerRuntime, type OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';
import { ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

type VisibleUser = Pick<Appuser, 'appuserKey'>;
const TERMINAL_STATUSES = [BackgroundOperationStatus.FAILED, BackgroundOperationStatus.NEEDS_ACTION, BackgroundOperationStatus.PARTIAL, BackgroundOperationStatus.SUCCEEDED, BackgroundOperationStatus.STALE];

interface FinishInput { errorCode?: string; retryable?: boolean; stage?: string; status: BackgroundOperationStatus }
interface QueueJobInput { progress?: Record<string, unknown>; stage?: string }

// allow: SIZE_OK - durable state transitions stay together to preserve guarded SQL invariants.
/* eslint-disable perfectionist/sort-classes */
class BackgroundOperationService {
  private readonly recoveryStaleCutoffMinutes = 30;
  async attachAdminRetryQueueJob(correlationId: string, queueJobId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET queue_job_id = ?, queued_at = COALESCE(queued_at, NOW()), stage = 'manual-retry:queued', updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status = 'queued' AND stage = 'manual-retry:queueing' AND queue_job_id IS NULL RETURNING background_operation_key`,
      [queueJobId, correlationId],
    );
  }

  async attachQueueJob(correlationId: string, queueJobId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET queue_job_id = ?, updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [queueJobId, correlationId],
    );
  }

  async applyBankSyncTransition(em: EntityManager, input: Readonly<{ correlationId: string; errorCode?: string; final: boolean; queueJobId: string; result: 'failed' | 'full_success' | 'partial'; stage: string }>) {
    const status = input.result === 'full_success' ? BackgroundOperationStatus.SUCCEEDED
      : input.final ? (input.result === 'partial' ? BackgroundOperationStatus.PARTIAL : BackgroundOperationStatus.FAILED)
        : BackgroundOperationStatus.QUEUED;
    const finishedAt = input.final ? 'NOW()' : 'NULL';
    const connection = em.getConnection() as unknown as { execute: (query: string, params: unknown[], method: 'all', context: unknown) => Promise<unknown> };
    const rows = await connection.execute(
      `UPDATE background_operation SET status = ?, stage = ?, error_code = ?, retryable = ?, finished_at = ${finishedAt}, queued_at = CASE WHEN ? = 'queued' THEN NOW() ELSE queued_at END, last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL RETURNING background_operation_key`,
      [status, input.stage, input.errorCode ?? null, !input.final, status, input.correlationId, input.queueJobId],
      'all',
      em.getTransactionContext(),
    );
    return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
  }

  async applyBankSyncPreEnqueueTransition(em: EntityManager, input: Readonly<{ correlationId: string; errorCode: string }>) {
    const rows = await em.getConnection().execute(
      `UPDATE background_operation SET status = 'queued', stage = 'account.initial-sync:queueing', error_code = ?, retryable = TRUE, finished_at = NULL, last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NULL AND deleted_at IS NULL RETURNING background_operation_key`,
      [input.errorCode, input.correlationId],
      'all',
      em.getTransactionContext(),
    );
    return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
  }

  async attachRecoveredQueueJob(correlationId: string, expectedQueueJobId: null | string, newQueueJobId: string, recoveryToken: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'queued', queue_job_id = ?, queued_at = NOW(), last_heartbeat_at = NULL, error_code = NULL, stage = 'recovery:requeued', updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND stage = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [newQueueJobId, correlationId, expectedQueueJobId, recoveryToken],
    );
  }

  async claimAdminRetry(correlationId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'queued', stage = 'manual-retry:queueing', error_code = NULL, finished_at = NULL, last_heartbeat_at = NULL, queue_job_id = NULL, updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND retryable = TRUE AND status IN ('failed', 'stale', 'needs_action', 'partial') RETURNING background_operation_key`,
      [correlationId],
    );
  }

  async claimForRecovery(input: { correlationId: string; expectedQueueJobId: null | string; expectedStatus: BackgroundOperationStatus; recoveryToken: string; staleBefore: Date }) {
    const isQueued = input.expectedStatus === BackgroundOperationStatus.QUEUED;
    const stalePredicate = isQueued
      ? 'queued_at <= ? AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= ?)'
      : '(last_heartbeat_at <= ? OR (last_heartbeat_at IS NULL AND started_at <= ?))';
    const params = isQueued
      ? [input.recoveryToken, input.correlationId, input.expectedQueueJobId, BACKGROUND_OPERATION_QUEUE_PROVIDER, input.expectedStatus, input.staleBefore, input.staleBefore]
      : [input.recoveryToken, input.correlationId, input.expectedQueueJobId, BACKGROUND_OPERATION_QUEUE_PROVIDER, input.expectedStatus, input.staleBefore, input.staleBefore];
    return this.executeUpdate(
      `UPDATE background_operation SET stage = ?, last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND queue_provider = ? AND retryable = TRUE AND deleted_at IS NULL AND status = ? AND ${stalePredicate} RETURNING background_operation_key`,
      params,
    );
  }

  async claimJobStart(correlationId: string, queueJobId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'running', queue_job_id = COALESCE(queue_job_id, ?), started_at = COALESCE(started_at, NOW()), last_heartbeat_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status = 'queued' AND (queue_job_id IS NOT DISTINCT FROM ? OR queue_job_id IS NULL) RETURNING background_operation_key`,
      [queueJobId, correlationId, queueJobId],
    );
  }

  async createQueuedOperation(input: { appuserKey?: Appuser | null | number; correlationId?: string; operationType: string; resourceId: string; retryable?: boolean; tenantKey?: null | number }, transaction?: EntityManager) {
    const em = transaction ?? DI.em;
    const operation = em.create(BackgroundOperation, {
      appuserKey: input.appuserKey ?? null,
      attemptCount: 0,
      correlationId: input.correlationId ?? crypto.randomUUID(),
      operationType: input.operationType,
      progress: null,
      queuedAt: new Date(),
      queueProvider: BACKGROUND_OPERATION_QUEUE_PROVIDER,
      resourceId: input.resourceId,
      retryable: input.retryable ?? false,
      status: BackgroundOperationStatus.QUEUED,
      tenantKey: input.tenantKey ?? null,
    } as RequiredEntityData<BackgroundOperation>);
    await em.persist(operation).flush();
    return operation;
  }

  async findRecoveryCandidates(input: { limit: number; now: Date }) {
    const cutoff = new Date(input.now.getTime() - this.recoveryStaleCutoffMinutes * 60 * 1000);
    return DI.em.find(
      BackgroundOperation,
      {
        $or: [
          { queuedAt: { $lte: cutoff }, status: BackgroundOperationStatus.QUEUED },
          { $or: [{ lastHeartbeatAt: { $lte: cutoff } }, { lastHeartbeatAt: null, startedAt: { $lte: cutoff } }], status: BackgroundOperationStatus.RUNNING },
        ],
        deletedAt: undefined,
        queueProvider: BACKGROUND_OPERATION_QUEUE_PROVIDER,
        status: { $in: [BackgroundOperationStatus.QUEUED, BackgroundOperationStatus.RUNNING] },
      },
      { limit: input.limit, orderBy: { updatedAt: 'ASC' } },
    );
  }

  async findByCorrelation(correlationId: string) {
    return DI.em.findOne(BackgroundOperation, { correlationId, deletedAt: undefined });
  }

  async finish(correlationId: string, input: FinishInput) {
    if (!TERMINAL_STATUSES.includes(input.status)) return false;
    return this.executeUpdate(
      `UPDATE background_operation SET status = ?, stage = COALESCE(?, stage), error_code = ?, retryable = ?, finished_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [input.status, input.stage ?? null, input.errorCode ?? null, input.retryable ?? false, correlationId],
    );
  }

  async finishJob(correlationId: string, queueJobId: string, input: FinishInput) {
    if (!TERMINAL_STATUSES.includes(input.status)) return false;
    return this.executeUpdate(
      `UPDATE background_operation SET status = ?, stage = COALESCE(?, stage), error_code = ?, retryable = ?, finished_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [input.status, input.stage ?? null, input.errorCode ?? null, input.retryable ?? false, correlationId, queueJobId],
    );
  }

  async getAdminOperation(correlationId: string) {
    const operation = await DI.em.findOne(BackgroundOperation, { correlationId, deletedAt: undefined });
    if (!operation) throw new NotFoundError('Operation not found');
    return operation;
  }

  async getAdminSummary(filters: { appuserKey?: number; from?: Date; limit: number; offset: number; status?: string; tenantKey?: number; to?: Date; type?: string }) {
    const operations = await this.listAdminOperations(filters);
    const summary = { byStatus: {} as Record<string, number>, byType: {} as Record<string, number>, limit: filters.limit, offset: filters.offset, pageTotal: operations.length, retryable: 0, scope: 'page' as const, stale: 0, total: operations.length };
    for (const operation of operations) {
      summary.byStatus[operation.status] = (summary.byStatus[operation.status] ?? 0) + 1;
      summary.byType[operation.operationType] = (summary.byType[operation.operationType] ?? 0) + 1;
      if (operation.retryable) summary.retryable += 1;
      if (operation.status === BackgroundOperationStatus.STALE) summary.stale += 1;
    }
    return summary;
  }

  async getVisibleOperationForUser(appuser: VisibleUser, correlationId: string) {
    const operation = await DI.em.findOne(BackgroundOperation, { correlationId, deletedAt: undefined }, { populate: ['tenantKey', 'appuserKey'] });
    if (!operation) throw new NotFoundError('Operation not found');
    if (!operation.appuserKey && !operation.tenantKey) throw new NotFoundError('Operation not found');
    if (operation.appuserKey && (operation.appuserKey as { appuserKey: number }).appuserKey !== appuser.appuserKey) throw new NotFoundError('Operation not found');
    if (operation.tenantKey) {
      const allowed = await DI.em.findOne(AppuserTenant, { appuserKey: appuser.appuserKey, deletedAt: undefined, recordActive: true, tenantKey: operation.tenantKey } as FilterQuery<AppuserTenant>);
      if (!allowed) throw new NotFoundError('Operation not found');
    }
    return operation;
  }

  async heartbeatJob(correlationId: string, queueJobId: string, input: QueueJobInput) {
    return this.executeUpdate(
      `UPDATE background_operation SET progress = COALESCE(?, progress), stage = COALESCE(?, stage), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [input.progress ? JSON.stringify(input.progress) : null, input.stage ?? null, correlationId, queueJobId],
    );
  }

  async listAdminOperations(filters: { appuserKey?: number; from?: Date; limit: number; offset: number; status?: string; tenantKey?: number; to?: Date; type?: string }) {
    const where: Record<string, unknown> = { deletedAt: undefined };
    if (filters.tenantKey) where['tenantKey'] = filters.tenantKey;
    if (filters.appuserKey) where['appuserKey'] = filters.appuserKey;
    if (filters.type) where['operationType'] = filters.type;
    if (filters.status) where['status'] = filters.status;
    if (filters.from || filters.to) where['updatedAt'] = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
    return DI.em.find(BackgroundOperation, where, { limit: filters.limit, offset: filters.offset, orderBy: { updatedAt: 'DESC' } });
  }

  async markAdminRetryNeedsAction(correlationId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'needs_action', stage = 'manual-retry:send-null', last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status = 'queued' AND stage = 'manual-retry:queueing' RETURNING background_operation_key`,
      [correlationId],
    );
  }

  async markAttemptFailedForRetry(correlationId: string, queueJobId: string, input: Pick<FinishInput, 'errorCode' | 'stage'>) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'queued', error_code = ?, stage = COALESCE(?, stage), retryable = TRUE, queued_at = NOW(), finished_at = NULL, last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL AND status = 'running' RETURNING background_operation_key`,
      [input.errorCode ?? null, input.stage ?? null, correlationId, queueJobId],
    );
  }

  async markClaimedRecoveryNeedsAction(correlationId: string, recoveryToken: string, errorCode: string, stage?: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'needs_action', error_code = ?, stage = COALESCE(?, stage), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND stage = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [errorCode, stage ?? null, correlationId, recoveryToken],
    );
  }

  async markFailed(correlationId: string, errorCode: string, retryable?: boolean) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'failed', error_code = ?, retryable = ?, finished_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [errorCode, retryable ?? false, correlationId],
    );
  }

  async markNeedsAction(correlationId: string, errorCode: string, stage?: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'needs_action', error_code = ?, stage = COALESCE(?, stage), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [errorCode, stage ?? null, correlationId],
    );
  }

  async markRecoveryNeedsAction(input: { correlationId: string; expectedQueueJobId: null | string; expectedStatus: BackgroundOperationStatus; staleBefore: Date }, errorCode: string, stage?: string) {
    const isQueued = input.expectedStatus === BackgroundOperationStatus.QUEUED;
    const stalePredicate = isQueued
      ? 'queued_at <= ? AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= ?)'
      : '(last_heartbeat_at <= ? OR (last_heartbeat_at IS NULL AND started_at <= ?))';
    const params = isQueued
      ? [errorCode, stage ?? null, input.correlationId, input.expectedQueueJobId, BACKGROUND_OPERATION_QUEUE_PROVIDER, input.expectedStatus, input.staleBefore, input.staleBefore]
      : [errorCode, stage ?? null, input.correlationId, input.expectedQueueJobId, BACKGROUND_OPERATION_QUEUE_PROVIDER, input.expectedStatus, input.staleBefore, input.staleBefore];
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'needs_action', error_code = ?, stage = COALESCE(?, stage), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND queue_provider = ? AND deleted_at IS NULL AND status = ? AND ${stalePredicate} RETURNING background_operation_key`,
      params,
    );
  }

  async markRunning(correlationId: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'running', started_at = COALESCE(started_at, NOW()), last_heartbeat_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [correlationId],
    );
  }

  async markStale(correlationId: string, errorCode?: string) {
    return this.executeUpdate(
      `UPDATE background_operation SET status = 'stale', error_code = ?, finished_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [errorCode ?? null, correlationId],
    );
  }

  async releaseRecoveryClaimForRetry(input: { correlationId: string; expectedQueueJobId: null; expectedStatus: BackgroundOperationStatus; recoveryToken: string }) {
    return this.executeUpdate(
      `UPDATE background_operation SET stage = 'recovery:retryable', error_code = NULL, last_heartbeat_at = NULL, updated_at = NOW() WHERE correlation_id = ? AND queue_job_id IS NOT DISTINCT FROM ? AND queue_provider = ? AND retryable = TRUE AND deleted_at IS NULL AND status = ? AND stage = ? RETURNING background_operation_key`,
      [input.correlationId, input.expectedQueueJobId, BACKGROUND_OPERATION_QUEUE_PROVIDER, input.expectedStatus, input.recoveryToken],
    );
  }

  async retryAdminOperation(correlationId: string, _reason?: string, deps: { createRuntime?: () => OwnedProducerRuntime } = {}) {
    const operation = await this.getAdminOperation(correlationId);
    if (!operation.retryable) throw new ConflictError('Operation is not retryable');
    if (![BackgroundOperationStatus.FAILED, BackgroundOperationStatus.NEEDS_ACTION, BackgroundOperationStatus.PARTIAL, BackgroundOperationStatus.STALE].includes(operation.status)) throw new ConflictError('Operation cannot be retried');
    const spec = getBackgroundOperationRetrySpec(operation.operationType);
    if (!spec) throw new ConflictError('Operation type is not supported for retry');

    let runtime: OwnedProducerRuntime | undefined;
    try {
      runtime = (deps.createRuntime ?? createOwnedProducerRuntime)();
      const boss = runtime.boss;
      await runtime.start();
      await spec.ensureQueue(boss);
      const singletonKey = await (spec.buildSingletonKey?.(operation) ?? Promise.resolve(operation.correlationId));
      const jobs = await boss.findJobs(spec.queueName, { key: singletonKey });
      if (jobs.some((job) => typeof job.state === 'string' && ['active', 'created', 'retry'].includes(job.state))) throw new ConflictError('Live pg-boss job already exists');

      const claimed = await this.claimAdminRetry(correlationId);
      if (!claimed) throw new ConflictError('Operation cannot be retried');

      try {
        const payload = await spec.buildPayload(operation);
        const jobId = await boss.send(spec.queueName, payload, { singletonKey });
        if (!jobId) {
          await this.markAdminRetryNeedsAction(correlationId);
          logger.warn({ correlationId, operationType: operation.operationType }, 'Admin retry returned no pg-boss job id');
          throw new ConflictError('Retry could not be enqueued');
        }

        const attached = await this.attachAdminRetryQueueJob(correlationId, jobId);
        if (!attached) {
          await this.markAdminRetryNeedsAction(correlationId);
          throw new ConflictError('Operation cannot be retried');
        }

        const queued = await this.getAdminOperation(correlationId);
        return { jobId, operation: queued };
      } catch (error) {
        await this.markAdminRetryNeedsAction(correlationId);
        throw error;
      }
    } finally {
      if (runtime) {
        try {
          await runtime.dispose();
        } catch (error) {
          logger.error({ correlationId, error }, 'Admin retry producer runtime disposal failed');
        }
      }
    }
  }

  async resetRetryableQueueing(correlationId: string, transaction?: EntityManager) {
    const em = transaction ?? DI.em;
    const connection = em.getConnection() as unknown as { execute: (query: string, params: unknown[], method: 'all', context: unknown) => Promise<unknown> };
    const rows = await connection.execute(
      `UPDATE background_operation SET status = 'queued', queue_job_id = NULL, stage = 'account.auto-sync.requisition:queueing', error_code = NULL, finished_at = NULL, queued_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND retryable = TRUE AND queue_job_id IS NULL AND status IN ('queued', 'needs_action') AND (stage IS NULL OR stage NOT LIKE 'recovery:%') RETURNING background_operation_key`,
      [correlationId],
      'all',
      em.getTransactionContext(),
    );
    return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
  }

  async updateProgress(correlationId: string, input: QueueJobInput) {
    return this.executeUpdate(
      `UPDATE background_operation SET progress = COALESCE(?, progress), stage = COALESCE(?, stage), last_heartbeat_at = NOW(), updated_at = NOW() WHERE correlation_id = ? AND deleted_at IS NULL AND status NOT IN ('succeeded', 'partial', 'needs_action', 'failed', 'stale') RETURNING background_operation_key`,
      [input.progress ? JSON.stringify(input.progress) : null, input.stage ?? null, correlationId],
    );
  }

  private async executeUpdate(sql: string, params: unknown[]) {
    const result = await DI.em.getConnection().execute(sql, params);
    return Array.isArray(result) ? result.length > 0 : Boolean(result);
  }
}
/* eslint-enable perfectionist/sort-classes */

export default new BackgroundOperationService();
