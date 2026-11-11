import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock('@app/app', () => ({ DI: { em: { populate: vi.fn() } } }));
vi.mock('@service/reports/spendingVsNormal.service', () => ({
  getSpendingVsNormalReport: mocks.report,
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getSpendingVsNormalReport } from '../spendingVsNormal';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71, currencyKey: { code: 'EUR' } } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() });

const data = {
  month: '2026-08',
  rows: [{ categoryKey: '10', name: 'Food', normal: 100, parentKey: null, ratio: 1.5, total: 150 }],
};

const completeness = { currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 };

describe('getSpendingVsNormalReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.mockResolvedValue({ completeness, data });
  });

  it('answers with the month, its rows and the filters it used', async () => {
    const res = makeResponse();
    await getSpendingVsNormalReport(makeRequest({ month: '2026-08' }), res as unknown as Response);

    expect(res.json).toHaveBeenCalledWith({
      completeness,
      data,
      filters: { month: '2026-08' },
      generatedAt: expect.any(String),
    });
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { month: '2026-08' } }),
      '2026-08',
    );
  });
});
