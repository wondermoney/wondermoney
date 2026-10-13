import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getBudgetVsActualReport } from '../budgetVsActual';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  accounts: { getItems: () => [] },
  amountBudgeted: 100,
  budgetKey: { budgetKey: 1 },
  categoryKey: { bgColor: '#f3f3f3', categoryKey: 10, name: 'Food' },
  month: 1,
  year: 2026,
  ...overrides,
});

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  appuserSettlementAmount: -100,
  appuserTransactionCategories: { getItems: () => [{ categoryKey: { categoryKey: 10, name: 'Food' } }] },
  transactionDate: new Date('2026-01-15T00:00:00.000Z'),
  transactionKey: 1,
  ...overrides,
});

const foodTemplates = [1, 2, 3].map((month) =>
  makeTemplate({ amountBudgeted: 100, categoryKey: { bgColor: '#f3f3f3', categoryKey: 10, name: 'Food' }, month }),
);

describe('getBudgetVsActualReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Budget) return Promise.resolve([{ budgetKey: 1 }]);
      if (entity === BudgetTemplateCategory) return Promise.resolve(foodTemplates);
      if (entity === Transaction) return Promise.resolve([]);
      if (entity === LoanRepaymentLink) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('compares monthly budgeted amounts against actual spend per category', async () => {
    const transportTemplates = [1, 2, 3].map((month) =>
      makeTemplate({ amountBudgeted: 50, categoryKey: { bgColor: '#eeeeee', categoryKey: 20, name: 'Transport' }, month }),
    );
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Budget) return Promise.resolve([{ budgetKey: 1 }]);
      if (entity === BudgetTemplateCategory) return Promise.resolve([...foodTemplates, ...transportTemplates]);
      if (entity === Transaction) {
        return Promise.resolve([
          makeTransaction({ appuserSettlementAmount: -250, transactionKey: 1 }),
          makeTransaction({ appuserSettlementAmount: -50, transactionDate: new Date('2026-02-10T00:00:00.000Z'), transactionKey: 2 }),
          makeTransaction({
            appuserSettlementAmount: -75,
            appuserTransactionCategories: {
              getItems: () => [{ categoryKey: { categoryKey: 21, name: 'Bus', parentCategory: { categoryKey: 20 } } }],
            },
            transactionDate: new Date('2026-03-10T00:00:00.000Z'),
            transactionKey: 3,
          }),
        ]);
      }
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getBudgetVsActualReport(
      makeRequest({ fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-03-31T00:00:00.000Z' }),
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ actual: 300, budgeted: 300, categoryKey: '10', name: 'Food', percentUsed: 100, variance: 0 }),
        expect.objectContaining({ actual: 75, budgeted: 150, categoryKey: '20', name: 'Transport', percentUsed: 50, variance: 75 }),
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('restricts the period covered by the budget templates and passes dates to the transaction query', async () => {
    const res = makeResponse();
    await getBudgetVsActualReport(
      makeRequest({ fromDate: '2026-02-01T00:00:00.000Z', toDate: '2026-03-31T00:00:00.000Z' }),
      res,
    );

    // Only Feb + Mar are covered → 2 months × 100 budgeted.
    const { data } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { budgeted: number }[] };
    expect(data[0]?.budgeted).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({
        transactionDate: { $gte: new Date('2026-02-01T00:00:00.000Z'), $lte: new Date('2026-03-31T00:00:00.000Z') },
      }),
      expect.anything(),
    );
  });

  it('scopes the transaction query by tenant and the per-account privacy carve-out', async () => {
    await getBudgetVsActualReport(
      makeRequest({ fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-03-31T00:00:00.000Z' }),
      makeResponse(),
    );

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

  it('returns an empty dataset when the user has no budgets', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Budget) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getBudgetVsActualReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });

  it('returns an empty dataset when no budget template rows overlap the period', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Budget) return Promise.resolve([{ budgetKey: 1 }]);
      if (entity === BudgetTemplateCategory) return Promise.resolve(foodTemplates);
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getBudgetVsActualReport(makeRequest({ fromDate: '2027-01-01T00:00:00.000Z', toDate: '2027-01-31T00:00:00.000Z' }), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
