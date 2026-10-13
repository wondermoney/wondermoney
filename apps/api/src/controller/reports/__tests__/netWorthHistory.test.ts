import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), getNetWorthHistory: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@service/net-worth/net-worth.service', () => ({
  default: { getNetWorthHistory: mocks.getNetWorthHistory },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getNetWorthHistoryReport } from '../netWorthHistory';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

describe('getNetWorthHistoryReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNetWorthHistory.mockResolvedValue({
      currencyCode: 'EUR',
      granularity: 'monthly',
      points: [],
      readiness: 'empty',
    });
  });

  it('maps net-worth history points to the report shape with first-of-month dates', async () => {
    mocks.getNetWorthHistory.mockResolvedValue({
      currencyCode: 'EUR',
      granularity: 'monthly',
      points: [
        { accountsTotal: 800, date: '2026-06-30', isComplete: true, loansTotal: 0, portfoliosTotal: 200, totalNetWorth: 1000 },
        { accountsTotal: 1300, date: '2026-07-31', isComplete: true, loansTotal: 100, portfoliosTotal: 300, totalNetWorth: 1500 },
      ],
      readiness: 'ready',
    });

    const res = makeResponse();
    await getNetWorthHistoryReport(makeRequest(), res);

    expect(mocks.getNetWorthHistory).toHaveBeenCalledWith({ appuserKey: 71 }, expect.objectContaining({ granularity: 'monthly', months: 12 }));
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { breakdown: { assets: 1000, liabilities: 0 }, date: '2026-06-01T00:00:00.000Z', netWorth: 1000 },
        { breakdown: { assets: 1600, liabilities: 100 }, date: '2026-07-01T00:00:00.000Z', netWorth: 1500 },
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('excludes points before the fromDate month', async () => {
    mocks.getNetWorthHistory.mockResolvedValue({
      currencyCode: 'EUR',
      granularity: 'monthly',
      points: [
        { accountsTotal: 800, date: '2026-06-30', isComplete: true, loansTotal: 0, portfoliosTotal: 200, totalNetWorth: 1000 },
        { accountsTotal: 1300, date: '2026-07-31', isComplete: true, loansTotal: 100, portfoliosTotal: 300, totalNetWorth: 1500 },
      ],
      readiness: 'ready',
    });

    const res = makeResponse();
    await getNetWorthHistoryReport(makeRequest({ fromDate: '2026-07-01T00:00:00.000Z' }), res);

    const { data } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { date: string }[] };
    expect(data).toHaveLength(1);
    expect(data[0]?.date).toBe('2026-07-01T00:00:00.000Z');
  });

  it('passes the authenticated user to the net-worth service for privacy scoping', async () => {
    await getNetWorthHistoryReport(makeRequest(), makeResponse());

    expect(mocks.getNetWorthHistory).toHaveBeenCalledWith({ appuserKey: 71 }, expect.anything());
  });

  it('returns an empty dataset when there are no history points', async () => {
    const res = makeResponse();
    await getNetWorthHistoryReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
