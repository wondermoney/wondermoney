import { describe, expect, it, vi } from 'vitest';

const { getAdminOperationMock } = vi.hoisted(() => ({ getAdminOperationMock: vi.fn() }));

vi.mock('@app/validators/parser', () => ({ zParse: vi.fn((_schema, req: unknown) => req) }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { getAdminOperation: getAdminOperationMock.mockResolvedValue({ appuserKey: { appuserKey: 7 }, attemptCount: 1, backgroundOperationKey: 1, correlationId: 'cid', errorCode: 'E1', finishedAt: null, lastHeartbeatAt: null, operationType: 'foundation.health-check', pgBossDashboard: null, progress: { p: 1 }, publicOperation: '/v1/operations/cid', queuedAt: null, queueJobId: 'job-1', queueProvider: 'pg-boss', resourceId: 'r', retryable: true, stage: 'stage', startedAt: null, status: 'failed', tenantKey: { tenantKey: 9 }, updatedAt: new Date('2026-01-01T00:00:00Z') }), getAdminSummary: vi.fn().mockResolvedValue({ byStatus: { failed: 2, queued: 1 }, byType: { 'foundation.health-check': 3 }, retryable: 2, stale: 1, total: 3 }), listAdminOperations: vi.fn().mockResolvedValue([{ appuserKey: null, attemptCount: 1, backgroundOperationKey: 1, correlationId: 'cid', errorCode: null, finishedAt: null, lastHeartbeatAt: null, operationType: 'foundation.health-check', pgBossDashboard: null, progress: null, publicOperation: '/v1/operations/cid', queuedAt: null, queueJobId: null, queueProvider: 'pg-boss', resourceId: 'r', retryable: true, stage: null, startedAt: null, status: 'failed', tenantKey: null, updatedAt: new Date('2026-01-01T00:00:00Z') }]), retryAdminOperation: vi.fn().mockResolvedValue({ jobId: 'job-new', operation: { appuserKey: null, attemptCount: 1, backgroundOperationKey: 1, correlationId: 'cid', errorCode: null, finishedAt: null, lastHeartbeatAt: null, operationType: 'foundation.health-check', pgBossDashboard: null, progress: null, publicOperation: '/v1/operations/cid', queuedAt: null, queueJobId: 'job-new', queueProvider: 'pg-boss', resourceId: 'r', retryable: true, stage: 'manual-retry:queued', startedAt: null, status: 'queued', tenantKey: null, updatedAt: new Date('2026-01-01T00:00:00Z') } }) } }));
vi.mock('@service/operations/background-operation-retry-registry', () => ({ getBackgroundOperationRetrySpec: vi.fn((type: string) => (type === 'foundation.health-check' ? {} : null)) }));

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { getAdminBackgroundOperation, getAdminBackgroundOperationSummary, listAdminBackgroundOperations, retryAdminBackgroundOperation } from '../admin/background-operation';

describe('admin background operation controller', () => {
  it('maps list dto and calls service', async () => {
    const json = vi.fn();
    await listAdminBackgroundOperations({ query: { limit: '50' } } as unknown as Parameters<typeof listAdminBackgroundOperations>[0], mockRes({ json }));
    expect(json).toHaveBeenCalledWith([expect.objectContaining({ operationKey: 1, pgBossDashboard: '/v1/admin/jobs', publicOperation: '/v1/operations/cid' })]);
  });

  it('maps detail dto and calls service', async () => {
    const json = vi.fn();
    await getAdminBackgroundOperation({ params: { operationId: 'cid' } } as unknown as Parameters<typeof getAdminBackgroundOperation>[0], mockRes({ json }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: 7, correlationId: 'cid', pgBossJob: '/v1/admin/jobs/jobs/job-1', queueJobId: 'job-1', retrySupported: true, tenantKey: 9 }));
  });

  it('returns admin summary', async () => {
    const json = vi.fn();
    await getAdminBackgroundOperationSummary({ query: {} } as unknown as Parameters<typeof getAdminBackgroundOperationSummary>[0], mockRes({ json }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ byStatus: { failed: 2, queued: 1 }, retryable: 2, total: 3 }));
  });

  it('returns retry dto with actual queue job id', async () => {
    const json = vi.fn();
    await retryAdminBackgroundOperation({ body: { reason: 'manual' }, params: { operationId: 'cid' } } as unknown as Parameters<typeof retryAdminBackgroundOperation>[0], mockRes({ json }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ queueJobId: 'job-new', stage: 'manual-retry:queued', status: 'queued' }));
  });

  it('reports retrySupported false for a type the registry no longer knows', async () => {
    // The admin UI renders its retry control from this flag. `portfolio.csv-import` was
    // removed from the retry registry when the legacy S3 import went, and production still
    // holds six non-terminal operations of that type from June — so this is the flag those
    // rows actually surface, not a hypothetical.
    //
    // Retrying one could not work with the producing endpoint gone. Reporting false is what
    // keeps the UI from offering a button that cannot succeed.
    // Hoisted mock fn rather than reaching through the service object, which trips
    // `unbound-method` when the reference is separated from its owner.
    getAdminOperationMock.mockResolvedValueOnce({
      appuserKey: null, attemptCount: 1, backgroundOperationKey: 2, correlationId: 'cid-2',
      errorCode: null, finishedAt: null, lastHeartbeatAt: null,
      operationType: 'portfolio.csv-import',
      progress: null, queuedAt: null, queueJobId: null, queueProvider: 'pg-boss',
      resourceId: 'portfolio-csv-import:9:::bucket:key', retryable: true,
      stage: null, startedAt: null, status: 'needs_action', tenantKey: null,
      updatedAt: new Date('2026-06-13T00:00:00Z'),
    });

    const json = vi.fn();
    await getAdminBackgroundOperation({ params: { operationId: 'cid-2' } } as unknown as Parameters<typeof getAdminBackgroundOperation>[0], mockRes({ json }));

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ operationType: 'portfolio.csv-import', retrySupported: false }));
  });
});
