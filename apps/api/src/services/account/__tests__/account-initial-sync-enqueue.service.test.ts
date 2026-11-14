import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackgroundOperationStatus } from '@entity/BackgroundOperation';

const { em } = vi.hoisted(() => ({ em: { findOne: vi.fn(), transactional: vi.fn((work: (transaction: { transaction: string }) => unknown): unknown => work({ transaction: 'tx' })) } }));
const backgroundOperationService = vi.hoisted(() => ({
  default: {
    attachQueueJob: vi.fn(),
    createQueuedOperation: vi.fn(),
    finish: vi.fn(),
    markNeedsAction: vi.fn(),
  },
}));
const pgboss = vi.hoisted(() => ({ createQueue: vi.fn(), send: vi.fn(), start: vi.fn(), stop: vi.fn() }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
const incidentService = vi.hoisted(() => ({ allocateIncident: vi.fn(), finalizeAttempt: vi.fn(), startAttempt: vi.fn() }));

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/operations/background-operation.service', () => backgroundOperationService);
vi.mock('@utils/logger', () => ({ default: logger }));
vi.mock('@service/bank-sync/bank-sync-incident.service', () => ({ BankSyncIncidentService: class { allocateIncident = incidentService.allocateIncident; finalizeAttempt = incidentService.finalizeAttempt; startAttempt = incidentService.startAttempt; } }));

import service, { AccountInitialSyncQueueError } from '../account-initial-sync-enqueue.service';

type EnqueueDeps = Parameters<typeof service.enqueue>[1];
type EnqueueTarget = Parameters<typeof service.enqueue>[0];
// The service duck-types its sync target (it only reads the identity fields), so tests drive it with
// plain object literals rather than full EnableBankingConnection entities.
const enqueueSync = (syncTarget: object, deps: EnqueueDeps) => service.enqueue(syncTarget as EnqueueTarget, deps);

describe('account initial sync enqueue service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pgboss.createQueue.mockResolvedValue(undefined);
    pgboss.start.mockResolvedValue(undefined);
    pgboss.stop.mockResolvedValue(undefined);
    incidentService.allocateIncident.mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    incidentService.startAttempt.mockResolvedValue({ attempt: 1 });
    incidentService.finalizeAttempt.mockResolvedValue({});
  });

  it('creates a stable operation, enqueues one job, and attaches its id', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:12', retryable: true });
    backgroundOperationService.default.attachQueueJob.mockResolvedValueOnce(true);
    const send = vi.fn().mockResolvedValueOnce('job-1');

    // When
    const result = await enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 12, externalId: 'req-1', provider: 'enable_banking', state: 'state-12', tenantKey: { tenantKey: 9 } },
      { enqueue: { send, sendAfter: vi.fn() } },
    );

    // Then
    expect(backgroundOperationService.default.createQueuedOperation).toHaveBeenCalledWith({
      appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      correlationId: 'account.initial-sync:12',
      operationType: 'account.initial-sync',
      resourceId: 'bank-connection:12',
      retryable: true,
      tenantKey: 9,
    }, { transaction: 'tx' });
    expect(send).toHaveBeenCalledWith(
      'account.initial-sync',
      { bankConnectionKey: '12', connectionId: 'req-1', correlationId: 'account.initial-sync:12', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', provider: 'enable_banking' },
      { singletonKey: 'account.initial-sync:12' },
    );
    expect(backgroundOperationService.default.attachQueueJob).toHaveBeenCalledWith('account.initial-sync:12', 'job-1');
    expect(result).toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation: { correlationId: 'account.initial-sync:12', retryable: true } });
  });

  it('allocates incident then operation in one transaction and stops on either failure', async () => {
    em.findOne.mockResolvedValue(null);
    const send = vi.fn();
    incidentService.allocateIncident.mockRejectedValueOnce(new Error('incident write failed'));
    await expect(enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 20, externalId: 'req-20', provider: 'enable_banking', state: 'state-20', tenantKey: { tenantKey: 9 } }, { enqueue: { send, sendAfter: vi.fn() } })).rejects.toThrow();
    expect(backgroundOperationService.default.createQueuedOperation).not.toHaveBeenCalled();

    vi.clearAllMocks();
    em.findOne.mockResolvedValue(null);
    incidentService.allocateIncident.mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    backgroundOperationService.default.createQueuedOperation.mockRejectedValueOnce(new Error('operation write failed'));
    await expect(enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 21, externalId: 'req-21', provider: 'enable_banking', state: 'state-21', tenantKey: { tenantKey: 9 } }, { enqueue: { send, sendAfter: vi.fn() } })).rejects.toThrow();
    expect(incidentService.allocateIncident.mock.invocationCallOrder[0]).toBeLessThan(backgroundOperationService.default.createQueuedOperation.mock.invocationCallOrder[0] ?? 0);
    expect(incidentService.allocateIncident.mock.calls[0]?.[1]).toBe(backgroundOperationService.default.createQueuedOperation.mock.calls[0]?.[1]);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { bankConnectionKey: undefined, externalId: 'req-1' },
    { bankConnectionKey: 0, externalId: 'req-1', provider: 'enable_banking', state: 'state-0' },
    
  ])('rejects malformed requisition identifiers before creating an operation', async (requisition) => {
    // Given / When
    const result = enqueueSync(requisition, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } });

    // Then
    await expect(result).rejects.toMatchObject({ queueAccepted: false });
    expect(backgroundOperationService.default.createQueuedOperation).not.toHaveBeenCalled();
    expect(pgboss.createQueue).not.toHaveBeenCalled();
  });

  it('returns an existing active operation without enqueueing a duplicate', async () => {
    // Given
    const operation = { appuserKey: { appuserKey: 7 }, correlationId: 'account.initial-sync:12', operationType: 'account.initial-sync', status: 'running' };
    const incident = { appuserKey: { appuserKey: 7 }, flow: 'initial-add', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', producer: 'pgboss-initial', userVisible: true };
    em.findOne.mockResolvedValueOnce(operation).mockResolvedValueOnce(incident);

    // When / Then
    await expect(enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 12, externalId: 'req-1', provider: 'enable_banking', state: 'state-12', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } })).resolves.toEqual({ incidentId: incident.incidentId, operation });
    expect(backgroundOperationService.default.createQueuedOperation).not.toHaveBeenCalled();
    expect(pgboss.send).not.toHaveBeenCalled();
  });

  it.each([BackgroundOperationStatus.FAILED, BackgroundOperationStatus.NEEDS_ACTION, BackgroundOperationStatus.PARTIAL, BackgroundOperationStatus.STALE])(
    'returns the validated handle for an existing terminal %s operation',
    async (status) => {
      // Given
      const operation = { appuserKey: { appuserKey: 7 }, correlationId: 'account.initial-sync:12', operationType: 'account.initial-sync', retryable: true, status };
      const incident = { appuserKey: { appuserKey: 7 }, flow: 'initial-add', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', producer: 'pgboss-initial', userVisible: true };
      em.findOne.mockResolvedValueOnce(operation).mockResolvedValueOnce(incident);

      // When
      const result = enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 12, externalId: 'req-1', provider: 'enable_banking', state: 'state-12', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } });

      // Then
      await expect(result).resolves.toEqual({ incidentId: incident.incidentId, operation });
      expect(backgroundOperationService.default.createQueuedOperation).not.toHaveBeenCalled();
      expect(pgboss.send).not.toHaveBeenCalled();
    },
  );

  it('reuses the operation created by a concurrent callback', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique constraint violation')));
    const existing = { appuserKey: { appuserKey: 7 }, correlationId: 'account.initial-sync:12', operationType: 'account.initial-sync', status: 'queued' };
    em.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce({ appuserKey: { appuserKey: 7 }, flow: 'initial-add', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', producer: 'pgboss-initial', userVisible: true });

    // When / Then
    await expect(enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 12, externalId: 'req-1', provider: 'enable_banking', state: 'state-12', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } })).resolves.toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation: existing });
    expect(backgroundOperationService.default.attachQueueJob).not.toHaveBeenCalled();
  });

  it('does not treat an incident-allocation SQLSTATE as operation concurrency', async () => {
    em.findOne.mockResolvedValueOnce(null);
    incidentService.allocateIncident.mockRejectedValueOnce(Object.assign(new Error('incident duplicate'), { code: '23505' }));

    await expect(enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 22, externalId: 'req-22', provider: 'enable_banking', state: 'state-22', tenantKey: { tenantKey: 9 } },
      { enqueue: { send: vi.fn(), sendAfter: vi.fn() } },
    )).rejects.toBeInstanceOf(AccountInitialSyncQueueError);
    expect(em.findOne).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the connection has no stored tenant', async () => {
    // No tenant on the requisition — a legacy or cross-tenant work item must
    // never reach pg-boss. The service should reject before the queue is touched.
    em.findOne.mockReset();
    const enqueue = enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 99, externalId: 'req-legacy', provider: 'enable_banking', state: 'state-99' },
      { enqueue: { send: vi.fn(), sendAfter: vi.fn() } },
    );
    await expect(enqueue).rejects.toBeInstanceOf(AccountInitialSyncQueueError);
    await expect(enqueue).rejects.toThrow(/missing tenant ownership/i);
    expect(incidentService.allocateIncident).not.toHaveBeenCalled();
    expect(pgboss.send).not.toHaveBeenCalled();
  });

  it('returns a failed operation created by a concurrent callback with its validated incident', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));
    const operation = { appuserKey: { appuserKey: 7 }, correlationId: 'account.initial-sync:12', operationType: 'account.initial-sync', retryable: true, status: BackgroundOperationStatus.FAILED };
    const incident = { appuserKey: { appuserKey: 7 }, flow: 'initial-add', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', producer: 'pgboss-initial', userVisible: true };
    em.findOne.mockResolvedValueOnce(operation).mockResolvedValueOnce(incident);
    const send = vi.fn();

    // When
    const result = enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 12, externalId: 'req-1', provider: 'enable_banking', state: 'state-12', tenantKey: { tenantKey: 9 } },
      { enqueue: { send, sendAfter: vi.fn() } },
    );

    // Then
    await expect(result).resolves.toEqual({ incidentId: incident.incidentId, operation });
    expect(send).not.toHaveBeenCalled();
    expect(backgroundOperationService.default.attachQueueJob).not.toHaveBeenCalled();
  });

  it.each(['duplicate queue failure', 'constraint queue failure'])(
    'never treats queue error text as a concurrent allocation: %s',
    async (message) => {
      em.findOne.mockResolvedValueOnce(null);
      backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:19' });
      const result = enqueueSync(
        { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 19, externalId: 'req-19', provider: 'enable_banking', state: 'state-19', tenantKey: { tenantKey: 9 } },
        { enqueue: { send: vi.fn().mockRejectedValueOnce(new Error(message)), sendAfter: vi.fn() } },
      );
      await expect(result).rejects.toBeInstanceOf(AccountInitialSyncQueueError);
      expect(incidentService.finalizeAttempt).toHaveBeenCalledOnce();
    },
  );

  it('records a null job id as a terminal retryable failure', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:13' });
    backgroundOperationService.default.finish.mockResolvedValueOnce(true);

    // When
    const result = enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 13, externalId: 'req-2', provider: 'enable_banking', state: 'state-13', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn().mockResolvedValueOnce(null), sendAfter: vi.fn() } });

    // Then
    await expect(result).rejects.toMatchObject({ queueAccepted: false });
    expect(incidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ final: false, result: 'failed', treatmentEligible: false }));
    expect(backgroundOperationService.default.finish).not.toHaveBeenCalled();
  });

  it('records queue rejection as a terminal retryable failure', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:14' });
    backgroundOperationService.default.finish.mockResolvedValueOnce(true);

    // When
    const result = enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 14, externalId: 'req-3', provider: 'enable_banking', state: 'state-14', tenantKey: { tenantKey: 9 } },
      { enqueue: { send: vi.fn().mockRejectedValueOnce(new Error('pg-boss unavailable')), sendAfter: vi.fn() } },
    );

    // Then
    await expect(result).rejects.toBeInstanceOf(AccountInitialSyncQueueError);
    expect(incidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ final: false, result: 'failed', treatmentEligible: false }));
    expect(backgroundOperationService.default.finish).not.toHaveBeenCalled();
  });

  it('keeps an accepted but unattached job queued for worker claim or recovery', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    const operation = { correlationId: 'account.initial-sync:15', retryable: true, status: BackgroundOperationStatus.QUEUED };
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce(operation);
    backgroundOperationService.default.attachQueueJob.mockResolvedValueOnce(false);

    // When
    const result = await enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 15, externalId: 'req-4', provider: 'enable_banking', state: 'state-15', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn().mockResolvedValueOnce('job-2'), sendAfter: vi.fn() } });

    // Then
    expect(result).toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation });
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'attach-queue-job' },
      'Account initial sync job accepted without attached queue id',
    );
    expect(backgroundOperationService.default.markNeedsAction).not.toHaveBeenCalled();
    expect(backgroundOperationService.default.finish).not.toHaveBeenCalled();
  });

  it('returns the accepted handle when attaching the queue job throws', async () => {
    em.findOne.mockResolvedValueOnce(null);
    const operation = { correlationId: 'account.initial-sync:16', status: BackgroundOperationStatus.QUEUED };
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce(operation);
    backgroundOperationService.default.attachQueueJob.mockRejectedValueOnce(new Error('attach boom'));

    await expect(enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 16, externalId: 'req-5', provider: 'enable_banking', state: 'state-16', tenantKey: { tenantKey: 9 } },
      { enqueue: { send: vi.fn().mockResolvedValueOnce('job-sensitive'), sendAfter: vi.fn() } },
    )).resolves.toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation });

    expect(incidentService.startAttempt).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { stage: 'attach-queue-job' },
      'Account initial sync job accepted without attached queue id',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('job-sensitive');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('account.initial-sync:16');
  });

  it('returns the accepted handle without owning boss shutdown', async () => {
    em.findOne.mockResolvedValueOnce(null);
    const operation = { correlationId: 'account.initial-sync:17', status: BackgroundOperationStatus.QUEUED };
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce(operation);
    backgroundOperationService.default.attachQueueJob.mockResolvedValueOnce(true);
    pgboss.send.mockResolvedValueOnce('job-17');
    pgboss.stop.mockRejectedValueOnce(new Error('stop boom'));

    await expect(enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 17, externalId: 'req-6', provider: 'enable_banking', state: 'state-17', tenantKey: { tenantKey: 9 } }, { enqueue: { send: pgboss.send, sendAfter: vi.fn() } },
    )).resolves.toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation });

    expect(incidentService.startAttempt).not.toHaveBeenCalled();
    expect(pgboss.stop).not.toHaveBeenCalled();
  });

  it('returns the accepted handle when attachment and telemetry fail', async () => {
    em.findOne.mockResolvedValueOnce(null);
    const operation = { correlationId: 'account.initial-sync:23', status: BackgroundOperationStatus.QUEUED };
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce(operation);
    backgroundOperationService.default.attachQueueJob.mockRejectedValueOnce(new Error('attach boom'));
    pgboss.send.mockResolvedValueOnce('job-23');
    pgboss.stop.mockRejectedValueOnce(new Error('stop boom'));
    logger.warn.mockImplementation(() => { throw new Error('logger boom'); });

    await expect(enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 23, externalId: 'req-8', provider: 'enable_banking', state: 'state-23', tenantKey: { tenantKey: 9 } }, { enqueue: { send: pgboss.send, sendAfter: vi.fn() } },
    )).resolves.toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation });

    expect(incidentService.startAttempt).not.toHaveBeenCalled();
  });

  it('preserves the typed pre-acceptance failure when failure recording throws', async () => {
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:24' });
    pgboss.send.mockRejectedValueOnce(new Error('send boom'));
    pgboss.stop.mockRejectedValueOnce(new Error('stop boom'));
    incidentService.startAttempt.mockRejectedValueOnce(new Error('incident recording boom'));

    await expect(enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 24, externalId: 'req-9', provider: 'enable_banking', state: 'state-24', tenantKey: { tenantKey: 9 } }, { enqueue: { send: pgboss.send, sendAfter: vi.fn() } },
    )).rejects.toMatchObject({
      incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      queueAccepted: false,
    });

    expect(pgboss.stop).not.toHaveBeenCalledWith({ graceful: true, timeout: 5000 });
  });

  it('records a pg-boss startup rejection as a terminal retryable failure', async () => {
    // Given
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:18' });
    backgroundOperationService.default.finish.mockResolvedValueOnce(true);
    pgboss.start.mockRejectedValueOnce(new Error('start boom'));

    // When
    const result = enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 18, externalId: 'req-7', provider: 'enable_banking', state: 'state-18', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } });

    // Then
    await expect(result).rejects.toMatchObject({ queueAccepted: false });
    expect(incidentService.finalizeAttempt).toHaveBeenCalledWith(expect.objectContaining({ final: false, result: 'failed' }));
    expect(pgboss.stop).not.toHaveBeenCalledWith({ graceful: true, timeout: 5000 });
  });
});

// Enqueueing from an EnableBankingConnection instead of a NordigenRequisition. Discriminated on
// `enableBankingConnectionKey` presence (duck-typed, see `normalizeSyncTarget`'s docblock) — every
// other line of the allocation/enqueue body is the exact same code the requisition tests above exercise.
describe('account initial sync enqueue service — Enable Banking', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pgboss.createQueue.mockResolvedValue(undefined);
    pgboss.start.mockResolvedValue(undefined);
    pgboss.stop.mockResolvedValue(undefined);
    incidentService.allocateIncident.mockResolvedValue({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    incidentService.startAttempt.mockResolvedValue({ attempt: 1 });
    incidentService.finalizeAttempt.mockResolvedValue({});
  });

  it('creates a stable operation and enqueues an enable_banking-shaped job from a linked connection', async () => {
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:5', retryable: true });
    backgroundOperationService.default.attachQueueJob.mockResolvedValueOnce(true);
    const send = vi.fn().mockResolvedValueOnce('job-eb-1');

    const result = await enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 5, externalId: 'session-1', provider: 'enable_banking', tenantKey: { tenantKey: 9 } },
      { enqueue: { send, sendAfter: vi.fn() } },
    );

    expect(backgroundOperationService.default.createQueuedOperation).toHaveBeenCalledWith({
      appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      correlationId: 'account.initial-sync:5',
      operationType: 'account.initial-sync',
      resourceId: 'bank-connection:5',
      retryable: true,
      tenantKey: 9,
    }, { transaction: 'tx' });
    expect(send).toHaveBeenCalledWith(
      'account.initial-sync',
      { bankConnectionKey: '5', connectionId: 'session-1', correlationId: 'account.initial-sync:5', incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', provider: 'enable_banking' },
      { singletonKey: 'account.initial-sync:5' },
    );
    expect(result).toEqual({ incidentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', operation: { correlationId: 'account.initial-sync:5', retryable: true } });
  });

  it('falls back to the pre-link state for connectionId when no sessionId exists yet', async () => {
    em.findOne.mockResolvedValueOnce(null);
    backgroundOperationService.default.createQueuedOperation.mockResolvedValueOnce({ correlationId: 'account.initial-sync:6' });
    const send = vi.fn().mockResolvedValueOnce('job-eb-2');

    await enqueueSync(
      { appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 6, externalId: undefined, provider: 'enable_banking', state: 'pre-link-state', tenantKey: { tenantKey: 9 } },
      { enqueue: { send, sendAfter: vi.fn() } },
    );

    expect(send).toHaveBeenCalledWith('account.initial-sync', expect.objectContaining({ connectionId: 'pre-link-state' }), expect.anything());
  });

  it('rejects an invalid connection key before touching the queue', async () => {
    await expect(enqueueSync({ appuserKey: { appuserKey: 7 }, bankConnectionKey: 0, provider: 'enable_banking', tenantKey: { tenantKey: 9 } }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } })).rejects.toThrow(/identifiers are invalid/);
  });

  it('rejects a connection missing tenant ownership', async () => {
    em.findOne.mockResolvedValueOnce(null);
    await expect(enqueueSync({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, bankConnectionKey: 7, externalId: 'session-x', provider: 'enable_banking' }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } })).rejects.toThrow(/missing tenant ownership/);
  });
});
