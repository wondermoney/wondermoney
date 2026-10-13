import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockSession {
  expiresAt?: Date;
  s3Bucket: string;
  s3Key: string;
  status: string;
  summaryJson: Record<string, unknown> | undefined;
}

const mocked = vi.hoisted(() => ({
  enqueueConfirmed: vi.fn(),
  enqueuePreview: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  getObjectSize: vi.fn().mockResolvedValue(123),
  getOwnedSession: vi.fn(),
  isExpired: vi.fn((session: MockSession) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now())),
  persist: vi.fn().mockReturnThis(),
  session: {
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    s3Bucket: 'bucket',
    s3Key: 'portfolio-import-sessions/1/456/token.csv',
    status: 'waiting_for_upload',
    summaryJson: undefined as Record<string, unknown> | undefined,
  } as MockSession,
  transactional: vi.fn((callback: (em: { flush: typeof mocked.flush; persist: typeof mocked.persist; }) => unknown) => Promise.resolve(callback({ flush: mocked.flush, persist: mocked.persist }))),
}));

vi.mock('@app/app', () => ({ DI: { em: { flush: mocked.flush, persist: mocked.persist, transactional: mocked.transactional } } }));
vi.mock('@app/jobs/portfolio-csv-parse-preview.queue', () => ({ enqueuePortfolioCsvParsePreviewJob: mocked.enqueuePreview }));
vi.mock('@app/jobs/portfolio-csv-import-confirmed.queue', () => ({ enqueuePortfolioCsvImportConfirmedJob: mocked.enqueueConfirmed }));
vi.mock('@service/storage/s3', () => ({ default: { getObjectSize: mocked.getObjectSize } }));
vi.mock('@service/portfolio/portfolio-import-session.service', () => ({ default: { getOwnedSession: mocked.getOwnedSession, isExpired: mocked.isExpired } }));

import portfolioImportSessionTransitions from '@service/portfolio/portfolio-import-session-transitions';

const baseInput = { appuser: { appuserKey: 2 }, importSessionId: 456, tenant: { tenantKey: 1 } } as unknown as Parameters<typeof portfolioImportSessionTransitions.requestParse>[0];
const baseDeps = { enqueue: { send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() } } as unknown as Parameters<typeof portfolioImportSessionTransitions.requestParse>[1];

function resetSession() {
  mocked.session.expiresAt = new Date('2030-01-01T00:00:00.000Z');
  mocked.session.status = 'waiting_for_upload';
  mocked.session.summaryJson = undefined;
  mocked.session.s3Bucket = 'bucket';
  mocked.session.s3Key = 'portfolio-import-sessions/1/456/token.csv';
}

describe('portfolio import session transitions — parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSession();
    mocked.transactional.mockImplementation((callback: ( em: { flush: typeof mocked.flush; persist: typeof mocked.persist; } ) => unknown) => Promise.resolve(callback({ flush: mocked.flush, persist: mocked.persist })));
    mocked.getObjectSize.mockReset().mockResolvedValue(123);
    mocked.enqueuePreview.mockReset().mockResolvedValue('job-1');
    mocked.getOwnedSession.mockReset().mockResolvedValue(mocked.session);
    mocked.isExpired.mockClear().mockImplementation((session: MockSession) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now()));
  });

  it('locks the session, sets parsing, enqueues, and persists the jobId marker', async () => {
    const outcome = await portfolioImportSessionTransitions.requestParse(baseInput, baseDeps);
    expect(outcome.status).toBe('parsing');
    expect(outcome.correlationId).toMatch(/^portfolio\.csv-parse-preview:456:/);
    expect(mocked.session.status).toBe('parsing');
    expect(mocked.session.summaryJson).toEqual(expect.objectContaining({ parseCorrelationId: outcome.correlationId, parseJobId: 'job-1' }));
    expect(mocked.getObjectSize).toHaveBeenCalledWith('bucket', 'portfolio-import-sessions/1/456/token.csv');
  });

  it('rejects expired sessions before queueing parse work', async () => {
    mocked.session.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('Import session has expired');
    expect(mocked.enqueuePreview).not.toHaveBeenCalled();
  });

  it('returns the existing correlation id when the session is already parsing with both markers', async () => {
    mocked.session.status = 'parsing';
    mocked.session.summaryJson = { parseCorrelationId: 'portfolio.csv-parse-preview:456:existing', parseJobId: 'job-existing' };
    const outcome = await portfolioImportSessionTransitions.requestParse(baseInput, baseDeps);
    expect(outcome.correlationId).toBe('portfolio.csv-parse-preview:456:existing');
    expect(mocked.enqueuePreview).not.toHaveBeenCalled();
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('rejects parsing while a parse job is still being queued', async () => {
    mocked.session.status = 'parsing';
    mocked.session.summaryJson = { parseCorrelationId: 'portfolio.csv-parse-preview:456:existing' };
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('Import session parse is being queued');
  });

  it('rejects when the upload object is not available yet', async () => {
    mocked.getObjectSize.mockRejectedValueOnce(Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 }, name: 'NoSuchKey' }));
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('Import session upload is not available yet');
    expect(mocked.enqueuePreview).not.toHaveBeenCalled();
    expect(mocked.session.status).toBe('waiting_for_upload');
  });

  it('rolls back the parsing transition when enqueue throws', async () => {
    mocked.enqueuePreview.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('queue unavailable');
    expect(mocked.session.status).toBe('waiting_for_upload');
    expect(mocked.session.summaryJson).toBeUndefined();
  });

  it('compensates when parse enqueue returns null', async () => {
    mocked.enqueuePreview.mockResolvedValueOnce(null);
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('Portfolio import session parse queue returned no job id');
    expect(mocked.session.status).toBe('waiting_for_upload');
    expect(mocked.session.summaryJson).toBeUndefined();
  });

  it('keeps parsing state when marker persistence fails after enqueue succeeds', async () => {
    mocked.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('marker persist failed'));
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('marker persist failed');
    expect(mocked.session.status).toBe('parsing');
    expect(mocked.session.summaryJson).toHaveProperty('parseCorrelationId');
    expect(mocked.session.summaryJson).toHaveProperty('parseJobId', 'job-1');
  });

  it('does not roll back another parsing request after enqueue failure', async () => {
    mocked.enqueuePreview.mockRejectedValueOnce(new Error('queue unavailable'));
    mocked.getOwnedSession.mockImplementationOnce(() => Promise.resolve(mocked.session)).mockImplementationOnce(() => {
      mocked.session.status = 'parsing';
      mocked.session.summaryJson = { parseCorrelationId: 'portfolio.csv-parse-preview:456:other' };
      return Promise.resolve(mocked.session);
    });
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('queue unavailable');
    expect(mocked.session.status).toBe('parsing');
    expect(mocked.session.summaryJson).toEqual({ parseCorrelationId: 'portfolio.csv-parse-preview:456:other' });
  });

  it('rejects terminal sessions', async () => {
    mocked.session.status = 'succeeded';
    await expect(portfolioImportSessionTransitions.requestParse(baseInput, baseDeps)).rejects.toThrow('Import session cannot be parsed');
  });
});

describe('portfolio import session transitions — confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSession();
    mocked.transactional.mockImplementation((callback: ( em: { flush: typeof mocked.flush; persist: typeof mocked.persist; } ) => unknown) => Promise.resolve(callback({ flush: mocked.flush, persist: mocked.persist })));
    mocked.enqueueConfirmed.mockReset().mockResolvedValue('job-1');
    mocked.getOwnedSession.mockReset().mockResolvedValue(mocked.session);
    mocked.isExpired.mockClear().mockImplementation((session: MockSession) => Boolean(session.expiresAt && session.expiresAt.getTime() <= Date.now()));
  });

  it('moves a ready session to importing and enqueues the confirm job', async () => {
    mocked.session.status = 'ready_to_import';
    mocked.session.summaryJson = { existing: true };
    const outcome = await portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps);
    expect(outcome.status).toBe('importing');
    expect(outcome.correlationId).toMatch(/^portfolio\.csv-import-confirmed:456:/);
    expect(mocked.session.status).toBe('importing');
    expect(mocked.session.summaryJson).toEqual(expect.objectContaining({ confirmCorrelationId: outcome.correlationId, existing: true }));
  });

  it('confirms eligible partial sessions (readyRows > 0, no asset-review blockers)', async () => {
    mocked.session.status = 'partial';
    mocked.session.summaryJson = { needsAssetReviewRows: 0, readyRows: 2 };
    const outcome = await portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps);
    expect(outcome.status).toBe('importing');
  });

  it('rejects non-ready sessions', async () => {
    mocked.session.status = 'waiting_for_upload';
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('Import session cannot be confirmed');
  });

  it('rejects partial sessions without ready rows or with asset-review blockers', async () => {
    mocked.session.status = 'partial';
    mocked.session.summaryJson = { needsAssetReviewRows: 0, readyRows: 0 };
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('Import session cannot be confirmed');
    mocked.session.summaryJson = { needsAssetReviewRows: 1, readyRows: 2 };
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('Import session cannot be confirmed');
  });

  it('rejects expired sessions', async () => {
    mocked.session.status = 'ready_to_import';
    mocked.session.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('Import session has expired');
  });

  it('rolls back to the previous status when enqueue throws', async () => {
    mocked.session.status = 'ready_to_import';
    mocked.session.summaryJson = { existing: true };
    mocked.enqueueConfirmed.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('queue unavailable');
    expect(mocked.session.status).toBe('ready_to_import');
    expect(mocked.session.summaryJson).toEqual({ existing: true });
  });

  it('does not roll back a confirm transition after the worker advanced its state', async () => {
    mocked.session.status = 'ready_to_import';
    mocked.enqueueConfirmed.mockImplementationOnce(() => {
      mocked.session.status = 'succeeded';
      mocked.session.summaryJson = { confirmCorrelationId: 'worker-correlation', worker: true };
      return Promise.reject(new Error('send failed'));
    });
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('send failed');
    expect(mocked.session.status).toBe('succeeded');
    expect(mocked.session.summaryJson).toEqual({ confirmCorrelationId: 'worker-correlation', worker: true });
  });

  it('rolls back eligible partial sessions to partial when enqueue returns null', async () => {
    mocked.session.status = 'partial';
    mocked.session.summaryJson = { duplicateRows: 1, needsAssetReviewRows: 0, readyRows: 2 };
    mocked.enqueueConfirmed.mockResolvedValueOnce(null);
    await expect(portfolioImportSessionTransitions.requestConfirm(baseInput, baseDeps)).rejects.toThrow('Portfolio import session confirm queue returned no job id');
    expect(mocked.session.status).toBe('partial');
    expect(mocked.session.summaryJson).toEqual({ duplicateRows: 1, needsAssetReviewRows: 0, readyRows: 2 });
  });
});
