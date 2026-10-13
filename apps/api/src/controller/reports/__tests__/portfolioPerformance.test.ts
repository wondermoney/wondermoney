import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));
vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema: unknown, req: unknown) => Promise.resolve(req)),
}));

import { getPortfolioPerformanceReport } from '../portfolioPerformance';

const makeRequest = (query: Record<string, unknown> = {}) =>
  ({ query, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const account = {
  accountKey: 5,
  accountName: 'Brokerage',
  appuserCurrencyBalance: 1050,
  currencyKey: { code: 'EUR' },
  isPrivate: false,
};

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  accountKey: { accountKey: 5 },
  appuserCurrencyBalance: 0,
  appuserSettlementAmount: 0,
  transactionDate: new Date('2026-01-10T00:00:00.000Z'),
  transactionKey: 1,
  ...overrides,
});

describe('getPortfolioPerformanceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Account) return Promise.resolve([account]);
      return Promise.resolve([]);
    });
  });

  it('computes start/end balance, contributions, and return per account', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Account) return Promise.resolve([account]);
      if (entity === Transaction) {
        return Promise.resolve([
          makeTransaction({ appuserCurrencyBalance: 950, appuserSettlementAmount: -50, transactionKey: 1 }),
          makeTransaction({
            appuserCurrencyBalance: 1050,
            appuserSettlementAmount: 100,
            transactionDate: new Date('2026-02-10T00:00:00.000Z'),
            transactionKey: 2,
          }),
        ]);
      }
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getPortfolioPerformanceReport(makeRequest({ fromDate: '2026-01-01T00:00:00.000Z' }), res);

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          accountKey: '5',
          contributions: 50,
          currency: 'EUR',
          endBalance: 1050,
          name: 'Brokerage',
          return: 50,
          startBalance: 950,
        },
      ],
      filters: expect.any(Object),
      generatedAt: expect.any(String),
    });
  });

  it('uses the last booked transaction balance as the end balance when toDate is provided', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Account) return Promise.resolve([account]);
      if (entity === Transaction) {
        return Promise.resolve([
          makeTransaction({ appuserCurrencyBalance: 950, appuserSettlementAmount: -50, transactionKey: 1 }),
        ]);
      }
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getPortfolioPerformanceReport(
      makeRequest({ fromDate: '2026-01-01T00:00:00.000Z', toDate: '2026-02-01T00:00:00.000Z' }),
      res,
    );

    const { data } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { contributions: number; endBalance: number; return: number; startBalance: number }[];
    };
    expect(data[0]).toEqual(expect.objectContaining({ contributions: -50, endBalance: 950, return: 50, startBalance: 950 }));
  });

  it('applies the fromDate filter to the transaction query', async () => {
    await getPortfolioPerformanceReport(makeRequest({ fromDate: '2026-01-01T00:00:00.000Z' }), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({ transactionDate: { $gte: new Date('2026-01-01T00:00:00.000Z') } }),
      expect.anything(),
    );
  });

  it('scopes the account and transaction queries by tenant and the per-account privacy carve-out', async () => {
    await getPortfolioPerformanceReport(makeRequest(), makeResponse());

    expect(mocks.find).toHaveBeenCalledWith(
      Account,
      expect.objectContaining({
        $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 71 } }],
        deletedAt: undefined,
        tenantKey: { tenantKey: 113 },
      }),
      expect.anything(),
    );
    expect(mocks.find).toHaveBeenCalledWith(
      Transaction,
      expect.objectContaining({
        accountKey: expect.objectContaining({
          $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: 71 } }],
        }),
        deletedAt: undefined,
        tenantKey: { tenantKey: 113 },
      }),
      expect.anything(),
    );
  });

  it('returns an empty dataset when the user has no accounts', async () => {
    mocks.find.mockImplementation((entity: unknown) => {
      if (entity === Account) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const res = makeResponse();
    await getPortfolioPerformanceReport(makeRequest(), res);

    expect(res.json).toHaveBeenCalledWith({ data: [], filters: expect.any(Object), generatedAt: expect.any(String) });
  });
});
