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

const owner = { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
/** A `BankConnection` row as the scheduler reads it. */
const connection = (bankConnectionKey: number, overrides: Record<string, unknown> = {}) => ({
  accessValidUntil: new Date('2026-12-31T00:00:00Z'),
  appuserKey: owner,
  bankConnectionKey,
  externalId: `req-${bankConnectionKey}`,
  provider: 'enable_banking',
  state: `state-${bankConnectionKey}`,
  status: 'linked',
  ...overrides,
});

// Defaulting the mock to `[]` gives any `em.find` call a test does not arrange an empty result.
beforeEach(() => { em.find.mockReset().mockResolvedValue([]); sendMock.mockReset(); incidentService.allocateIncident.mockReset().mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }); });
const backgroundOperationService = () => ({ attachQueueJob: vi.fn().mockResolvedValue(true), createQueuedOperation: vi.fn().mockResolvedValue({}), markNeedsAction: vi.fn().mockResolvedValue(true), resetRetryableQueueing: vi.fn().mockResolvedValue(true) });

describe('account auto sync scheduler service', () => {
  it('queries generic connections and enqueues one job per connection', async () => {
    em.find.mockResolvedValueOnce([connection(10), connection(11)]);
    sendMock.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss, now: new Date('2026-01-01T00:00:00Z'), staleHours: 20 });
    expect(em.find).toHaveBeenCalledTimes(1);
    expect(result.enqueued).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({ singletonKey: 'account.auto-sync.connection:10' });
  });

  it('asks only for linked connections with a future consent and no pending deferral', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, now });
    const where = em.find.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(where).toMatchObject({ accessValidUntil: { $gt: now }, status: 'linked' });
    expect(where['$and']).toContainEqual({ $or: [{ nextEligibleSyncAt: null }, { nextEligibleSyncAt: { $lte: now } }] });
    expect(where['$and']).toContainEqual({ $or: [{ lastSyncAttemptAt: null }, { lastSyncAttemptAt: { $lte: expect.any(Date) } }] });
  });

  it('creates retryable queued operations and attaches queue jobs before returning', async () => {
    const bg = {
      attachQueueJob: vi.fn().mockResolvedValue(true),
      createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'created-operation' }),
      markNeedsAction: vi.fn(),
    };
    em.find.mockResolvedValueOnce([connection(10)]);
    sendMock.mockResolvedValueOnce('job-1');

    await expect(service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, now: new Date('2026-01-01T00:00:00Z') })).resolves.toMatchObject({ enqueued: 1, failed: 0 });

    expect(bg.createQueuedOperation).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: owner, correlationId: 'account.auto-sync.requisition:1767225600000:10', operationType: 'account.auto-sync.requisition', resourceId: 'bank-connection:10', retryable: true }), { transaction: 'tx' });
    expect(bg.attachQueueJob).toHaveBeenCalledWith('account.auto-sync.requisition:1767225600000:10', 'job-1');
  });

  it('continues after send failures and counts null as failure', async () => {
    em.find.mockResolvedValueOnce([connection(10)]);
    sendMock.mockResolvedValueOnce(null);
    const bg = backgroundOperationService();
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss });
    expect(result.failed).toBe(1);
    expect(bg.markNeedsAction).not.toHaveBeenCalled();
  });

  it('keeps a crash-after-send attach failure queued with no job id', async () => {
    em.find.mockResolvedValueOnce([connection(10)]);
    const bg = backgroundOperationService();
    bg.attachQueueJob.mockResolvedValueOnce(false);
    sendMock.mockResolvedValueOnce('original-job');
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg as unknown as EnqueueBg, scheduleRunId: 'crash-run' });
    expect(result).toMatchObject({ enqueued: 0, failed: 1 });
    expect(bg.markNeedsAction).not.toHaveBeenCalled();
  });

  it('leaves duplicate singleton null queued and claimable by the eventual original job', async () => {
    em.find.mockResolvedValueOnce([connection(10)]).mockResolvedValueOnce([connection(10)]);
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

  it('limits enqueues per run and reports rate-limited connections as skipped', async () => {
    em.find.mockResolvedValueOnce([connection(10), connection(11), connection(12)]);
    sendMock.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, maxEnqueued: 2, now: new Date('2026-01-01T00:00:00Z') });

    expect(result).toMatchObject({ enqueued: 2, failed: 0, rateLimited: 1, skipped: 1, total: 3 });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('uses ACCOUNT_AUTO_SYNC_MAX_ENQUEUED when maxEnqueued is not provided', async () => {
    vi.stubEnv('ACCOUNT_AUTO_SYNC_MAX_ENQUEUED', '1');
    em.find.mockResolvedValueOnce([connection(10), connection(11)]);
    sendMock.mockResolvedValueOnce('job-1');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg });

    expect(result).toMatchObject({ enqueued: 1, rateLimited: 1, skipped: 1, total: 2 });
    vi.unstubAllEnvs();
  });

  it('reuses a previously enqueued connection operation on a scan retry', async () => {
    const bg = { ...backgroundOperationService(), findByCorrelation: vi.fn().mockResolvedValue({ queueJobId: 'existing-job', status: 'queued' }) };
    em.find.mockResolvedValueOnce([connection(10)]);
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg, now: new Date('2026-01-01T00:00:00Z'), scheduleRunId: 'stable-run' });
    expect(result).toMatchObject({ enqueued: 1, failed: 0 });
    expect(bg.createQueuedOperation).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('allocates incident and operation in one transaction and does not send after rollback', async () => {
    const bg = backgroundOperationService();
    bg.createQueuedOperation.mockRejectedValueOnce(new Error('operation write failed'));
    em.find.mockResolvedValueOnce([connection(10)]);
    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: bg, now: new Date('2026-01-01T00:00:00Z'), scheduleRunId: 'rollback-run' });
    expect(result.failed).toBe(1);
    expect(incidentService.allocateIncident.mock.calls[0]?.[1]).toBe(bg.createQueuedOperation.mock.calls[0]?.[1]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(['queued', 'needs_action'])('requeues a retryable %s operation with no job on scan rerun', async (status) => {
    const bg = { ...backgroundOperationService(), findByCorrelation: vi.fn().mockResolvedValue({ queueJobId: null, retryable: true, status }) };
    em.find.mockResolvedValueOnce([connection(10)]);
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

  it('refuses to scan with an invalid BANK_SYNC_MIN_INTERVAL_HOURS rather than silently using the default', async () => {
    vi.stubEnv('BANK_SYNC_MIN_INTERVAL_HOURS', 'six');
    await expect(service.enqueueDueAccountSyncs()).rejects.toThrow(/BANK_SYNC_MIN_INTERVAL_HOURS/);
    vi.unstubAllEnvs();
  });

  it('enqueues a due connection with a real, future accessValidUntil', async () => {
    em.find.mockResolvedValueOnce([connection(20, { appuserKey: { appuserKey: 9, externalUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, externalId: 'session-20' })]);
    sendMock.mockResolvedValueOnce('job-eb-1');

    const result = await service.enqueueDueAccountSyncs({ backgroundOperationService: backgroundOperationService() as unknown as EnqueueBg, boss: { send: vi.fn() } as unknown as EnqueueBoss, now: new Date('2026-01-01T00:00:00Z') });

    expect(em.find).toHaveBeenCalledTimes(1);
    expect(em.find.mock.calls[0]?.[1]).toMatchObject({ accessValidUntil: { $gt: expect.any(Date) }, status: 'linked' });
    expect(result.enqueued).toBe(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({ bankConnectionKey: '20', connectionId: 'session-20', provider: 'enable_banking' });
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({ singletonKey: 'account.auto-sync.connection:20' });
  });
});
