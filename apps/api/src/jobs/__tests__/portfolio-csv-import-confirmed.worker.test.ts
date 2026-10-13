import { beforeEach, describe, expect, it, vi } from 'vitest';

const { finalizeImportSessionMock, triggerPostImportMaintenanceMock } = vi.hoisted(() => ({
  finalizeImportSessionMock: vi.fn(),
  triggerPostImportMaintenanceMock: vi.fn(),
}));

const { markWorkerFailure } = vi.hoisted(() => ({
  markWorkerFailure: vi.fn(),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@service/portfolio/portfolio-import-finalize.service', () => ({
  default: { finalizeImportSession: finalizeImportSessionMock },
}));

vi.mock('@service/portfolio/portfolio-import-maintenance.service', () => ({
  default: { triggerPostImportMaintenance: triggerPostImportMaintenanceMock },
}));

vi.mock('@service/portfolio/portfolio-import-session.service', () => ({
  default: { markWorkerFailure },
}));

vi.mock('@utils/logger', () => ({ default: logger }));

import { handlePortfolioCsvImportConfirmedJob } from '@app/jobs/portfolio-csv-import-confirmed.worker';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

type ConfirmedJob = Parameters<typeof handlePortfolioCsvImportConfirmedJob>[0];
const confirmedJob = (data: unknown, id: string): ConfirmedJob =>
  pgBossJob(data, { id }) as unknown as ConfirmedJob;

describe('portfolio csv import confirmed worker', () => {
  const enqueue = { send: vi.fn(), sendAfter: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    markWorkerFailure.mockResolvedValue(true);
    triggerPostImportMaintenanceMock.mockResolvedValue(undefined);
  });

  it.each([
    ['missing correlationId', { importSessionId: 1 }],
    ['string importSessionId', { correlationId: 'portfolio.csv-import-confirmed:1:abc', importSessionId: '1' }],
    ['fractional importSessionId', { correlationId: 'portfolio.csv-import-confirmed:1:abc', importSessionId: 1.5 }],
    ['negative/zero importSessionId', { correlationId: 'portfolio.csv-import-confirmed:1:abc', importSessionId: 0 }],
    ['negative/zero importSessionId', { correlationId: 'portfolio.csv-import-confirmed:1:abc', importSessionId: -1 }],
    ['unsafe integer importSessionId', { correlationId: 'portfolio.csv-import-confirmed:9007199254740992:abc', importSessionId: 9007199254740992 }],
    ['mismatched correlationId/importSessionId', { correlationId: 'portfolio.csv-import-confirmed:2:abc', importSessionId: 1 }],
  ])('throws on invalid payload: %s', async (_label, data) => {
    await expect(handlePortfolioCsvImportConfirmedJob(confirmedJob(data, 'job-1'), { enqueue })).rejects.toThrow('Invalid portfolio csv import confirmed job payload');
    expect(finalizeImportSessionMock).not.toHaveBeenCalled();
  });

  it('calls finalizer with importSessionId and returns result', async () => {
    finalizeImportSessionMock.mockResolvedValueOnce({ ok: true });

    await expect(
      handlePortfolioCsvImportConfirmedJob(confirmedJob({ correlationId: 'portfolio.csv-import-confirmed:42:cid', importSessionId: 42 }, 'job-2'), { enqueue }),
    ).resolves.toEqual({ ok: true });

    expect(finalizeImportSessionMock).toHaveBeenCalledWith(
      { importSessionId: 42 },
      { triggerMaintenance: expect.any(Function) },
    );
    const firstCall = finalizeImportSessionMock.mock.calls[0]!;
    const deps = firstCall[1] as { triggerMaintenance: (input: { portfolioId: number }) => Promise<void> };
    await deps.triggerMaintenance({ portfolioId: 42 });
    expect(triggerPostImportMaintenanceMock).toHaveBeenCalledWith({ portfolioId: 42 }, { enqueue });
  });

  it('does not depend on legacy csv import service', async () => {
    finalizeImportSessionMock.mockResolvedValueOnce({ importedRows: 1 });

    await handlePortfolioCsvImportConfirmedJob(confirmedJob({ correlationId: 'portfolio.csv-import-confirmed:7:cid-2', importSessionId: 7 }, 'job-3'), { enqueue });

    expect(finalizeImportSessionMock).toHaveBeenCalledTimes(1);
  });

  it('marks importing sessions failed before propagating finalizer errors', async () => {
    const finalizerError = new Error('finalizer boom');
    finalizeImportSessionMock.mockRejectedValueOnce(finalizerError);

    await expect(
      handlePortfolioCsvImportConfirmedJob(confirmedJob({ correlationId: 'portfolio.csv-import-confirmed:42:cid', importSessionId: 42 }, 'job-4'), { enqueue }),
    ).rejects.toThrow('finalizer boom');

    expect(logger.error).toHaveBeenCalledWith({ error: finalizerError, importSessionId: 42, jobId: 'job-4' }, 'Portfolio CSV import confirmed worker failed');

    expect(markWorkerFailure).toHaveBeenCalledWith({
      error: finalizerError,
      expectedStatus: 'importing',
      importSessionId: 42,
      summaryKey: 'importWorkerError',
    });
  });

  it('preserves original finalize error if failure marking also rejects', async () => {
    const originalError = new Error('original finalize boom');
    const persistenceError = new Error('persistence boom');
    finalizeImportSessionMock.mockRejectedValueOnce(originalError);
    markWorkerFailure.mockRejectedValueOnce(persistenceError);

    await expect(
      handlePortfolioCsvImportConfirmedJob(confirmedJob({ correlationId: 'portfolio.csv-import-confirmed:42:cid', importSessionId: 42 }, 'job-5'), { enqueue }),
    ).rejects.toBe(originalError);
    expect(markWorkerFailure).toHaveBeenCalledWith(expect.objectContaining({ error: originalError, importSessionId: 42 }));
  });
});
