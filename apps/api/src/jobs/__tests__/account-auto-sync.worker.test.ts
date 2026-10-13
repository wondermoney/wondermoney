import { describe, expect, it, vi } from 'vitest';

vi.mock('@service/account/account-initial-sync-account.service', () => ({ default: {} }));
vi.mock('@service/account/account-initial-sync-transaction.service', () => ({ default: {} }));
vi.mock('@service/operations/background-operation.service', () => ({ default: {} }));
vi.mock('@service/account/account-auto-sync-scheduler.service', () => ({ default: {} }));
vi.mock('@service/enable-banking/enable-banking-credential.service', () => ({ enableBankingCredentialService: {} }));
const em = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em } }));

import { handleAccountAutoSyncRequisitionJob, handleAccountAutoSyncScheduleJob } from '@app/jobs/account-auto-sync.worker';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

const payload = { appuserKey: 7, connectionId: 'req-12', correlationId: 'account.auto-sync.requisition:run-1:12', enableBankingConnectionKey: '12', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', provider: 'enable_banking', scheduleRunId: 'run-1' };
function harness() {
  const order: string[] = [];
  const bankSyncIncidentService = { assertIncident: vi.fn().mockResolvedValue({}), completeOrAllocateLegacyIncident: vi.fn().mockResolvedValue({ incidentId: payload.incidentId }), finalizeAttempt: vi.fn(async () => { order.push('finalize'); }), startAttempt: vi.fn(async (input: { queueAttempt: number }) => { order.push('start'); return { attempt: input.queueAttempt }; }) };
  const accountService = { syncAccountsForRequisition: vi.fn(async (): Promise<{ status: string }> => { order.push('provider'); return { status: 'completed' }; }) };
  const transactionService = { syncTransactionsForRequisition: vi.fn().mockResolvedValue({ status: 'completed' }) };
  const backgroundOperationService = { attachQueueJob: vi.fn(), claimJobStart: vi.fn().mockResolvedValue(true), createQueuedOperation: vi.fn(), finishJob: vi.fn().mockResolvedValue(true), heartbeatJob: vi.fn().mockResolvedValue(true), markAttemptFailedForRetry: vi.fn().mockResolvedValue(true) };
  const enableBankingCredentialService = { getDecryptedCredential: vi.fn().mockResolvedValue({ applicationId: 'app-1', privateKeyPem: 'pem-1' }) };
  return { accountService, backgroundOperationService, bankSyncIncidentService, enableBankingCredentialService, order, transactionService };
}

describe('scheduled bank sync producer contract worker', () => {
  it('starts with the original incident and finalizes success after provider work', async () => {
    const h = harness();
    const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
    await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(payload, { id: 'job-1', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], { ...h, enqueue } as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(true);
    expect(h.bankSyncIncidentService.assertIncident).toHaveBeenCalledWith(expect.objectContaining({ flow: 'scheduled-refresh', incidentId: payload.incidentId, producer: 'pgboss-scheduled', userVisible: false }));
    expect(h.bankSyncIncidentService.startAttempt).toHaveBeenCalledWith({ incidentId: payload.incidentId, queueAttempt: 1, queueJobId: 'job-1' });
    expect(h.order).toEqual(['start', 'provider', 'finalize']);
    expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ final: true, result: 'full_success', treatmentEligible: false }));
    expect(h.transactionService.syncTransactionsForRequisition).toHaveBeenCalledWith(expect.any(Object), { enqueue });
  });

  it('finalizes partial nonterminal before throwing and never enables recovery treatment', async () => {
    const h = harness();
    h.accountService.syncAccountsForRequisition.mockResolvedValueOnce({ status: 'partial' });
    await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(payload, { id: 'job-2', retryCount: 1, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).rejects.toThrow('partial');
    expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, final: false, result: 'partial', treatmentEligible: false }));
  });

  it('does not reinterpret persistence rollback as a second failed provider outcome', async () => {
    const h = harness();
    h.bankSyncIncidentService.finalizeAttempt.mockRejectedValueOnce(new Error('transition rollback'));
    await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(payload, { id: 'job-1', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).rejects.toThrow('transition rollback');
    expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledTimes(1);
  });

  it('passes the stable queue job id as scheduleRunId on every scan retry', async () => {
    const h = harness();
    const scheduler = { enqueueDueAccountSyncs: vi.fn().mockResolvedValue({ enqueued: 1, failed: 0, skipped: 0 }) };
    await expect(handleAccountAutoSyncScheduleJob(pgBossJob({}, { id: 'schedule-job', retryCount: 2, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncScheduleJob>[0], { backgroundOperationService: h.backgroundOperationService, schedulerService: scheduler } as unknown as Parameters<typeof handleAccountAutoSyncScheduleJob>[1])).resolves.toBe(true);
    expect(scheduler.enqueueDueAccountSyncs).toHaveBeenCalledWith(expect.objectContaining({ scheduleRunId: 'schedule-job' }));
  });

  it.each([
    [{ enqueued: 0, failed: 1, skipped: 0 }, 'failed'],
    [{ enqueued: 1, failed: 1, skipped: 0 }, 'partial'],
  ])('persists exhausted schedule %s and returns false without throwing', async (scan, status) => {
    const h = harness();
    const scheduler = { enqueueDueAccountSyncs: vi.fn().mockResolvedValue(scan) };
    await expect(handleAccountAutoSyncScheduleJob(pgBossJob({}, { id: 'schedule-terminal', retryCount: 3, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncScheduleJob>[0], { backgroundOperationService: h.backgroundOperationService, schedulerService: scheduler } as unknown as Parameters<typeof handleAccountAutoSyncScheduleJob>[1])).resolves.toBe(false);
    expect(h.backgroundOperationService.finishJob).toHaveBeenCalledWith(expect.any(String), 'schedule-terminal', expect.objectContaining({ retryable: false, status }));
    expect(h.backgroundOperationService.markAttemptFailedForRetry).not.toHaveBeenCalled();
  });

  it('captures and returns false after an unexpected exhausted schedule failure is persisted', async () => {
    const h = harness();
    const scheduler = { enqueueDueAccountSyncs: vi.fn().mockRejectedValue(new Error('unexpected secret detail')) };
    await expect(handleAccountAutoSyncScheduleJob(pgBossJob({}, { id: 'schedule-terminal-error', retryCount: 3, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncScheduleJob>[0], { backgroundOperationService: h.backgroundOperationService, schedulerService: scheduler } as unknown as Parameters<typeof handleAccountAutoSyncScheduleJob>[1])).resolves.toBe(false);
    expect(h.backgroundOperationService.finishJob).toHaveBeenCalledWith(expect.any(String), 'schedule-terminal-error', expect.objectContaining({ retryable: false, status: 'failed' }));
  });

  describe('Enable Banking connections (Phase 1e)', () => {
    const ebPayload = (overrides: Record<string, unknown> = {}) => ({
      appuserKey: 9,
      connectionId: 'session-20',
      correlationId: 'account.auto-sync.requisition:run-1:20',
      enableBankingConnectionKey: '20',
      incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      provider: 'enable_banking' as const,
      scheduleRunId: 'run-1',
      ...overrides,
    });

    it('resolves the owning appuser credential and syncs successfully when it is valid', async () => {
      const h = harness();
      const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
      await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(ebPayload(), { id: 'eb-job-1', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], { ...h, enqueue } as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(true);
      expect(h.enableBankingCredentialService.getDecryptedCredential).toHaveBeenCalledWith(9);
      expect(h.accountService.syncAccountsForRequisition).toHaveBeenCalledWith(expect.objectContaining({ enableBankingConnectionKey: 20 }));
      expect(h.transactionService.syncTransactionsForRequisition).toHaveBeenCalledWith(expect.objectContaining({ enableBankingConnectionKey: 20 }), { enqueue });
      expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ final: true, result: 'full_success' }));
    });

    it('fails permanently (not retried) without calling the sync services when the credential is missing', async () => {
      const h = harness();
      h.enableBankingCredentialService.getDecryptedCredential.mockResolvedValueOnce(null);
      await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(ebPayload({ appuserKey: 8, connectionId: 'session-21', correlationId: 'account.auto-sync.requisition:run-1:21', enableBankingConnectionKey: '21' }), { id: 'eb-job-2', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(false);
      expect(h.accountService.syncAccountsForRequisition).not.toHaveBeenCalled();
      expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ errorCategory: 'authentication', errorCode: 'authentication', final: true, result: 'failed' }));
    });

    it('fails permanently when the credential fails to decrypt', async () => {
      const h = harness();
      h.enableBankingCredentialService.getDecryptedCredential.mockRejectedValueOnce(new Error('authentication tag verification failed'));
      await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(ebPayload({ appuserKey: 8, connectionId: 'session-21', correlationId: 'account.auto-sync.requisition:run-1:21', enableBankingConnectionKey: '21' }), { id: 'eb-job-3', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(false);
      expect(h.accountService.syncAccountsForRequisition).not.toHaveBeenCalled();
      expect(h.bankSyncIncidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ errorCategory: 'authentication', errorCode: 'authentication', final: true }));
    });

    it('does not let one connection credential failure affect a sibling job for a different connection', async () => {
      const h = harness();
      h.enableBankingCredentialService.getDecryptedCredential.mockImplementation(async (appuserKey: number) => (appuserKey === 8 ? null : { applicationId: 'app-1', privateKeyPem: 'pem-1' }));
      const badPayload = ebPayload({ appuserKey: 8, connectionId: 'session-22', correlationId: 'account.auto-sync.requisition:run-1:22', enableBankingConnectionKey: '22' });
      const goodPayload = ebPayload({ appuserKey: 9, connectionId: 'session-23', correlationId: 'account.auto-sync.requisition:run-1:23', enableBankingConnectionKey: '23' });

      await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(badPayload, { id: 'eb-job-bad', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(false);
      await expect(handleAccountAutoSyncRequisitionJob(pgBossJob(goodPayload, { id: 'eb-job-good', retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], h as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[1])).resolves.toBe(true);

      expect(h.accountService.syncAccountsForRequisition).toHaveBeenCalledTimes(1);
      expect(h.accountService.syncAccountsForRequisition).toHaveBeenCalledWith(expect.objectContaining({ enableBankingConnectionKey: 23 }));
    });
  });
});
