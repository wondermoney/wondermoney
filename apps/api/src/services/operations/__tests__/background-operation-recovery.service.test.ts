import { beforeEach, describe, expect, it, vi } from 'vitest';

const { boss, em, logger, recoverableOperationService } = vi.hoisted(() => ({
  boss: {
    createQueue: vi.fn().mockResolvedValue(undefined),
    findJobs: vi.fn(),
    send: vi.fn(),
  },
  em: { findOne: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  recoverableOperationService: {
    attachRecoveredQueueJob: vi.fn(),
    claimForRecovery: vi.fn(),
    findRecoveryCandidates: vi.fn(),
    markClaimedRecoveryNeedsAction: vi.fn(),
    markNeedsAction: vi.fn(),
    markRecoveryNeedsAction: vi.fn(),
    markStale: vi.fn(),
    releaseRecoveryClaimForRetry: vi.fn(),
  },
}));
const completeIncident = vi.hoisted(() => vi.fn());

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/operations/background-operation.service', () => ({ default: recoverableOperationService }));
vi.mock('@service/bank-sync/bank-sync-incident.service', () => ({ BankSyncIncidentService: class { completeOrAllocateLegacyIncident = completeIncident; } }));

import recoveryService from '../background-operation-recovery.service';

describe('background operation recovery service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boss.createQueue.mockResolvedValue(undefined);
    completeIncident.mockResolvedValue({ incidentId: 'incident-recovered' });
  });

  it('re-enqueues recoverable queued foundation ops with no queue job', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-1', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.reenqueued).toBe(1);
    expect(recoverableOperationService.claimForRecovery).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-1', expectedQueueJobId: null, expectedStatus: 'queued', staleBefore: new Date('2025-12-31T23:30:00.000Z') }));
    expect(boss.send).toHaveBeenCalled();
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalled();
  });

  it('re-enqueues retryable account initial sync ops with full payload', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-a', operationType: 'account.initial-sync', queueJobId: 'job-old-a', resourceId: 'enable-banking-connection:12', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'failed' }]);
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-a');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).toHaveBeenCalledWith('account.initial-sync', expect.objectContaining({ connectionId: 'connection-12', correlationId: 'corr-a', enableBankingConnectionKey: '12', incidentId: 'incident-recovered', provider: 'enable_banking' }), { singletonKey: 'corr-a' });
  });

  it('re-enqueues account auto sync connections with the connection singleton key', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'account.auto-sync.requisition:run-1:12', operationType: 'account.auto-sync.requisition', queueJobId: null, resourceId: 'enable-banking-connection:12', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-auto');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.findJobs).toHaveBeenCalledWith('account.auto-sync.requisition', { key: 'account.auto-sync.connection:12' });
    expect(boss.send).toHaveBeenCalledWith('account.auto-sync.requisition', expect.objectContaining({ connectionId: 'connection-12', correlationId: 'account.auto-sync.requisition:run-1:12', enableBankingConnectionKey: '12', incidentId: 'incident-recovered', provider: 'enable_banking', scheduleRunId: 'run-1' }), { singletonKey: 'account.auto-sync.connection:12' });
  });

  it('retries a new schedule run after the connection singleton completes and null dedupe clears', async () => {
    const candidate = { correlationId: 'account.auto-sync.requisition:new-run:12', operationType: 'account.auto-sync.requisition', queueJobId: null, resourceId: 'enable-banking-connection:12', retryable: true, status: 'queued' };
    recoverableOperationService.findRecoveryCandidates.mockResolvedValue([candidate]);
    em.findOne.mockResolvedValue({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });

    boss.findJobs.mockResolvedValueOnce([{ state: 'active' }]);
    const live = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });
    expect(live.skipped).toBe(1);
    expect(recoverableOperationService.claimForRecovery).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();

    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce(null);
    const deduped = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:01:00Z') });
    const recoveryToken = recoverableOperationService.claimForRecovery.mock.calls[0]?.[0].recoveryToken;
    expect(deduped).toMatchObject({ needsAction: 0, reenqueued: 0 });
    expect(recoverableOperationService.releaseRecoveryClaimForRetry).toHaveBeenCalledWith({ correlationId: candidate.correlationId, expectedQueueJobId: null, expectedStatus: 'queued', recoveryToken });
    expect(recoverableOperationService.markClaimedRecoveryNeedsAction).not.toHaveBeenCalled();

    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-run');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);
    const attached = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:02:00Z') });

    expect(attached.reenqueued).toBe(1);
    expect(boss.send).toHaveBeenLastCalledWith('account.auto-sync.requisition', expect.objectContaining({ connectionId: 'connection-12', correlationId: candidate.correlationId, enableBankingConnectionKey: '12', incidentId: 'incident-recovered', provider: 'enable_banking', scheduleRunId: 'new-run' }), { singletonKey: 'account.auto-sync.connection:12' });
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith(candidate.correlationId, null, 'job-new-run', expect.any(String));
  });

  it('marks needs action when ensureQueue throws after claim', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-q', operationType: 'account.initial-sync', queueJobId: 'job-q', resourceId: 'enable-banking-connection:12', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.createQueue.mockRejectedValueOnce(new Error('queue boom'));

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.needsAction).toBe(1);
    expect(recoverableOperationService.markClaimedRecoveryNeedsAction).toHaveBeenCalledWith('corr-q', expect.any(String), 'recovery:enqueue-failed', 'recovery:enqueue-failed');
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('marks needs action when send throws after claim', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-s', operationType: 'account.initial-sync', queueJobId: 'job-s', resourceId: 'enable-banking-connection:12', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockRejectedValueOnce(new Error('send boom'));

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.needsAction).toBe(1);
    expect(recoverableOperationService.markClaimedRecoveryNeedsAction).toHaveBeenCalledWith('corr-s', expect.any(String), 'recovery:enqueue-failed', 'recovery:enqueue-failed');
  });

  it('marks needs action when attach throws after claim', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-t', operationType: 'account.initial-sync', queueJobId: 'job-t', resourceId: 'enable-banking-connection:12', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'connection-12', state: 'state-12', status: 'linked' });
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-t');
    recoverableOperationService.attachRecoveredQueueJob.mockRejectedValueOnce(new Error('attach boom'));

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.needsAction).toBe(1);
    expect(recoverableOperationService.markClaimedRecoveryNeedsAction).toHaveBeenCalledWith('corr-t', expect.any(String), 'recovery:enqueue-failed', 'recovery:enqueue-failed');
  });

  it('re-enqueues queued recoverable ops with missing pg-boss job', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-9', operationType: 'foundation.health-check', queueJobId: 'job-old', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-9');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'corr-9' }, { singletonKey: 'corr-9' });
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-9', 'job-old', 'job-new-9', expect.any(String));
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ action: 'requeue', correlationId: 'corr-9', newQueueJobId: 'job-new-9', oldQueueJobId: 'job-old', operationType: 'foundation.health-check', queueState: 'missing', retryable: true, status: 'queued' }), 'Recovered background operation');
  });

  it('re-enqueues queued recoverable ops with failed queue job', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-10', operationType: 'foundation.health-check', queueJobId: 'job-failed', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'failed' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-10');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).toHaveBeenCalled();
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-10', 'job-failed', 'job-new-10', expect.any(String));
  });

  it('re-enqueues queued singleton retryable ops when the singleton state failed', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-10c', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'failed' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-10c');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.reenqueued).toBe(1);
    expect(boss.send).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'corr-10c' }, { singletonKey: 'corr-10c' });
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-10c', null, 'job-new-10c', expect.any(String));
  });

  it('re-enqueues queued recoverable ops with cancelled queue job', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-10b', operationType: 'foundation.health-check', queueJobId: 'job-cancelled', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'cancelled' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-10b');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-10b', 'job-cancelled', 'job-new-10b', expect.any(String));
  });

  it('marks queued completed queue jobs as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-11', operationType: 'foundation.health-check', queueJobId: 'job-completed', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-11', expectedQueueJobId: 'job-completed', expectedStatus: 'queued', staleBefore: expect.any(Date) }), 'recovery:completed', 'recovery:completed');
  });

  it('marks running completed queue jobs as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-12', operationType: 'foundation.health-check', queueJobId: 'job-completed-run', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-12', expectedQueueJobId: 'job-completed-run', expectedStatus: 'running', staleBefore: expect.any(Date) }), 'recovery:completed', 'recovery:completed');
  });

  it('passes the exact returned job id to attachRecoveredQueueJob', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-13', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('returned-job-id');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-13', null, 'returned-job-id', expect.any(String));
  });

  it('uses supported pg-boss lookup options', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-1', operationType: 'foundation.health-check', queueJobId: 'job-1', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    boss.send.mockResolvedValueOnce('job-new');
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.findJobs).toHaveBeenCalledWith('foundation.health-check', { id: 'job-1' });
    expect(result.reenqueued).toBe(1);
    expect(boss.send).toHaveBeenCalledWith('foundation.health-check', { correlationId: 'corr-1' }, { singletonKey: 'corr-1' });
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-1', 'job-1', 'job-new', expect.any(String));
  });

  it('propagates queue lookup failures instead of treating them as missing jobs', async () => {
    const lookupError = new Error('pg-boss lookup unavailable');
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'lookup-error', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockRejectedValueOnce(lookupError);

    await expect(recoveryService.recoverOnce({ boss, logger, now: new Date('2026-01-01T00:00:00Z') })).rejects.toBe(lookupError);
    expect(boss.createQueue).not.toHaveBeenCalled();
    expect(recoverableOperationService.claimForRecovery).not.toHaveBeenCalled();
    expect(recoverableOperationService.markRecoveryNeedsAction).not.toHaveBeenCalled();
  });

  it('does not re-enqueue when send returns no id', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-4', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockReset();
    boss.send.mockResolvedValueOnce(undefined);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.processed).toBe(1);
    expect(recoverableOperationService.attachRecoveredQueueJob).not.toHaveBeenCalled();
  });

  it('marks stale running ops with live queue job as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-2', operationType: 'foundation.health-check', queueJobId: 'job-1', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'active' }]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.processed).toBe(1);
    expect(result.needsAction).toBe(1);
    expect(result.skipped).toBe(0);
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalled();
  });

  it('marks running created queue jobs as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-2b', operationType: 'foundation.health-check', queueJobId: 'job-1b', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'created' }]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.processed).toBe(1);
    expect(result.needsAction).toBe(1);
    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-2b', expectedQueueJobId: 'job-1b', expectedStatus: 'running', staleBefore: expect.any(Date) }), 'recovery:active-job', 'recovery:active-job');
  });

  it('marks queued ops with completed queue state as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-5', operationType: 'foundation.health-check', queueJobId: 'job-5', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.processed).toBe(1);
    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-5', expectedQueueJobId: 'job-5', expectedStatus: 'queued', staleBefore: expect.any(Date) }), 'recovery:completed', 'recovery:completed');
  });

  it('no-ops queued active queue jobs', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-16', operationType: 'foundation.health-check', queueJobId: 'job-active', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'active' }]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.skipped).toBe(1);
    expect(boss.send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'noop',
        correlationId: 'corr-16',
        operationType: 'foundation.health-check',
        queueJobId: 'job-active',
        queueState: 'active',
        reason: 'active-queue-job',
        retryable: true,
        status: 'queued',
      }),
      'Background operation still in progress',
    );
  });

  it('no-ops queued jobs with retry queue state', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-16b', operationType: 'foundation.health-check', queueJobId: 'job-retry', retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'retry' }]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.skipped).toBe(1);
    expect(boss.send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'noop',
        correlationId: 'corr-16b',
        queueState: 'retry',
        reason: 'active-queue-job',
      }),
      'Background operation still in progress',
    );
  });

  it('marks queued non-retryable ops with no queue job as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-14', operationType: 'foundation.health-check', queueJobId: null, retryable: false, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-14', expectedQueueJobId: null, expectedStatus: 'queued', staleBefore: expect.any(Date) }), 'recovery:non-retryable', 'recovery:no-op');
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('marks queued non-retryable ops with missing queue job as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-15', operationType: 'foundation.health-check', queueJobId: 'job-missing', retryable: false, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('does not re-enqueue queued singleton live jobs', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-17', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }, { state: 'active' }]);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.attachRecoveredQueueJob).not.toHaveBeenCalled();
    expect(boss.findJobs).toHaveBeenCalledWith('foundation.health-check', { key: 'corr-17' });
  });

  it('re-enqueues queued singleton missing jobs when retryable', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-18', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-18');

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).toHaveBeenCalled();
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-18', null, 'job-new-18', expect.any(String));
    expect(boss.findJobs).toHaveBeenCalledWith('foundation.health-check', { key: 'corr-18' });
  });

  it('re-enqueues queued singleton completed jobs when retryable', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-19', operationType: 'foundation.health-check', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'completed' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);
    boss.send.mockResolvedValueOnce('job-new-19');
    recoverableOperationService.attachRecoveredQueueJob.mockResolvedValueOnce(true);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.reenqueued).toBe(1);
    expect(recoverableOperationService.markRecoveryNeedsAction).not.toHaveBeenCalled();
    expect(recoverableOperationService.attachRecoveredQueueJob).toHaveBeenCalledWith('corr-19', null, 'job-new-19', expect.any(String));
  });

  it('marks non-retryable stale running ops as needs action', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-6', operationType: 'foundation.health-check', queueJobId: 'job-6', retryable: false, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    boss.send.mockResolvedValueOnce('job-new');

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.processed).toBe(1);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('never re-enqueues financial or unknown operations', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-7', operationType: 'financial.price-sync', queueJobId: null, retryable: true, status: 'queued' },
      { correlationId: 'corr-8', operationType: 'unknown.type', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);
    boss.findJobs.mockResolvedValueOnce([]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.needsAction).toBe(2);
    expect(result.skipped).toBe(2);
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledTimes(2);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('skips unknown operations safely', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-3', operationType: 'unknown.type', queueJobId: null, retryable: true, status: 'queued' },
    ]);
    boss.findJobs.mockResolvedValueOnce([]);

    const result = await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.needsAction).toBe(1);
    expect(result.skipped).toBe(1);
    expect(recoverableOperationService.markRecoveryNeedsAction).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-3', expectedQueueJobId: null, expectedStatus: 'queued', staleBefore: expect.any(Date) }), 'recovery:unrecoverable', 'recovery:skip');
    expect(recoverableOperationService.claimForRecovery).not.toHaveBeenCalled();
  });

  it('marks payload builder failures as needs action without sending', async () => {
    recoverableOperationService.findRecoveryCandidates.mockResolvedValueOnce([
      { correlationId: 'corr-x', operationType: 'account.initial-sync', queueJobId: 'job-x', resourceId: 'bad', retryable: true, status: 'running' },
    ]);
    boss.findJobs.mockResolvedValueOnce([{ state: 'missing' }]);
    recoverableOperationService.claimForRecovery.mockResolvedValueOnce(true);

    await recoveryService.recoverOnce({ boss, limit: 10, logger, now: new Date('2026-01-01T00:00:00Z') });

    expect(boss.send).not.toHaveBeenCalled();
    expect(recoverableOperationService.markClaimedRecoveryNeedsAction).toHaveBeenCalled();
  });
});
