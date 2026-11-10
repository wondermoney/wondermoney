import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const mocks = vi.hoisted(() => ({ find: vi.fn() }));

// The mocked EntityManager answers every query with the scenario's rows; the household has made no
// "counts as spending" choices.
vi.mock('@service/transaction/category-spending', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/transaction/category-spending')>();
  return { ...actual, loadCategorySpendingFlags: () => Promise.resolve(new actual.CategorySpendingFlags()) };
});
vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getCashflowReport } from '../cashflow';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71, currencyKey: { code: 'EUR' } } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  appuserSettlementAmount: 0,
  appuserTransactionCategories: { getItems: () => [] },
  transactionDate: new Date('2026-01-15T00:00:00.000Z'),
  transactionKey: 1,
  ...overrides,
});

describe('getCashflowReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([]);
  });

  it('aggregates income and expenses into monthly buckets', async () => {
    mocks.find.mockResolvedValue([
      makeTransaction({ appuserSettlementAmount: 1000, transactionKey: 1 }),
      makeTransaction({ appuserSettlementAmount: -300, transactionKey: 2 }),
      makeTransaction({
        appuserSettlementAmount: 2000,
        transactionDate: new Date('2026-02-10T00:00:00.000Z'),
        transactionKey: 3,
      }),
      makeTransaction({
        appuserSettlementAmount: -800,
        transactionDate: new Date('2026-02-20T00:00:00.000Z'),
        transactionKey: 4,
      }),
    ]);

    const res = makeResponse();
    await getCashflowReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({
      completeness: { currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 },
      data: [
        { expenses: 300, income: 1000, month: '2026-01-01T00:00:00.000Z', net: 700, savingsRate: 0.7 },
        { expenses: 800, income: 2000, month: '2026-02-01T00:00:00.000Z', net: 1200, savingsRate: 0.6 },
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('returns an empty dataset when there are no transactions', async () => {
    const res = makeResponse();
    await getCashflowReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ completeness: expect.objectContaining({ isComplete: true }), data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
