import { beforeEach, describe, expect, it, vi } from 'vitest';

const markWorkerFailure = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@service/portfolio/portfolio-csv-parse-preview.service', () => ({
  default: class {
    parseImportSession() {
      return Promise.resolve({ status: 'READY_TO_IMPORT' });
    }
  },
}));

vi.mock('@service/portfolio/portfolio-import-session.service', () => ({
  default: { markWorkerFailure },
}));

vi.mock('@utils/logger', () => ({ default: logger }));

import { handlePortfolioCsvParsePreviewJob } from '@app/jobs/portfolio-csv-parse-preview.worker';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

type ParsePreviewDeps = Parameters<typeof handlePortfolioCsvParsePreviewJob>[1];
type ParsePreviewJob = Parameters<typeof handlePortfolioCsvParsePreviewJob>[0];
const parseJob = (data: unknown, id: string): ParsePreviewJob =>
  pgBossJob(data, { id }) as unknown as ParsePreviewJob;
const parseDeps = (parseImportSession: ReturnType<typeof vi.fn>): ParsePreviewDeps =>
  ({ parsePreviewService: { parseImportSession } }) as unknown as ParsePreviewDeps;

describe('portfolio csv parse preview worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markWorkerFailure.mockResolvedValue(true);
  });

  it('returns false for invalid payload', async () => {
    const parseImportSession = vi.fn();
    await expect(handlePortfolioCsvParsePreviewJob(parseJob({}, 'job'), parseDeps(parseImportSession))).resolves.toBe(false);
    expect(parseImportSession).not.toHaveBeenCalled();
  });

  it.each([
    ['string', { importSessionId: '456' }],
    ['zero', { importSessionId: 0 }],
    ['negative', { importSessionId: -1 }],
    ['fractional', { importSessionId: 1.5 }],
    ['too large', { importSessionId: Number.MAX_SAFE_INTEGER + 1 }],
  ])('returns false for invalid %s importSessionId', async (_label, data) => {
    const parseImportSession = vi.fn();
    await expect(handlePortfolioCsvParsePreviewJob(parseJob(data, 'job'), parseDeps(parseImportSession))).resolves.toBe(false);
    expect(parseImportSession).not.toHaveBeenCalled();
  });

  it('calls parse preview service and returns result', async () => {
    const parseImportSession = vi.fn().mockResolvedValue({ status: 'READY_TO_IMPORT' });
    await expect(
      handlePortfolioCsvParsePreviewJob(parseJob({ importSessionId: 42 }, 'job-1'), parseDeps(parseImportSession)),
    ).resolves.toEqual({ status: 'READY_TO_IMPORT' });
    expect(parseImportSession).toHaveBeenCalledWith({ importSessionId: 42 });
  });

  it('propagates service errors', async () => {
    const error = new Error('boom');
    const parseImportSession = vi.fn().mockRejectedValue(error);
    await expect(
      handlePortfolioCsvParsePreviewJob(parseJob({ correlationId: 'portfolio.csv-parse-preview:7:cid', importSessionId: 7 }, 'job-2'), parseDeps(parseImportSession)),
    ).rejects.toThrow('boom');

    expect(logger.error).toHaveBeenCalledWith({ error, importSessionId: 7, jobId: 'job-2' }, 'Portfolio CSV parse preview worker failed');

    expect(markWorkerFailure).toHaveBeenCalledWith({
      error,
      expectedStatus: 'parsing',
      importSessionId: 7,
      summaryKey: 'parseWorkerError',
    });
  });

  it('preserves original parse error if failure marking also rejects', async () => {
    const originalError = new Error('original parse boom');
    const persistenceError = new Error('persistence boom');
    const parseImportSession = vi.fn().mockRejectedValue(originalError);
    markWorkerFailure.mockRejectedValueOnce(persistenceError);

    await expect(
      handlePortfolioCsvParsePreviewJob(parseJob({ correlationId: 'portfolio.csv-parse-preview:7:cid', importSessionId: 7 }, 'job-3'), parseDeps(parseImportSession)),
    ).rejects.toBe(originalError);
    expect(markWorkerFailure).toHaveBeenCalledWith(expect.objectContaining({ error: originalError, importSessionId: 7 }));
  });
});
