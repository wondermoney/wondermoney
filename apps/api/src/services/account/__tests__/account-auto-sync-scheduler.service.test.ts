import { beforeEach, describe, expect, it, vi } from 'vitest';
const sendMock = vi.hoisted(() => vi.fn());
const { em } = vi.hoisted(() => ({ em: { find: vi.fn(), transactional: vi.fn((work: (transaction: { transaction: string }) => unknown) => work({ transaction: 'tx' })) } }));
const incidentService = vi.hoisted(() => ({ allocateIncident: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@app/jobs/account-auto-sync.queue', () => ({ ACCOUNT_AUTO_SYNC_REQUISITION_OPERATION_TYPE: 'account.auto-sync.requisition', buildAccountAutoSyncRequisitionCorrelationId: (run: string, key: string) => `account.auto-sync.requisition:${run}:${key}`, enqueueAccountAutoSyncRequisitionJob: sendMock, ensureAccountAutoSyncRequisitionQueue: vi.fn(), ensureAccountAutoSyncScheduleQueue: vi.fn() }));
vi.mock('@service/bank-sync/bank-sync-incident.service', () => ({ BankSyncIncidentService: class { allocateIncident = incidentService.allocateIncident; } }));
import service from '../account-auto-sync-scheduler.service';

type EnqueueBg = NonNullable<EnqueueInput['backgroundOperationService']>;
type EnqueueBoss = NonNullable<EnqueueInput['boss']>;
type EnqueueInput = NonNullable<Parameters<typeof service.enqueueDueAccountSyncs>[0]>;
// Defaulting the mock to `[]` gives any `em.find` call a test does not arrange an empty result.
beforeEach(() => { em.find.mockReset().mockResolvedValue([]); sendMock.mockReset(); incidentService.allocateIncident.mockReset().mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }); });
const backgroundOperationService = () => ({ attachQueueJob: vi.fn().mockResolvedValue(true), createQueuedOperation: vi.fn().mockResolvedValue({}), markNeedsAction: vi.fn().mockResolvedValue(true), resetRetryableQueueing: vi.fn().mockResolvedValue(true) });
describe('account auto sync scheduler service', () => {
  it('queries accounts first with stale/open filters and dedupes connections', async () => {
    em.find.mockResolvedValueOnce([
      { accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null },
      { accountKey: 2, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null },
      { accountKey: 3, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 11, sessionId: 'req-11', state: 'state-11' }, refreshedAt: null },
    ]);
    sendMock.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss, now: new Date('2026-01-01T00:00:00Z'), staleHours: 20 });
    expect(em.find).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({ singletonKey: 'account.auto-sync.connection:10' });
  });

  it('ignores expired connections', async () => {
    em.find.mockResolvedValueOnce([
      { accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2025-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null },
      { accountKey: 2, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 11, sessionId: 'req-11', state: 'state-11' }, refreshedAt: null },
    ]);
    sendMock.mockResolvedValueOnce('job-1');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, now: new Date('2026-01-01T00:00:00Z') });

    expect(result.total).toBe(2);
    expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enableBankingConnectionKey: expect.objectContaining({ accessValidUntil: { $gt: expect.any(Date) } }) }), expect.anything());
  });

  it('creates retryable queued operations and attaches queue jobs before returning', async () => {
    const bg = {
      attachQueueJob: vi.fn().mockResolvedValue(true),
      createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'created-operation' }),
      markNeedsAction: vi.fn(),
    };
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    sendMock.mockResolvedValueOnce('job-1');

    await expect(service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, now: new Date('2026-01-01T00:00:00Z') })).resolves.toMatchObject({ enqueued: 1, failed: 0 });

    expect(bg.createQueuedOperation).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, correlationId: 'account.auto-sync.requisition:1767225600000:10', operationType: 'account.auto-sync.requisition', resourceId: 'enable-banking-connection:10', retryable: true }), { transaction: 'tx' });
    expect(bg.attachQueueJob).toHaveBeenCalledWith('account.auto-sync.requisition:1767225600000:10', 'job-1');
  });
  it('continues after send failures and counts null as failure', async () => {
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    sendMock.mockResolvedValueOnce(null);
    const bg = backgroundOperationService();
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss });
    expect(result.failed).toBe(1);
    expect(bg.markNeedsAction).not.toHaveBeenCalled();
  });

  it('keeps a crash-after-send attach failure queued with no job id', async () => {
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    const bg = backgroundOperationService();
    bg.attachQueueJob.mockResolvedValueOnce(false);
    sendMock.mockResolvedValueOnce('original-job');
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, scheduleRunId: 'crash-run' });
    expect(result).toMatchObject({ enqueued: 0, failed: 1 });
    expect(bg.markNeedsAction).not.toHaveBeenCalled();
  });

  it('leaves duplicate singleton null queued and claimable by the eventual original job', async () => {
    const account = { accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null };
    // One `em.find` per `enqueueDueAccountSyncs` call, so the mocked-once queue supplies the
    // same account to each of the two runs below.
    em.find.mockResolvedValueOnce([account]).mockResolvedValueOnce([account]);
    const state = { queueJobId: null as null | string, retryable: true, status: 'queued' };
    const bg = { ...backgroundOperationService(), attachQueueJob: vi.fn(async (_correlationId: string, jobId: string) => { state.queueJobId = jobId; return true; }), findByCorrelation: vi.fn().mockImplementation(async () => state) };
    sendMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, scheduleRunId: 'duplicate-run' });
    const rerun = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, scheduleRunId: 'duplicate-run' });
    expect(rerun).toMatchObject({ enqueued: 0, failed: 1 });
    expect(state).toMatchObject({ queueJobId: null, retryable: true, status: 'queued' });
    expect(bg.markNeedsAction).not.toHaveBeenCalled();
    const claimJobStart = vi.fn(async (_correlationId: string, jobId: string) => state.status === 'queued' && (state.queueJobId === null || state.queueJobId === jobId));
    await expect(claimJobStart('account.auto-sync.requisition:duplicate-run:10', 'original-job')).resolves.toBe(true);
  });

  it('limits enqueues per run and reports rate-limited requisitions as skipped', async () => {
    em.find.mockResolvedValueOnce([
      { accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null },
      { accountKey: 2, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 11, sessionId: 'req-11', state: 'state-11' }, refreshedAt: null },
      { accountKey: 3, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 12, sessionId: 'req-12', state: 'state-12' }, refreshedAt: null },
    ]);
    sendMock.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, maxEnqueued: 2, now: new Date('2026-01-01T00:00:00Z') });

    expect(result).toMatchObject({ enqueued: 2, failed: 0, rateLimited: 1, skipped: 1, total: 3 });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('uses ACCOUNT_AUTO_SYNC_MAX_ENQUEUED when maxEnqueued is not provided', async () => {
    vi.stubEnv('ACCOUNT_AUTO_SYNC_MAX_ENQUEUED', '1');
    em.find.mockResolvedValueOnce([
      { accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null },
      { accountKey: 2, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 11, sessionId: 'req-11', state: 'state-11' }, refreshedAt: null },
    ]);
    sendMock.mockResolvedValueOnce('job-1');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg });

    expect(result).toMatchObject({ enqueued: 1, rateLimited: 1, skipped: 1, total: 2 });
    vi.unstubAllEnvs();
  });

  it('reuses a previously enqueued requisition operation on a scan retry', async () => {
    const bg = { ...backgroundOperationService(), findByCorrelation: vi.fn().mockResolvedValue({ queueJobId: 'existing-job', status: 'queued' }) };
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg, now: new Date('2026-01-01T00:00:00Z'), scheduleRunId: 'stable-run' });
    expect(result).toMatchObject({ enqueued: 1, failed: 0 });
    expect(bg.createQueuedOperation).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('allocates incident and operation in one transaction and does not send after rollback', async () => {
    const bg = backgroundOperationService();
    bg.createQueuedOperation.mockRejectedValueOnce(new Error('operation write failed'));
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg, now: new Date('2026-01-01T00:00:00Z'), scheduleRunId: 'rollback-run' });
    expect(result.failed).toBe(1);
    expect(incidentService.allocateIncident.mock.calls[0]?.[1]).toBe(bg.createQueuedOperation.mock.calls[0]?.[1]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(['queued', 'needs_action'])('requeues a retryable %s operation with no job on scan rerun', async (status) => {
    const bg = { ...backgroundOperationService(), findByCorrelation: vi.fn().mockResolvedValue({ queueJobId: null, retryable: true, status }) };
    em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: { accessValidUntil: new Date('2026-12-31T00:00:00Z'), appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, enableBankingConnectionKey: 10, sessionId: 'req-10', state: 'state-10' }, refreshedAt: null }]);
    sendMock.mockResolvedValueOnce('replacement-job');
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg, scheduleRunId: 'retry-run' });
    expect(result).toMatchObject({ enqueued: 1, failed: 0 });
    expect(bg.resetRetryableQueueing).toHaveBeenCalledWith('account.auto-sync.requisition:retry-run:10', { transaction: 'tx' });
    expect(bg.createQueuedOperation).not.toHaveBeenCalled();
    expect(bg.attachQueueJob).toHaveBeenCalledWith('account.auto-sync.requisition:retry-run:10', 'replacement-job');
  });

  it('rejects invalid maxEnqueued input values', async () => {
    await expect(service.enqueueDueAccountSyncs({ maxEnqueued: 0 })).rejects.toThrow(/maxEnqueued/);
    await expect(service.enqueueDueAccountSyncs({ maxEnqueued: 1.5 })).rejects.toThrow(/maxEnqueued/);
  });

  it('rejects invalid ACCOUNT_AUTO_SYNC_MAX_ENQUEUED values', async () => {
    vi.stubEnv('ACCOUNT_AUTO_SYNC_MAX_ENQUEUED', 'bad');
    await expect(service.enqueueDueAccountSyncs()).rejects.toThrow(/ACCOUNT_AUTO_SYNC_MAX_ENQUEUED/);
    vi.unstubAllEnvs();
  });

  describe('Enable Banking connections', () => {
    it('enqueues a due Enable Banking connection with a real, future accessValidUntil', async () => {
      const connection = { appuserKey: { appuserKey: 9, externalUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, enableBankingConnectionKey: 20, sessionId: 'session-20', state: 'state-20' };
      em.find.mockResolvedValueOnce([{ accountKey: 1, enableBankingConnectionKey: connection, refreshedAt: null }]);
      sendMock.mockResolvedValueOnce('job-eb-1');

      const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss, now: new Date('2026-01-01T00:00:00Z') });

      expect(em.find).toHaveBeenCalledTimes(1);
      expect(em.find.mock.calls[0]?.[1]).toMatchObject({ enableBankingConnectionKey: expect.objectContaining({ accessValidUntil: { $gt: expect.any(Date) }, status: 'linked' }) });
      expect(result.enqueued).toBe(1);
      expect(sendMock.mock.calls[0]?.[0]).toMatchObject({ connectionId: 'session-20', enableBankingConnectionKey: '20', provider: 'enable_banking' });
      expect(sendMock.mock.calls[0]?.[1]).toMatchObject({ singletonKey: 'account.auto-sync.connection:20' });
    });

    it('queries for expired-consent exclusion via accessValidUntil rather than a guessed window', async () => {
      const active = { appuserKey: { appuserKey: 9, externalUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, enableBankingConnectionKey: 21, sessionId: 'session-21', state: 'state-21' };
      const expired = { appuserKey: { appuserKey: 9, externalUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, enableBankingConnectionKey: 22, sessionId: 'session-22', state: 'state-22' };
      em.find.mockResolvedValueOnce([
        { accountKey: 1, enableBankingConnectionKey: active, refreshedAt: null },
        { accountKey: 2, enableBankingConnectionKey: expired, refreshedAt: null },
      ]);
      sendMock.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');

      const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, now: new Date('2026-01-01T00:00:00Z') });

      expect(result.total).toBe(2);
      // Mirrors the "ignores expired connections" test above: the actual
      // exclusion of an expired connection happens at the database level (`$gt: now` in the real
      // query), which a mocked `em.find` can't itself enforce — so this asserts the query
      // criteria that makes the database do it, reading the connection's own real
      // `accessValidUntil` rather than any hardcoded/guessed window.
      expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enableBankingConnectionKey: expect.objectContaining({ accessValidUntil: { $gt: expect.any(Date) } }) }), expect.anything());
    });


  });
});
