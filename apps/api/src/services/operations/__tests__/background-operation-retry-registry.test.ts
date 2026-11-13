import type { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const { em } = vi.hoisted(() => ({ em: { findOne: vi.fn() } }));
const completeIncident = vi.hoisted(() => vi.fn().mockResolvedValue({ incidentId: 'incident-recovered' }));
vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/bank-sync/bank-sync-incident.service', () => ({ BankSyncIncidentService: class { completeOrAllocateLegacyIncident = completeIncident; } }));

import { enqueueFoundationJob } from '@app/jobs/queue';
import { buildAccountAutoSyncRequisitionJobPayload, buildAccountInitialSyncJobPayload } from '@service/bank-sync/bank-sync-job-payload';
import type { OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';
import type { RecoveryTransport } from '@service/queue/recovery-transport';
import { ConflictError } from '@utils/errors';

import { type BackgroundOperationRetryType, getBackgroundOperationRetrySpec, type RetryOperation } from '../background-operation-retry-registry';

const OWNER = { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const connection = (overrides: Record<string, unknown> = {}) => ({
  appuserKey: OWNER, bankConnectionKey: 12, externalId: 'session-12', provider: 'enable_banking', state: 'state-12', status: 'linked', tenantKey: { tenantKey: 3 }, ...overrides,
});
const initialSync: RetryOperation = { appuserKey: { appuserKey: 7 }, correlationId: 'account.initial-sync:12', operationType: 'account.initial-sync', resourceId: 'bank-connection:12', tenantKey: { tenantKey: 3 } };
const autoSync: RetryOperation = { appuserKey: { appuserKey: 7 }, correlationId: 'account.auto-sync.requisition:run-1:12', operationType: 'account.auto-sync.requisition', resourceId: 'bank-connection:12' };

async function foundationProducerPayload(correlationId: string) {
  const send = vi.fn().mockResolvedValue('job');
  await enqueueFoundationJob({ correlationId }, { enqueue: { send, sendAfter: vi.fn() } });
  return send.mock.calls[0]?.[1] as unknown;
}

function spec(type: string) {
  const found = getBackgroundOperationRetrySpec(type);
  if (!found) throw new Error(`missing spec for ${type}`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
  em.findOne.mockReset();
});

describe('background operation retry registry', () => {
  it('accepts real and owned pg-boss transports', () => {
    expectTypeOf<PgBoss>().toExtend<RecoveryTransport>();
    expectTypeOf<OwnedProducerRuntime['boss']>().toExtend<RecoveryTransport>();
  });

  // Keyed by every retryable type, so a type added to the registry fails to compile here until
  // its retry is shown to rebuild what its producer enqueues.
  const cases: Record<BackgroundOperationRetryType, { expected: () => Promise<unknown>; operation: RetryOperation; singletonKey: string }> = {
    'account.auto-sync.requisition': {
      expected: () => Promise.resolve(buildAccountAutoSyncRequisitionJobPayload(connection(), { incidentId: 'incident-recovered', scheduleRunId: 'run-1' })),
      operation: autoSync,
      singletonKey: 'account.auto-sync.connection:12',
    },
    // The schedule, the price refresh and the health check create their operation from the job's
    // correlation id, so the retry hands back that id and the worker resumes the same operation.
    'account.auto-sync.schedule': {
      expected: () => Promise.resolve({ correlationId: 'schedule-cid' }),
      operation: { correlationId: 'schedule-cid', operationType: 'account.auto-sync.schedule', resourceId: 'account-auto-sync:scheduled-scan' },
      singletonKey: 'schedule-cid',
    },
    'account.initial-sync': {
      expected: () => Promise.resolve(buildAccountInitialSyncJobPayload(connection(), 'incident-recovered')),
      operation: initialSync,
      singletonKey: 'account.initial-sync:12',
    },
    'asset-price.refresh': {
      expected: () => Promise.resolve({ correlationId: 'price-cid' }),
      operation: { correlationId: 'price-cid', operationType: 'asset-price.refresh', resourceId: 'asset-price-refresh:scheduled-run' },
      singletonKey: 'asset-price.refresh',
    },
    'foundation.health-check': {
      expected: () => foundationProducerPayload('health-cid'),
      operation: { correlationId: 'health-cid', operationType: 'foundation.health-check', resourceId: 'foundation' },
      singletonKey: 'health-cid',
    },
  };

  it.each(Object.entries(cases))('rebuilds the job a %s producer enqueues', async (type, { expected, operation, singletonKey }) => {
    em.findOne.mockResolvedValue(connection());
    const retry = spec(type);

    await expect(retry.buildPayload(operation)).resolves.toEqual(await expected());
    await expect(retry.buildSingletonKey?.(operation) ?? Promise.resolve(operation.correlationId)).resolves.toBe(singletonKey);
  });

  it('carries the bank-provider fields the workers check, for any provider', async () => {
    em.findOne.mockResolvedValue(connection());
    await expect(spec('account.initial-sync').buildPayload(initialSync)).resolves.toEqual({
      bankConnectionKey: '12', connectionId: 'session-12', correlationId: 'account.initial-sync:12', incidentId: 'incident-recovered', provider: 'enable_banking',
    });
    em.findOne.mockResolvedValue(connection());
    await expect(spec('account.auto-sync.requisition').buildPayload(autoSync)).resolves.toEqual({
      appuserKey: 7, bankConnectionKey: '12', connectionId: 'session-12', correlationId: 'account.auto-sync.requisition:run-1:12', incidentId: 'incident-recovered', provider: 'enable_banking', scheduleRunId: 'run-1',
    });
  });

  it('finds the incident the producer allocated for the same correlation and connection', async () => {
    em.findOne.mockResolvedValue(connection());
    await spec('account.auto-sync.requisition').buildPayload(autoSync);
    expect(completeIncident).toHaveBeenLastCalledWith(expect.objectContaining({
      appuserKey: 7, correlationId: autoSync.correlationId, flow: 'scheduled-refresh', producer: 'pgboss-scheduled', requisitionId: 'session-12', userVisible: false,
    }));
  });

  it.each([
    ['a legacy Enable Banking operation', { resourceId: 'enable-banking-connection:12' }],
    ['a legacy requisition operation', { resourceId: 'nordigen-requisition:12' }],
    ['a malformed resource', { resourceId: 'bad' }],
    ['a missing resource', { resourceId: undefined }],
    ['a correlation naming another connection', { correlationId: 'account.initial-sync:99' }],
  ])('refuses %s', async (_name, overrides) => {
    em.findOne.mockResolvedValue(connection());
    await expect(spec('account.initial-sync').buildPayload({ ...initialSync, ...overrides })).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([
    ['a missing connection', null],
    ['an unlinked connection', connection({ status: 'created' })],
    ['a connection with no owner', connection({ appuserKey: undefined })],
    ['a connection owned by someone else', connection({ appuserKey: { ...OWNER, appuserKey: 8 } })],
    ['a connection in another household', connection({ tenantKey: { tenantKey: 4 } })],
  ])('refuses %s', async (_name, stored) => {
    em.findOne.mockResolvedValue(stored);
    await expect(spec('account.initial-sync').buildPayload(initialSync)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a connection whose provider the operator has turned off', async () => {
    vi.stubEnv('BANK_PROVIDERS', 'none');
    em.findOne.mockResolvedValue(connection());
    await expect(spec('account.initial-sync').buildPayload(initialSync)).rejects.toBeInstanceOf(ConflictError);
    // SimpleFIN is opt-in: off unless the operator names it.
    vi.unstubAllEnvs();
    em.findOne.mockResolvedValue(connection({ provider: 'simplefin' }));
    await expect(spec('account.initial-sync').buildPayload(initialSync)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rebuilds a SimpleFIN sync the same way once the operator enables it', async () => {
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking,simplefin');
    em.findOne.mockResolvedValue(connection({ provider: 'simplefin' }));
    await expect(spec('account.initial-sync').buildPayload(initialSync)).resolves.toEqual(buildAccountInitialSyncJobPayload(connection({ provider: 'simplefin' }), 'incident-recovered'));
  });

  it('refuses a scheduled sync whose correlation does not name its connection', async () => {
    em.findOne.mockResolvedValue(connection());
    await expect(spec('account.auto-sync.requisition').buildPayload({ ...autoSync, correlationId: 'account.auto-sync.requisition:run-1:99' })).rejects.toBeInstanceOf(ConflictError);
    await expect(spec('account.auto-sync.requisition').buildSingletonKey?.({ ...autoSync, resourceId: 'enable-banking-connection:12' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns null for unsupported operation types', () => {
    expect(getBackgroundOperationRetrySpec('unknown.type')).toBeNull();
  });
});
