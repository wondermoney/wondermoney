import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessageMock, findOneMock, flushMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
  findOneMock: vi.fn(),
  flushMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@sentry/node', () => ({ captureMessage: captureMessageMock }));
vi.mock('@app/database/di', () => ({ DI: { em: { findOne: findOneMock, flush: flushMock } } }));

import { handleTransactionEnrichmentDlqJob } from '@app/jobs/transaction-enrichment-dlq.worker';
import { TransactionEnrichmentStatus } from '@entity/TransactionEnrichment';

const silentLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const payload = {
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'v1',
  transactionEnrichmentKey: 77,
};
const job = (data: unknown = payload) => ({ data, id: 'dlq-job-1' } as Job<unknown>);

describe('transaction enrichment dead-letter consumer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks the enrichment row DLQ and raises one aggregated alert', async () => {
    // Before this consumer existed, the only dead-letter queue in the system had no
    // consumer at all: poisoned jobs parked until retention deleted them, and the only
    // trace was an enrichment row stuck non-terminal that nothing queried.
    const enrichment = { status: TransactionEnrichmentStatus.PENDING };
    findOneMock.mockResolvedValue(enrichment);

    await expect(handleTransactionEnrichmentDlqJob(job(), { logger: silentLogger })).resolves.toBe(true);

    expect(enrichment.status).toBe(TransactionEnrichmentStatus.DLQ);
    expect(flushMock).toHaveBeenCalledOnce();
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [, options] = captureMessageMock.mock.calls[0] as [string, { extra: Record<string, unknown>; fingerprint: string[] }];
    expect(options.fingerprint).toEqual(['pgboss-dead-letter', 'transaction.enrichment.gpt.dlq']);
    expect(options.extra['transactionEnrichmentKey']).toBe(77);
  });

  it('does not overwrite an already-terminal outcome', async () => {
    const enrichment = { status: TransactionEnrichmentStatus.COMPLETED };
    findOneMock.mockResolvedValue(enrichment);

    await expect(handleTransactionEnrichmentDlqJob(job(), { logger: silentLogger })).resolves.toBe(true);

    expect(enrichment.status).toBe(TransactionEnrichmentStatus.COMPLETED);
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('still alerts when the payload is unreadable', async () => {
    await expect(handleTransactionEnrichmentDlqJob(job({ nonsense: true }), { logger: silentLogger })).resolves.toBe(false);
    expect(captureMessageMock).toHaveBeenCalledOnce();
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it('consumes rather than rethrows when its own DB write fails', async () => {
    // A job that dead-letters out of a dead-letter queue has nowhere left to go, and the
    // alert has already fired.
    findOneMock.mockRejectedValue(new Error('db down'));
    await expect(handleTransactionEnrichmentDlqJob(job(), { logger: silentLogger })).resolves.toBe(false);
    expect(captureMessageMock).toHaveBeenCalledOnce();
  });
});
