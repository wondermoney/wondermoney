import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getSpendingByCategoryReport } from '../spendingByCategory';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const makeCategory = (overrides: Record<string, unknown> = {}) => ({
  bgColor: '#f3f3f3',
  categoryKey: 10,
  name: 'Food',
  parentCategory: null,
  ...overrides,
});

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  appuserSettlementAmount: -50,
  appuserTransactionCategories: { getItems: () => [{ categoryKey: makeCategory() }] },
  transactionDate: new Date('2026-01-15T00:00:00.000Z'),
  transactionKey: 1,
  ...overrides,
});

describe('getSpendingByCategoryReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Transaction) return Promise.resolve([]);
      if (entity === LoanRepaymentLink) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('rolls up expense transactions into per-category rows with shares of the total', async () => {
    const food = makeTransaction({ appuserSettlementAmount: -60, transactionKey: 1 });
    const transport = makeTransaction({
      appuserSettlementAmount: -40,
      appuserTransactionCategories: {
        getItems: () => [{ categoryKey: makeCategory({ bgColor: '#aaaaaa', categoryKey: 11, name: 'Transport' }) }],
      },
      transactionKey: 2,
    });
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Transaction) return Promise.resolve([food, transport]);
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getSpendingByCategoryReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ categoryKey: '10', name: 'Food', percentOfTotal: 60, totalAmount: 60, transactionCount: 1 }),
        expect.objectContaining({ categoryKey: '11', name: 'Transport', percentOfTotal: 40, totalAmount: 40, transactionCount: 1 }),
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('applies the fromDate filter to the transaction query', async () => {
    await getSpendingByCategoryReport(makeRequest({ fromDate: '2026-02-01T00:00:00.000Z' }), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({ transactionDate: { $gte: new Date('2026-02-01T00:00:00.000Z') } }),
      expect.anything(),
    );
  });

  it('scopes the transaction query by tenant and the per-account privacy carve-out', async () => {
    await getSpendingByCategoryReport(makeRequest(), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({
        accountKey: { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 71 } }] },
        deletedAt: undefined,
        tenantKey: { tenantKey: 113 },
        transactionStatusKey: { name: { $in: ['BOOKED'] } },
      }),
      expect.anything(),
    );
  });

  it('returns an empty dataset when there are no expense transactions', async () => {
    const res = makeResponse();
    await getSpendingByCategoryReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
