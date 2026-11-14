import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ csv: vi.fn(), report: vi.fn() }));

vi.mock('@service/reports/monthComparison.service', () => ({
  getMonthComparisonCsv: mocks.csv,
  getMonthComparisonReport: mocks.report,
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getMonthComparisonReport, getMonthComparisonReportCsv } from '../monthComparison';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71, currencyKey: { code: 'EUR' } } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn(), send: vi.fn(), setHeader: vi.fn() });

const data = {
  base: { expenses: 400, income: 1000, month: '2026-08', net: 600, savingsRate: 0.6 },
  categories: [{ base: 150, categoryKey: '10', color: '#000', compare: 100, delta: 50, deltaPct: 50, name: 'Food' }],
  compare: { expenses: 300, income: 900, month: '2026-07', net: 600, savingsRate: 0.67 },
};

const completeness = { currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 };

describe('getMonthComparisonReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.mockResolvedValue({ completeness, data });
  });

  it('answers with both months, the category deltas and the filters it used', async () => {
    const res = makeResponse();
    await getMonthComparisonReport(makeRequest({ base: '2026-08', compare: '2026-07' }), res as unknown as Response);

    expect(res.json).toHaveBeenCalledWith({
      completeness,
      data,
      filters: { base: '2026-08', compare: '2026-07' },
      generatedAt: expect.any(String),
    });
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { base: '2026-08', compare: '2026-07' } }),
      { base: '2026-08', compare: '2026-07' },
    );
  });
});

describe('getMonthComparisonReportCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csv.mockResolvedValue('\uFEFF# totals\n');
  });

  it('serves the export as a month-comparison.csv attachment', async () => {
    const res = makeResponse();
    await getMonthComparisonReportCsv(makeRequest({ base: '2026-08', compare: '2026-07' }), res as unknown as Response);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="month-comparison.csv"');
    expect(res.send).toHaveBeenCalledWith('\uFEFF# totals\n');
  });
});
