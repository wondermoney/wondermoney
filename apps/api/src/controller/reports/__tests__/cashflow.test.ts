import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Transaction } from '@entity/Transaction';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getCashflowReport } from '../cashflow';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

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
      data: [
        { expenses: 300, income: 1000, month: '2026-01-01T00:00:00.000Z', net: 700 },
        { expenses: 800, income: 2000, month: '2026-02-01T00:00:00.000Z', net: 1200 },
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('applies the fromDate filter to the transaction query', async () => {
    await getCashflowReport(makeRequest({ fromDate: '2026-02-01T00:00:00.000Z' }), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({ transactionDate: { $gte: new Date('2026-02-01T00:00:00.000Z') } }),
      expect.anything(),
    );
  });

  it('scopes the transaction query by tenant and the per-account privacy carve-out', async () => {
    await getCashflowReport(makeRequest(), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({
        accountKey: { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 71 } }] },
        deletedAt: undefined,
        tenantKey: { tenantKey: 113 },
      }),
      expect.anything(),
    );
  });

  it('returns an empty dataset when there are no transactions', async () => {
    const res = makeResponse();
    await getCashflowReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
