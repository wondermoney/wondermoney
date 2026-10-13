import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/validators/parser', () => ({ zParse: vi.fn().mockResolvedValue({ params: { operationId: 'cid' } }) }));
vi.mock('../../app.js', () => ({ DI: { em: {} } }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { getVisibleOperationForUser: vi.fn().mockResolvedValue({ appuserKey: 2, attemptCount: 1, correlationId: 'cid', errorCode: null, finishedAt: null, lastHeartbeatAt: null, operationType: 'type', progress: { p: 1 }, queuedAt: null, queueJobId: 'job', queueProvider: 'pg-boss', resourceId: 'r', retryable: false, stage: 's', startedAt: null, status: 'queued', tenantKey: 1 }) } }));

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { getBackgroundOperation } from '../background-operation';

describe('background operation controller', () => {
  it('returns safe DTO fields', async () => {
    const json = vi.fn();
    await getBackgroundOperation({ params: { operationId: 'cid' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof getBackgroundOperation>[0], mockRes({ json }));
    expect(json).toHaveBeenCalledWith({
      errorCode: null,
      finishedAt: null,
      lastHeartbeatAt: null,
      operationId: 'cid',
      progress: { p: 1 },
      queuedAt: null,
      resourceId: 'r',
      retryable: false,
      stage: 's',
      startedAt: null,
      status: 'queued',
      type: 'type',
    });
  });
});
