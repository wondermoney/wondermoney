import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyZodObject } from 'zod';

const mocked = vi.hoisted(() => ({
  attachQueueJob: vi.fn().mockResolvedValue(true),
  createImportSession: vi.fn(),
  createQueuedOperation: vi.fn().mockResolvedValue({ correlationId: 'cid' }),
  enqueue: vi.fn().mockResolvedValue({ correlationId: 'cid', status: 'queued' }),
  find: vi.fn(),
  findOne: vi.fn(),
  finish: vi.fn().mockResolvedValue(true),
  flush: vi.fn().mockResolvedValue(undefined),
  getEodhdDividends: vi.fn(),
  getPortfolioCsvBucketName: vi.fn().mockReturnValue('portfolios-csv-dev'),
  getPortfoliosHoldings: vi.fn(),
  innerJoin: vi.fn(),
  markNeedsAction: vi.fn().mockResolvedValue(true),
  persist: vi.fn().mockReturnThis(),
  presignedUrl: vi.fn(),
  raw: vi.fn((value: unknown) => value),
  reviewPresignedUrl: vi.fn(),
  select: vi.fn(),
  send: vi.fn().mockResolvedValue('job-1'),
  whereIn: vi.fn(),
  whereNull: vi.fn(),
}));
const requestEnqueue = { send: mocked.send, sendAfter: vi.fn() };

vi.mock('@app/validators/parser', () => ({
  zParse: vi.fn(((_schema: AnyZodObject, req: unknown) => Promise.resolve(req)) as unknown as Parameters<typeof vi.fn>[0]),
}));

vi.mock('../../app.js', () => ({
  DI: {
    em: {
      find: mocked.find,
      findOne: mocked.findOne,
      flush: mocked.flush,
      getKnex: () => {
        const queryBuilder = {
          innerJoin: mocked.innerJoin,
          select: mocked.select,
          whereIn: mocked.whereIn,
          whereNull: mocked.whereNull,
        };
        mocked.innerJoin.mockReturnValue(queryBuilder);
        mocked.select.mockReturnValue(queryBuilder);
        mocked.whereNull.mockReturnValue(queryBuilder);
        // `whereIn` terminates the snapshot-balance chain, so it is the thenable the
        // controller awaits (see getPortfolios in controller/portfolio.ts).
        mocked.whereIn.mockReturnValue(queryBuilder);
        const knex = vi.fn(() => queryBuilder) as unknown as ((table: string) => typeof queryBuilder) & {
          raw: typeof mocked.raw;
        };
        knex.raw = mocked.raw;
        return knex;
      },
      persist: mocked.persist,
    },
  },
}));

vi.mock('@service/market-data/eodhd.service', () => ({
  default: {
    getDividends: mocked.getEodhdDividends,
  },
}));
vi.mock('@service/storage/s3', () => ({
  default: {
    generatePresignedUrlForPortfolioCsv: mocked.presignedUrl,
    generatePresignedUrlForPortfolioImportSessionCsv: mocked.reviewPresignedUrl,
    getPortfolioCsvBucketName: mocked.getPortfolioCsvBucketName,
  },
}));
vi.mock('@service/portfolio/portfolio-import-session.service', () => ({
  default: {
    createSession: mocked.createImportSession,
  },
}));
vi.mock('@service/operations/background-operation.service', () => ({ default: { attachQueueJob: mocked.attachQueueJob, createQueuedOperation: mocked.createQueuedOperation, finish: mocked.finish, markNeedsAction: mocked.markNeedsAction } }));
vi.mock('../../services/portfolio/portfolio-holdings.service.js', () => ({ default: { getPortfoliosHoldings: mocked.getPortfoliosHoldings } }));

import { zParse } from '@app/validators/parser';
import { BadRequestError, NotFoundError } from '@utils/errors';

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { createPortfolioImportSession, getHoldingAnalystData, getHoldingValuation, getPortfolio, getPortfolios, rebuildPortfolioSnapshot } from '../portfolio';

describe('portfolio controller scenarios', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    process.env['PORTFOLIO_SNAPSHOT_MANUAL_URL'] = 'https://snapshot.example';
    process.env['PORTFOLIO_SNAPSHOT_MANUAL_TOKEN'] = 'snapshot-token';
    mocked.find.mockReset();
    mocked.findOne.mockReset();
    mocked.flush.mockReset().mockResolvedValue(undefined);
    mocked.persist.mockReset().mockReturnThis();
    mocked.innerJoin.mockReset();
    mocked.whereIn.mockReset();
    mocked.whereNull.mockReset();
    mocked.enqueue.mockReset().mockResolvedValue({ correlationId: 'cid', status: 'queued' });
    mocked.attachQueueJob.mockReset().mockResolvedValue(true);
    mocked.getPortfolioCsvBucketName.mockReset().mockReturnValue('portfolios-csv-dev');
    mocked.presignedUrl.mockReset();
    mocked.raw.mockReset();
    mocked.select.mockReset();
    mocked.createQueuedOperation.mockReset().mockResolvedValue({ correlationId: 'cid' });
    mocked.createImportSession.mockReset();
    mocked.finish.mockReset().mockResolvedValue(true);
    mocked.send.mockReset().mockResolvedValue('job-1');
    mocked.markNeedsAction.mockReset().mockResolvedValue(true);
    mocked.reviewPresignedUrl.mockReset();
    mocked.getPortfoliosHoldings.mockReset();
    vi.mocked(zParse).mockReset().mockImplementation(((_schema: AnyZodObject, req: unknown) => Promise.resolve(req)) as unknown as typeof zParse);
  });

  it('creates a review import session and returns isolated upload URL', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({
      body: { mode: 'review' },
      params: { portfolioId: 1 },
    });
    mocked.createImportSession.mockImplementationOnce((input: { correlationId?: string; s3Key: string }) => {
      const token = /pending\/(.+)\.csv$/.exec(input.s3Key)?.[1] ?? input.correlationId?.split(':').at(-1) ?? 'missing-token';
      return Promise.resolve({
        correlationId: `portfolio.csv-import-session:1:456:${token}`,
        expiresAt: new Date('2026-07-16T00:00:00.000Z'),
        portfolioImportSessionKey: 456,
        status: 'waiting_for_upload',
      });
    });
    mocked.reviewPresignedUrl.mockResolvedValueOnce({
      key: 'portfolio-import-sessions/1/456/generated-token.csv',
      maxUploadSizeBytes: 5 * 1024 * 1024,
      presignedUrl: 'https://example.com/review-upload.csv',
      uploadHeaders: { 'Content-Type': 'text/csv' },
      uploadMethod: 'PUT',
    });

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    await createPortfolioImportSession(
      { body: { mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
      mockRes({ json, status }),
    );

    expect(mocked.createImportSession).toHaveBeenCalledWith(expect.objectContaining({
      appuser: { appuserKey: 1 },
      portfolioId: 1,
      s3Bucket: expect.stringMatching(/^portfolios-csv-/),
      s3Key: expect.stringMatching(/^portfolio-import-sessions\/1\/pending\//),
      tenant: { tenantKey: 9 },
    }));
    const createSessionCall = mocked.createImportSession.mock.calls[0]?.[0] as { correlationId?: string; s3Key: string };
    const s3KeyToken = /pending\/(.+)\.csv$/.exec(createSessionCall.s3Key)?.[1];
    const correlationToken = createSessionCall.correlationId?.split(':').at(-1);
    const reviewToken = mocked.reviewPresignedUrl.mock.calls[0]?.[0].token;
    expect(s3KeyToken).toBeDefined();
    expect(correlationToken).toBeDefined();
    expect(s3KeyToken).toBe(correlationToken);
    expect(reviewToken).toBe(s3KeyToken);
    expect(mocked.reviewPresignedUrl).toHaveBeenCalledWith({ importSessionId: 456, portfolioId: 1, token: s3KeyToken });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      broker: undefined,
      correlationId: expect.stringContaining(String(s3KeyToken)),
      expiresAt: expect.any(String),
      importSessionId: 456,
      maxUploadSizeBytes: 5 * 1024 * 1024,
      s3Bucket: expect.any(String),
      s3Key: expect.any(String),
      status: 'waiting_for_upload',
      uploadFields: undefined,
      uploadHeaders: { 'Content-Type': 'text/csv' },
      uploadMethod: 'PUT',
      uploadUrl: 'https://example.com/review-upload.csv',
    }));
  });

  it('passes brokerId when creating review import sessions', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({ body: { brokerId: 2, mode: 'review' }, params: { portfolioId: 1 } });
    mocked.reviewPresignedUrl.mockResolvedValueOnce({ key: 'portfolio-import-sessions/1/456/generated-token.csv', presignedUrl: 'https://example.com/review-upload.csv' });
    mocked.createImportSession.mockResolvedValueOnce({ correlationId: 'x', financialBrokerKey: { financialBrokerKey: 2, name: 'Broker' }, portfolioImportSessionKey: 456, status: 'waiting_for_upload' });

    await createPortfolioImportSession({ body: { brokerId: 2, mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0], mockRes({ json: vi.fn(), status: vi.fn().mockReturnThis() }));

    expect(mocked.createImportSession).toHaveBeenCalledWith(expect.objectContaining({ appuser: { appuserKey: 1 }, brokerId: 2, portfolioId: 1, tenant: { tenantKey: 9 } }));
  });

  it('rejects without req.user with Unauthorized', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({
      body: { mode: 'review' },
      params: { portfolioId: 1 },
    });
    await expect(
      createPortfolioImportSession(
        { body: { mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
        mockRes({ json: vi.fn(), status: vi.fn() }),
      ),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects without req.tenant with Tenant not found', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({
      body: { mode: 'review' },
      params: { portfolioId: 1 },
    });
    await expect(
      createPortfolioImportSession(
        { body: { mode: 'review' }, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
        mockRes({ json: vi.fn(), status: vi.fn() }),
      ),
    ).rejects.toThrow('Tenant not found');
  });

  it('rejects unsupported mode via validation error', async () => {
    vi.mocked(zParse).mockRejectedValueOnce(new Error('Validation failed'));

    await expect(
      createPortfolioImportSession(
        { body: { mode: 'immediate' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
        mockRes({ json: vi.fn(), status: vi.fn() }),
      ),
    ).rejects.toThrow('Validation failed');
  });

  it('rejects extra body fields on review import sessions', async () => {
    vi.mocked(zParse).mockRejectedValueOnce(new Error('Validation failed'));

    await expect(
      createPortfolioImportSession(
        { body: { brokerId: 2, mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
        mockRes({ json: vi.fn(), status: vi.fn() }),
      ),
    ).rejects.toThrow('Validation failed');
  });

  it('creates a review session without brokerId', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({
      body: { mode: 'review' },
      params: { portfolioId: 1 },
    });
    mocked.reviewPresignedUrl.mockResolvedValueOnce({
      key: 'portfolio-import-sessions/1/456/generated-token.csv',
      presignedUrl: 'https://example.com/review-upload.csv',
    });
    mocked.createImportSession.mockResolvedValueOnce({ correlationId: 'x', portfolioImportSessionKey: 456, status: 'waiting_for_upload' });
    await createPortfolioImportSession(
      { body: { mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
      mockRes({ json: vi.fn(), status: vi.fn().mockReturnThis() }),
    );
    expect(mocked.createImportSession).toHaveBeenCalledWith(expect.objectContaining({ appuser: { appuserKey: 1 }, portfolioId: 1, tenant: { tenantKey: 9 } }));
  });

  it('does not call legacy background operation or enqueue for review import sessions', async () => {
    vi.mocked(zParse).mockResolvedValueOnce({
      body: { mode: 'review' },
      params: { portfolioId: 1 },
    });
    mocked.createImportSession.mockImplementationOnce((input: { correlationId?: string; s3Key: string }) => {
      const token = /pending\/(.+)\.csv$/.exec(input.s3Key)?.[1] ?? input.correlationId?.split(':').at(-1) ?? 'missing-token';
      return Promise.resolve({ correlationId: `portfolio.csv-import-session:1:456:${token}`, portfolioImportSessionKey: 456, status: 'waiting_for_upload' });
    });
    mocked.reviewPresignedUrl.mockResolvedValueOnce({ key: 'portfolio-import-sessions/1/456/generated-token.csv', presignedUrl: 'https://example.com/review-upload.csv' });
    const res = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };

    await createPortfolioImportSession(
      { body: { mode: 'review' }, params: { portfolioId: '1' }, tenant: { tenantKey: 9 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof createPortfolioImportSession>[0],
      mockRes(res),
    );

    expect(mocked.createImportSession).toHaveBeenCalled();
    expect(mocked.reviewPresignedUrl).toHaveBeenCalled();
    expect(mocked.createQueuedOperation).not.toHaveBeenCalled();
    expect(mocked.enqueue).not.toHaveBeenCalled();
    expect(mocked.attachQueueJob).not.toHaveBeenCalled();
  });

  it('stubs earnings to [] (RAD-449: Fundamentals-tier, not covered) and returns EODHD-backed dividends filtered to the forward window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    vi.mocked(zParse).mockResolvedValueOnce({});
    mocked.getPortfoliosHoldings.mockResolvedValueOnce([
      { financialAssetSymbol: 'AAPL', isInvalid: false },
      { financialAssetSymbol: 'AMD', isInvalid: false },
    ]);
    mocked.getEodhdDividends.mockImplementation((symbol: string) => {
      if (symbol === 'AAPL') {
        return Promise.resolve([
          { date: '2026-05-01', value: 0.24 }, // outside the [today, today+120] window -> filtered out
          { date: '2026-07-30', value: 0.26 },
        ]);
      }
      if (symbol === 'AMD') {
        return Promise.resolve([{ date: '2026-09-01', value: 0.1 }]);
      }
      return Promise.resolve([]);
    });

    const { getPortfolioCalendar } = await import('../portfolio');
    const json = vi.fn();

    await getPortfolioCalendar({ tenant: { tenantKey: 5 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof getPortfolioCalendar>[0], mockRes({ json }));

    expect(mocked.getEodhdDividends).toHaveBeenNthCalledWith(1, 'AAPL', { from: '2026-07-15', to: '2026-11-12' });
    expect(mocked.getEodhdDividends).toHaveBeenNthCalledWith(2, 'AMD', { from: '2026-07-15', to: '2026-11-12' });

    expect(json).toHaveBeenCalledWith({
      dividends: [
        { date: '2026-07-30', symbol: 'AAPL', value: 0.26 },
        { date: '2026-09-01', symbol: 'AMD', value: 0.1 },
      ],
      earnings: [],
    });
  });

  it('tolerates a single symbol\'s dividend lookup failing without blanking out the rest', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    vi.mocked(zParse).mockResolvedValueOnce({});
    mocked.getPortfoliosHoldings.mockResolvedValueOnce([
      { financialAssetSymbol: 'AAPL', isInvalid: false },
      { financialAssetSymbol: 'AMD', isInvalid: false },
    ]);
    mocked.getEodhdDividends.mockImplementation((symbol: string) => {
      if (symbol === 'AAPL') {
        return Promise.reject(new Error('provider down'));
      }
      if (symbol === 'AMD') {
        return Promise.resolve([{ date: '2026-09-01', value: 0.1 }]);
      }
      return Promise.resolve([]);
    });

    const { getPortfolioCalendar } = await import('../portfolio');
    const json = vi.fn();

    await getPortfolioCalendar({ tenant: { tenantKey: 5 }, user: { appuserKey: 1 } } as unknown as Parameters<typeof getPortfolioCalendar>[0], mockRes({ json }));

    expect(json).toHaveBeenCalledWith({
      dividends: [{ date: '2026-09-01', symbol: 'AMD', value: 0.1 }],
      earnings: [],
    });
  });

  it('returns portfolio balances in app-user currency from latest snapshots', async () => {
    mocked.find.mockResolvedValueOnce([
      {
        currencyKey: { code: 'USD' },
        description: 'US brokerage',
        name: 'US Portfolio',
        portfolioKey: 1,
      },
    ]);
    mocked.whereIn.mockReturnValueOnce(Promise.resolve([
      { balance: '106', portfolio_key: 1 },
    ]));

    const json = vi.fn();
    await getPortfolios(
      {
        // `/v1/portfolio` is mounted behind `authedTenant`, so a request without a
        // resolved tenant cannot reach this handler in production. The fixture now says so.
        tenant: { tenantKey: 9 },
        user: { currencyKey: { code: 'EUR' } },
      } as unknown as Parameters<typeof getPortfolios>[0],
      mockRes({ json }),
    );

    expect(json).toHaveBeenCalledWith({
      portfolios: [
        {
          appuserCurrencyCode: 'EUR',
          balance: 106,
          currencyKey: { code: 'USD' },
          description: 'US brokerage',
          name: 'US Portfolio',
          portfolioKey: 1,
        },
      ],
    });
    vi.useRealTimers();
  });

  it('populates currencyKey so a single portfolio response carries a real currency code (RAD-530)', async () => {
    mocked.findOne.mockResolvedValueOnce({
      currencyKey: { code: 'USD' },
      description: 'US brokerage',
      name: 'US Portfolio',
      portfolioKey: 1,
      targetAllocation: null,
    });

    const json = vi.fn();
    await getPortfolio({ params: { portfolioId: 1 } } as unknown as Parameters<typeof getPortfolio>[0], mockRes({ json }));

    expect(mocked.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ portfolioKey: 1 }),
      { populate: ['currencyKey'] },
    );
    expect(json).toHaveBeenCalledWith({
      portfolio: {
        currencyKey: { code: 'USD' },
        description: 'US brokerage',
        name: 'US Portfolio',
        portfolioKey: 1,
        targetAllocation: null,
      },
    });
  });

  it('queues manual portfolio snapshot rebuilds for owned portfolios', async () => {
    mocked.findOne.mockResolvedValueOnce({ portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1 }, tenantKey: { tenantKey: 9 } });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json, status }));

    expect(mocked.createQueuedOperation).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: { appuserKey: 1 }, correlationId: expect.any(String), operationType: 'portfolio.snapshot', resourceId: 'portfolio:1', retryable: false, tenantKey: 9 }));
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ correlationId: expect.any(String), status: 'queued' });
  });

  it('enqueues the manual snapshot on the exclusive queue', async () => {
    mocked.findOne.mockResolvedValueOnce({ portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1 }, tenantKey: { tenantKey: 9 } });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json, status }));
    expect(mocked.send).toHaveBeenCalledWith('portfolio.snapshot.manual', { correlationId: expect.any(String), portfolioId: '1' }, { singletonKey: expect.any(String) });
    expect(status).toHaveBeenCalledWith(202);
  });

  it('marks needs action when send rejects', async () => {
    mocked.findOne.mockResolvedValueOnce({ portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1 }, tenantKey: { tenantKey: 9 } });
    mocked.send.mockRejectedValueOnce(new Error('boom'));

    await expect(rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('boom');
    expect(mocked.markNeedsAction).toHaveBeenCalledWith(expect.any(String), 'portfolio.snapshot:queue-error', 'portfolio.snapshot:queueing');
  });

  it('marks needs action when send returns null or undefined', async () => {
    mocked.findOne.mockResolvedValueOnce({ portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1 }, tenantKey: { tenantKey: 9 } });
    mocked.send.mockResolvedValueOnce(undefined);

    await expect(rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Portfolio snapshot queue returned no job id');
    expect(mocked.markNeedsAction).toHaveBeenCalledWith(expect.any(String), 'portfolio.snapshot:enqueue-null', 'portfolio.snapshot:queueing');
  });

  it('marks needs action when attachQueueJob returns false', async () => {
    mocked.findOne.mockResolvedValueOnce({ portfolioKey: 1, portfolioOwnerAppuserKey: { appuserKey: 1 }, tenantKey: { tenantKey: 9 } });
    mocked.attachQueueJob.mockResolvedValueOnce(false);

    await expect(rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Portfolio snapshot job accepted but could not be attached');
    expect(mocked.markNeedsAction).toHaveBeenCalledWith(expect.any(String), 'portfolio.snapshot:attach-false', 'portfolio.snapshot:queueing');
  });

  it('rejects rebuilds for non-owned or missing portfolios', async () => {
    mocked.findOne.mockResolvedValueOnce(null);
    await expect(rebuildPortfolioSnapshot({ enqueue: requestEnqueue, params: { portfolioId: '1' }, user: { appuserKey: 1 } } as unknown as Parameters<typeof rebuildPortfolioSnapshot>[0], mockRes({ json: vi.fn(), status: vi.fn() }))).rejects.toThrow('Portfolio not found');
  });

  describe('getHoldingAnalystData (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError', async () => {
      vi.mocked(zParse).mockResolvedValueOnce({ params: { symbol: 'AAPL' } });

      await expect(
        getHoldingAnalystData({ params: { symbol: 'AAPL' } } as unknown as Parameters<typeof getHoldingAnalystData>[0], mockRes({ json: vi.fn() })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed symbol)', async () => {
      vi.mocked(zParse).mockRejectedValueOnce(new BadRequestError('Invalid symbol'));

      await expect(
        getHoldingAnalystData({ params: { symbol: '' } } as unknown as Parameters<typeof getHoldingAnalystData>[0], mockRes({ json: vi.fn() })),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('getHoldingValuation (RAD-449: stubbed, not covered by EODHD plan)', () => {
    it('throws NotFoundError', async () => {
      vi.mocked(zParse).mockResolvedValueOnce({ params: { symbol: 'AAPL' } });

      await expect(
        getHoldingValuation({ params: { symbol: 'AAPL' } } as unknown as Parameters<typeof getHoldingValuation>[0], mockRes({ json: vi.fn() })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('still validates the request before stubbing (400 beats 404 on a malformed symbol)', async () => {
      vi.mocked(zParse).mockRejectedValueOnce(new BadRequestError('Invalid symbol'));

      await expect(
        getHoldingValuation({ params: { symbol: '' } } as unknown as Parameters<typeof getHoldingValuation>[0], mockRes({ json: vi.fn() })),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
