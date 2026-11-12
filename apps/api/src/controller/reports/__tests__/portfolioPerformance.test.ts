import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getReport: vi.fn() }));

vi.mock('@service/reports/portfolioPerformance.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service/reports/portfolioPerformance.service')>()),
  getPortfolioPerformanceReport: mocks.getReport,
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getPortfolioPerformanceReport, getPortfolioPerformanceReportCsv } from '../portfolioPerformance';

const row = {
  change: 2535.86,
  changePercent: 25.36,
  currency: 'EUR',
  dividends: 0,
  endValue: 12_535.86,
  missingSnapshotDates: [],
  moneyWeightedReturn: 25.36,
  moneyWeightedReturnAnnualized: false,
  name: 'Long-term',
  netContributions: 0,
  portfolioKey: '7',
  startValue: 10_000,
  timeWeightedReturn: 25.36,
};

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn(), send: vi.fn(), setHeader: vi.fn() }) as unknown as Response;

describe('portfolio performance report controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReport.mockResolvedValue([row]);
  });

  it('answers with one row per portfolio in the report envelope, echoing the filters', async () => {
    const res = makeResponse();
    await getPortfolioPerformanceReport(makeRequest({ fromDate: '2026-08-01T00:00:00.000Z' }), res);

    expect(res.json).toHaveBeenCalledWith({
      data: [row],
      filters: { fromDate: '2026-08-01T00:00:00.000Z' },
      generatedAt: expect.any(String),
    });
  });

  it('exports the same rows as a CSV download', async () => {
    const res = makeResponse();
    await getPortfolioPerformanceReportCsv(makeRequest(), res);

    const csv = (res.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(csv).toContain('7,Long-term,EUR,10000.00,0.00,2535.86,25.36,0.00,12535.86,25.36,25.36,false,0');
    expect((res as unknown as { setHeader: unknown }).setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
  });

  it('refuses a request with no resolved household', async () => {
    const req = { query: {}, user: { appuserKey: 71 } } as unknown as Request;

    await expect(getPortfolioPerformanceReport(req, makeResponse())).rejects.toThrow();
    expect(mocks.getReport).not.toHaveBeenCalled();
  });
});
