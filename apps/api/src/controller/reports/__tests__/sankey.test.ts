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

import { getSankeyReport } from '../sankey';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const makeCategory = (overrides: Record<string, unknown> = {}) => ({
  bgColor: '#f3f3f3',
  categoryKey: 1,
  name: 'Salary',
  parentCategory: null,
  ...overrides,
});

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  accountKey: { accountKey: 5, accountName: 'Checking' },
  appuserSettlementAmount: 0,
  appuserTransactionCategories: { getItems: () => [{ categoryKey: makeCategory() }] },
  transactionDate: new Date('2026-01-15T00:00:00.000Z'),
  transactionKey: 1,
  ...overrides,
});

describe('getSankeyReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([]);
  });

  it('builds income → expense → account nodes and links', async () => {
    mocks.find.mockResolvedValue([
      makeTransaction({ appuserSettlementAmount: 5000, transactionKey: 1 }),
      makeTransaction({
        appuserSettlementAmount: -1500,
        appuserTransactionCategories: {
          getItems: () => [{ categoryKey: makeCategory({ categoryKey: 2, name: 'Rent' }) }],
        },
        transactionKey: 2,
      }),
      makeTransaction({
        appuserSettlementAmount: -800,
        appuserTransactionCategories: {
          getItems: () => [{ categoryKey: makeCategory({ categoryKey: 3, name: 'Groceries' }) }],
        },
        transactionKey: 3,
      }),
    ]);

    const res = makeResponse();
    await getSankeyReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          links: expect.arrayContaining([
            { source: 'income-1', target: 'expense-2', value: 1500 },
            { source: 'income-1', target: 'expense-3', value: 800 },
            { source: 'expense-2', target: 'account-5', value: 1500 },
            { source: 'expense-3', target: 'account-5', value: 800 },
          ]),
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'income-1', kind: 'income', label: 'Salary', value: 5000 }),
            expect.objectContaining({ id: 'expense-2', kind: 'expense', label: 'Rent', value: 1500 }),
            expect.objectContaining({ id: 'expense-3', kind: 'expense', label: 'Groceries', value: 800 }),
            expect.objectContaining({ id: 'account-5', kind: 'account', label: 'Checking', value: 2300 }),
          ]),
        },
        filters: expect.any(Object),
        generatedAt: expect.any(String),
      }),
    );
  });

  it('buckets overflow income, expense, and account nodes into Other buckets', async () => {
    const incomeTxns = Array.from({ length: 10 }, (_, index) =>
      makeTransaction({
        appuserSettlementAmount: 1000,
        appuserTransactionCategories: {
          getItems: () => [{ categoryKey: makeCategory({ categoryKey: 100 + index, name: `Income ${index}` }) }],
        },
        transactionKey: 1000 + index,
      }),
    );
    const expenseTxns = Array.from({ length: 13 }, (_, index) =>
      makeTransaction({
        accountKey: { accountKey: 200 + index, accountName: `Account ${index}` },
        appuserSettlementAmount: -100,
        appuserTransactionCategories: {
          getItems: () => [{ categoryKey: makeCategory({ categoryKey: 300 + index, name: `Expense ${index}` }) }],
        },
        transactionKey: 2000 + index,
      }),
    );
    mocks.find.mockResolvedValue([...incomeTxns, ...expenseTxns]);

    const res = makeResponse();
    await getSankeyReport(makeRequest(), res);

    const { data } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { links: { source: string; target: string }[]; nodes: { id: string }[]; } };
    const nodeIds = data.nodes.map((node) => node.id);
    expect(nodeIds).toContain('__other_income');
    expect(nodeIds).toContain('__other_expense');
    expect(nodeIds).toContain('__other_account');
    // 8 named income + 1 other; 12 named expense + 1 other; 8 named accounts + 1 other
    expect(nodeIds.filter((id) => id.startsWith('income-'))).toHaveLength(8);
    expect(nodeIds.filter((id) => id.startsWith('expense-'))).toHaveLength(12);
    expect(nodeIds.filter((id) => id.startsWith('account-'))).toHaveLength(8);
    expect(data.links.some((link) => link.source === '__other_income')).toBe(true);
    expect(data.links.some((link) => link.target === '__other_expense')).toBe(true);
    expect(data.links.some((link) => link.target === '__other_account')).toBe(true);
  });

  it('applies the fromDate filter to the transaction query', async () => {
    await getSankeyReport(makeRequest({ fromDate: '2026-02-01T00:00:00.000Z' }), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({ transactionDate: { $gte: new Date('2026-02-01T00:00:00.000Z') } }),
      expect.anything(),
    );
  });

  it('scopes the transaction query by tenant and the per-account privacy carve-out', async () => {
    await getSankeyReport(makeRequest(), makeResponse());

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

  it('returns empty nodes and links when there are no transactions', async () => {
    const res = makeResponse();
    await getSankeyReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { links: [], nodes: [] }, filters: expect.any(Object), generatedAt: expect.any(String) }),
    );
  });
});
