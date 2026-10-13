import type { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em } = vi.hoisted(() => ({
  em: {
    create: vi.fn((_: unknown, data: unknown): unknown => data),
    find: vi.fn(),
    findOne: vi.fn(),
    flush: vi.fn(),
    getConnection: vi.fn(),
    nativeUpdate: vi.fn(),
    persist: vi.fn().mockReturnThis(),
    transactional: vi.fn(),
  },
}));
const { boss, runtime } = vi.hoisted(() => {
  const boss = { createQueue: vi.fn().mockResolvedValue(undefined), findJobs: vi.fn(), send: vi.fn() };
  return { boss, runtime: { boss, dispose: vi.fn(), start: vi.fn() } };
});

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/queue/owned-producer-runtime', () => ({ createOwnedProducerRuntime: vi.fn(() => runtime) }));

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { ConflictError, NotFoundError } from '@utils/errors';

import service from '../background-operation.service';

describe('background operation service', () => {
  it('passes transaction context to an atomic bank-sync background transition', async () => {
    const context = { transaction: 'tx-1' };
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    const transactionalEm = { getConnection: () => ({ execute }), getTransactionContext: () => context };
    await expect(service.applyBankSyncTransition(transactionalEm as unknown as EntityManager, { correlationId: 'corr', final: false, queueJobId: 'job', result: 'failed', stage: 'failed' })).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'all', context);
  });
  it('does not expose a lambda fallback state transition', () => {
    // Given / When / Then
    expect(Reflect.has(service, 'markFallbackToLambda')).toBe(false);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    em.find.mockResolvedValue([]);
    em.transactional.mockImplementation((work: (manager: typeof em) => unknown) => work(em));
    em.flush.mockResolvedValue(undefined);
    em.persist.mockReturnThis();
    boss.createQueue.mockResolvedValue(undefined);
  });

  it('creates queued operations with defaults', async () => {
    em.flush.mockResolvedValueOnce(undefined);
    await expect(
      service.createQueuedOperation({
        appuserKey: 2,
        operationType: 'portfolio.backfill',
        resourceId: 'portfolio:1',
        tenantKey: 1,
      }),
    ).resolves.toMatchObject({
      attemptCount: 0,
      queueProvider: 'pg-boss',
      status: BackgroundOperationStatus.QUEUED,
    });
  });

  it('does not update progress after terminal state', async () => {
    em.getConnection.mockReturnValue({ execute: vi.fn().mockResolvedValueOnce([]) });
    await expect(service.updateProgress('cid', { stage: 'done' })).resolves.toBe(false);
  });

  it('treats successful raw updates as true when execute returns rows', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await expect(service.attachQueueJob('cid', 'job-1')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), expect.any(Array));
  });

  it('claims queued jobs and assigns queue ids when missing', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await expect(service.claimJobStart('cid', 'job-1')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('queue_job_id = COALESCE(queue_job_id, ?)'), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("status = 'queued' AND (queue_job_id IS NOT DISTINCT FROM ? OR queue_job_id IS NULL)"), ['job-1', 'cid', 'job-1']);
  });

  it('returns a retryable failed attempt to a claimable queued state without finishing it', async () => {
    // Given
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    // When
    await expect(
      service.markAttemptFailedForRetry('cid', 'job-1', {
        errorCode: 'account.initial-sync:partial',
        stage: 'account.initial-sync:partial',
      }),
    ).resolves.toBe(true);

    // Then
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/status = 'queued'.*retryable = TRUE.*finished_at = NULL/),
      ['account.initial-sync:partial', 'account.initial-sync:partial', 'cid', 'job-1'],
    );
  });

  it('updates updated_at on raw updates', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await service.markRunning('cid');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('updated_at = NOW()'), expect.any(Array));
  });

  it('updates stage separately while progress changes', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{}]);
    em.getConnection.mockReturnValue({ execute });
    await expect(service.updateProgress('cid', { progress: { percent: 50 }, stage: 'processing' })).resolves.toBe(true);
    expect(execute).toHaveBeenCalled();
  });

  it('preserves existing stage when only progress changes', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await service.updateProgress('cid', { progress: { percent: 50 } });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('stage = COALESCE(?, stage)'), expect.any(Array));
  });

  it('preserves existing progress when only stage changes', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await service.updateProgress('cid', { stage: 'processing' });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('progress = COALESCE(?, progress)'), expect.any(Array));
  });

  it('finishes only with terminal statuses and no-ops on terminal overwrite', async () => {
    em.getConnection.mockReturnValue({ execute: vi.fn().mockResolvedValueOnce([]) });
    await expect(service.finish('cid', { status: BackgroundOperationStatus.SUCCEEDED })).resolves.toBe(false);
  });

  it('preserves existing stage when finishing without stage', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });
    await service.finish('cid', { status: BackgroundOperationStatus.SUCCEEDED });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('stage = COALESCE(?, stage)'), expect.any(Array));
  });

  it('throws not found for invisible operations', async () => {
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns not found for unscoped operations', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: null, tenantKey: null });
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides soft-deleted operations', async () => {
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      { correlationId: 'cid', deletedAt: undefined },
      expect.anything(),
    );
  });

  it('finds only queued old enough and stale running candidates', async () => {
    const find = vi.fn().mockResolvedValueOnce([]);
    em.find = find;

    await service.findRecoveryCandidates({ limit: 10, now: new Date('2026-01-01T00:00:00Z') });

    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ queuedAt: { $lte: new Date('2025-12-31T23:30:00.000Z') }, status: BackgroundOperationStatus.QUEUED }),
        ]),
        queueProvider: 'pg-boss',
      }),
      expect.anything(),
    );
  });

  it('does not update soft-deleted operations', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    em.getConnection.mockReturnValue({ execute });
    await expect(service.markRunning('cid')).resolves.toBe(false);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), expect.any(Array));
  });

  it('returns visible tenant operations only for active memberships', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: null, tenantKey: { tenantKey: 9 } });
    em.findOne.mockResolvedValueOnce({ appuserKey: 1, deletedAt: undefined, recordActive: true, tenantKey: { tenantKey: 9 } });
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).resolves.toBeTruthy();
  });

  it('hides deleted tenant memberships', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: null, tenantKey: { tenantKey: 9 } });
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides cross-tenant operations', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: null, tenantKey: { tenantKey: 9 } });
    em.findOne.mockResolvedValueOnce(null);
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides appuser mismatched operations', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 2 }, tenantKey: null });
    await expect(service.getVisibleOperationForUser({ appuserKey: 1 }, 'cid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists admin operations with filters and ordering', async () => {
    em.find.mockResolvedValueOnce([]);
    await service.listAdminOperations({ limit: 50, offset: 0, status: 'failed', tenantKey: 2, type: 'foundation.health-check' });
    expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deletedAt: undefined, operationType: 'foundation.health-check', status: 'failed', tenantKey: 2 }), expect.objectContaining({ limit: 50, offset: 0, orderBy: { updatedAt: 'DESC' } }));
  });

  it('builds admin summary counts', async () => {
    em.find.mockResolvedValueOnce([
      { operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.FAILED },
      { operationType: 'foundation.health-check', retryable: false, status: BackgroundOperationStatus.QUEUED },
      { operationType: 'account.initial-sync', retryable: true, status: BackgroundOperationStatus.STALE },
    ]);
    await expect(service.getAdminSummary({ limit: 50, offset: 0 })).resolves.toEqual({ byStatus: { failed: 1, queued: 1, stale: 1 }, byType: { 'account.initial-sync': 1, 'foundation.health-check': 2 }, limit: 50, offset: 0, pageTotal: 3, retryable: 2, scope: 'page', stale: 1, total: 3 });
  });

  it('gets admin operation by correlation id', async () => {
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid' });
    await expect(service.getAdminOperation('cid')).resolves.toMatchObject({ correlationId: 'cid' });
  });

  it('rejects retry for non-retryable operations', async () => {
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', retryable: false, status: 'failed' });
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
  });

  it('rejects retry for unsupported, succeeded, running, and queued operations', async () => {
    // Asserting ConflictError rather than Error is the point. These all have to surface as a
    // 409 the operator can act on; a TypeError would satisfy `toBeInstanceOf(Error)` while
    // reaching the client as a 500 that reads like a bug in the retry endpoint itself.
    const cases = [
      { operationType: 'unknown.type', retryable: true, status: BackgroundOperationStatus.FAILED },
      // A real one: removed from the retry registry with the legacy S3 import, and production
      // still holds six non-terminal rows of this type from June.
      { operationType: 'portfolio.csv-import', retryable: true, status: BackgroundOperationStatus.NEEDS_ACTION },
      { operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.SUCCEEDED },
      { operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.RUNNING },
      { operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.QUEUED },
    ];
    for (const item of cases) {
      em.findOne.mockResolvedValueOnce({ correlationId: 'cid', ...item });
      await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it('retries account initial sync with full payload and queue setup', async () => {
    em.findOne.mockImplementation((entity: unknown) => {
      if ((entity as { name?: string }).name === 'EnableBankingConnection') return { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'req-42', state: 'state-42', status: 'linked' };
      if ((entity as { name?: string }).name === 'BankSyncIncident') return { appuserKey: 7, attempts: 0, correlationId: 'cid', distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', environment: 'development', finality: 'non_terminal', flow: 'initial-add', incidentId: 'incident-42', producer: 'pgboss-initial', requisitionId: 'req-42', result: 'pending' };
      if ((entity as { name?: string }).name === 'BankSyncIncidentAttempt') return null;
      return { correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'enable-banking-connection:42', retryable: true, status: BackgroundOperationStatus.FAILED };
    });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-42');
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await expect(service.retryAdminOperation('cid')).resolves.toMatchObject({ jobId: 'job-42' });
    expect(boss.send).toHaveBeenCalledWith('account.initial-sync', expect.objectContaining({ connectionId: 'req-42', correlationId: 'cid', enableBankingConnectionKey: '42', provider: 'enable_banking' }), { singletonKey: 'cid' });
  });

  it('retries account auto sync connections with the connection singleton key', async () => {
    em.findOne.mockImplementation((entity: unknown) => {
      if ((entity as { name?: string }).name === 'EnableBankingConnection') return { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'req-42', state: 'state-42', status: 'linked' };
      if ((entity as { name?: string }).name === 'BankSyncIncident') return { appuserKey: 7, attempts: 0, correlationId: 'account.auto-sync.requisition:run-1:42', distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', environment: 'development', finality: 'non_terminal', flow: 'scheduled-refresh', incidentId: 'incident-42', producer: 'pgboss-scheduled', requisitionId: 'req-42', result: 'pending' };
      if ((entity as { name?: string }).name === 'BankSyncIncidentAttempt') return null;
      return { correlationId: 'account.auto-sync.requisition:run-1:42', operationType: 'account.auto-sync.requisition', resourceId: 'enable-banking-connection:42', retryable: true, status: BackgroundOperationStatus.FAILED };
    });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-42');
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await expect(service.retryAdminOperation('account.auto-sync.requisition:run-1:42')).resolves.toMatchObject({ jobId: 'job-42' });
    expect(boss.findJobs).toHaveBeenCalledWith('account.auto-sync.requisition', { key: 'account.auto-sync.connection:42' });
    expect(boss.send).toHaveBeenCalledWith('account.auto-sync.requisition', { connectionId: 'req-42', correlationId: 'account.auto-sync.requisition:run-1:42', enableBankingConnectionKey: '42', incidentId: 'incident-42', provider: 'enable_banking', scheduleRunId: 'run-1' }, { singletonKey: 'account.auto-sync.connection:42' });
  });

  it('rejects account retry when requisition is missing or unlinked', async () => {
    em.findOne.mockImplementation((entity: unknown) => ((entity as { name?: string }).name === 'NordigenRequisition' ? null : { correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'enable-banking-connection:42', retryable: true, status: BackgroundOperationStatus.FAILED }));
    boss.findJobs.mockResolvedValueOnce([]);
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('rejects live job conflicts before mutation', async () => {
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', resourceId: 'x', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([{ state: 'active' }]);
    const execute = vi.fn();
    em.getConnection.mockReturnValue({ execute });
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
    expect(execute).not.toHaveBeenCalled();
  });

  it('still retries foundation operations', async () => {
    em.findOne.mockResolvedValue({ correlationId: 'cid', operationType: 'foundation.health-check', resourceId: 'foundation', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-foundation');
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await expect(service.retryAdminOperation('cid')).resolves.toMatchObject({ jobId: 'job-foundation' });
  });

  it('rejects live jobs before claim and updates safely on retry', async () => {
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([{ state: 'active' }]);
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
    expect(execute).not.toHaveBeenCalled();

    await service.claimAdminRetry('cid');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('queue_job_id = NULL'), expect.any(Array));

    em.findOne.mockReset();
    boss.findJobs.mockReset();
    boss.send.mockReset();
    execute.mockClear();
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', queueJobId: 'old-job', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-new');
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', queueJobId: 'job-new', retryable: true, stage: 'manual-retry:queued', status: BackgroundOperationStatus.QUEUED });
    await expect(service.retryAdminOperation('cid')).resolves.toMatchObject({ jobId: 'job-new', operation: expect.objectContaining({ queueJobId: 'job-new', stage: 'manual-retry:queued', status: BackgroundOperationStatus.QUEUED }) });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("status = 'queued'"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("stage = 'manual-retry:queueing'"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("queue_job_id = ?"), expect.any(Array));
    expect(runtime.start).toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalled();

    em.findOne.mockReset();
    boss.findJobs.mockReset();
    boss.send.mockReset();
    execute.mockClear();
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockRejectedValueOnce(new Error('boom'));
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("status = 'needs_action'"), expect.any(Array));

    em.findOne.mockReset();
    boss.findJobs.mockReset();
    boss.send.mockReset();
    const attachExecute = vi.fn().mockResolvedValueOnce([{ background_operation_key: 1 }]).mockResolvedValueOnce([]);
    em.getConnection.mockReturnValue({ execute: attachExecute });
    em.findOne.mockResolvedValueOnce({ correlationId: 'cid', operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-attach-fail');
    await expect(service.retryAdminOperation('cid')).rejects.toBeInstanceOf(Error);
    expect(attachExecute).toHaveBeenCalledWith(expect.stringContaining("stage = 'manual-retry:queueing'"), expect.any(Array));
    expect(attachExecute).toHaveBeenCalledWith(expect.stringContaining("status = 'needs_action'"), expect.any(Array));
  });

  it('returns an accepted admin retry when owned-runtime disposal fails', async () => {
    em.findOne.mockResolvedValue({ correlationId: 'cid', operationType: 'foundation.health-check', retryable: true, status: BackgroundOperationStatus.FAILED });
    boss.findJobs.mockResolvedValueOnce([]);
    boss.send.mockResolvedValueOnce('job-cleanup-failure');
    em.getConnection.mockReturnValue({ execute: vi.fn().mockResolvedValue([{ background_operation_key: 1 }]) });
    runtime.dispose.mockRejectedValueOnce(new Error('pool cleanup failed'));

    await expect(service.retryAdminOperation('cid')).resolves.toMatchObject({ jobId: 'job-cleanup-failure' });
  });

  it('claims recovery with stale queued and running predicates', async () => {
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await service.claimForRecovery({ correlationId: 'cid', expectedQueueJobId: 'job-1', expectedStatus: BackgroundOperationStatus.QUEUED, recoveryToken: 'token-1', staleBefore: new Date('2026-01-01T00:00:00Z') });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('queued_at <= ? AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= ?)'), expect.arrayContaining(['token-1', 'cid', 'job-1', expect.anything(), BackgroundOperationStatus.QUEUED]));
    expect(execute.mock.calls[0]?.[1]).toHaveLength(7);

    execute.mockClear();
    await service.claimForRecovery({ correlationId: 'cid', expectedQueueJobId: 'job-2', expectedStatus: BackgroundOperationStatus.RUNNING, recoveryToken: 'token-2', staleBefore: new Date('2026-01-01T00:00:00Z') });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('(last_heartbeat_at <= ? OR (last_heartbeat_at IS NULL AND started_at <= ?))'), expect.arrayContaining(['token-2', 'cid', 'job-2', expect.anything(), BackgroundOperationStatus.RUNNING]));
    expect(execute.mock.calls[0]?.[1]).toHaveLength(7);
  });

  it('marks guarded recovery needs action without token or retryable requirement', async () => {
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await service.markRecoveryNeedsAction({ correlationId: 'cid', expectedQueueJobId: null, expectedStatus: BackgroundOperationStatus.QUEUED, staleBefore: new Date('2026-01-01T00:00:00Z') }, 'recovery:completed', 'recovery:completed');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("queue_provider = ?"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.not.stringContaining("stage = ?"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.not.stringContaining('retryable = TRUE'), expect.any(Array));
  });

  it('releases only the matching queued no-job recovery claim for retry', async () => {
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    em.getConnection.mockReturnValue({ execute });

    await service.releaseRecoveryClaimForRetry({ correlationId: 'new-run', expectedQueueJobId: null, expectedStatus: BackgroundOperationStatus.QUEUED, recoveryToken: 'recovery-token' });

    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/queue_job_id IS NOT DISTINCT FROM \?.*queue_provider = \?.*retryable = TRUE.*status = \?.*stage = \?/),
      ['new-run', null, 'pg-boss', BackgroundOperationStatus.QUEUED, 'recovery-token'],
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('last_heartbeat_at = NULL'), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.not.stringContaining("status = 'needs_action'"), expect.any(Array));
  });

  it('protects active recovery tokens from scheduler queueing resets', async () => {
    const execute = vi.fn().mockResolvedValue([{ background_operation_key: 1 }]);
    const context = { transaction: 'tx-1' };
    const transactionalEm = { getConnection: () => ({ execute }), getTransactionContext: () => context };

    await service.resetRetryableQueueing('new-run', transactionalEm as unknown as EntityManager);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("AND (stage IS NULL OR stage NOT LIKE 'recovery:%')"),
      ['new-run'],
      'all',
      context,
    );
  });
});
