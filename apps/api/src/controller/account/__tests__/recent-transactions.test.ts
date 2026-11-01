import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@entity/Account';
import type { Transaction } from '@entity/Transaction';

const mocks = vi.hoisted(() => ({ find: vi.fn(), findOne: vi.fn() }));

vi.mock('../../../app.js', () => ({
  DI: { em: { find: mocks.find, findOne: mocks.findOne } },
}));

import { getRecentTransactions, RECENT_TRANSACTIONS_LIMIT } from '../recent-transactions';

interface Row {
  amount: null | number;
  currencyCode: null | string;
  displayName: null | string;
  entryType: string;
  occurredAt: null | string;
}

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

const request = (accountId = '41') =>
  ({ params: { accountId }, tenant: { tenantKey: 113 }, user: { appuserKey: 71 } }) as unknown as Request;

const account = (overrides: Partial<Account> = {}) =>
  ({
    accountId: undefined,
    accountKey: 41,
    balance: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    currencyKey: { code: 'EUR' },
    nordigenRequisitionKey: undefined,
    ...overrides,
  }) as unknown as Account;

const txn = (overrides: Partial<Transaction> = {}) =>
  ({
    description: undefined,
    editedSettlementAmount: undefined,
    settlementAmount: 10,
    settlementCurrencyKey: { code: 'EUR' },
    transactionDate: new Date('2026-06-10T09:00:00.000Z'),
    transactionKey: 1,
    transactionMerchantKey: undefined,
    ...overrides,
  }) as unknown as Transaction;

const jsonOf = (res: Response) => vi.mocked(res.json).mock.calls[0]?.[0] as { transactions: Row[] };

describe('getRecentTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authorizes one active account by owner + tenant, then queries its five newest transactions', async () => {
    const user = { appuserKey: 71 };
    const tenant = { tenantKey: 113 };
    const acc = account();
    mocks.findOne.mockResolvedValue(acc);
    mocks.find.mockResolvedValue([txn()]);
    const res = makeResponse();

    await getRecentTransactions({ params: { accountId: '41' }, tenant, user } as unknown as Request, res);

    expect(mocks.findOne).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { accountKey: 41, accountOwnerAppuserKey: user, deletedAt: undefined, tenantKey: tenant },
      { populate: ['currencyKey'] },
    );
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ accountKey: acc, appuserKey: user, deletedAt: undefined }),
      {
        limit: RECENT_TRANSACTIONS_LIMIT,
        orderBy: { transactionDate: QueryOrder.DESC_NULLS_LAST, transactionKey: QueryOrder.DESC },
        populate: ['settlementCurrencyKey', 'transactionMerchantKey'],
      },
    );
    expect(RECENT_TRANSACTIONS_LIMIT).toBe(5);
  });

  it('maps a persisted transaction to exactly the five-field shape, merchant name first', async () => {
    mocks.findOne.mockResolvedValue(account());
    mocks.find.mockResolvedValue([
      txn({
        description: 'card purchase',
        editedSettlementAmount: -12.5,
        settlementAmount: -10,
        settlementCurrencyKey: { code: 'GBP' } as unknown as Transaction['settlementCurrencyKey'],
        transactionDate: new Date('2026-06-10T09:00:00.000Z'),
        transactionMerchantKey: { name: '  Blue Bottle  ' } as unknown as Transaction['transactionMerchantKey'],
      }),
    ]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    const [row] = jsonOf(res).transactions;
    expect(row).toEqual({
      amount: -12.5,
      currencyCode: 'GBP',
      displayName: 'Blue Bottle',
      entryType: 'persisted_transaction',
      occurredAt: '2026-06-10T09:00:00.000Z',
    });
    // No ids, dirty descriptions, review state, logos, or editable metadata leak.
    expect(Object.keys(row ?? {}).sort()).toEqual(['amount', 'currencyCode', 'displayName', 'entryType', 'occurredAt']);
  });

  it('falls back merchant → normalized description → null, preserving case and collapsing whitespace', async () => {
    mocks.findOne.mockResolvedValue(account());
    mocks.find.mockResolvedValue([
      txn({ description: '  Rent   payment  ', transactionMerchantKey: undefined }),
      txn({ description: undefined, transactionKey: 2, transactionMerchantKey: undefined }),
    ]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    const rows = jsonOf(res).transactions;
    expect(rows[0]?.displayName).toBe('Rent payment');
    expect(rows[1]?.displayName).toBeNull();
  });

  it('prefers edited amount, preserves a real zero, and falls back to null', async () => {
    mocks.findOne.mockResolvedValue(account());
    mocks.find.mockResolvedValue([
      txn({ editedSettlementAmount: 0, settlementAmount: 99 }),
      txn({ editedSettlementAmount: undefined, settlementAmount: undefined, transactionKey: 2 }),
    ]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    const rows = jsonOf(res).transactions;
    expect(rows[0]?.amount).toBe(0);
    expect(rows[1]?.amount).toBeNull();
  });

  it('serializes null date and null currency explicitly', async () => {
    mocks.findOne.mockResolvedValue(account());
    mocks.find.mockResolvedValue([
      txn({ settlementCurrencyKey: undefined, transactionDate: undefined }),
    ]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    const [row] = jsonOf(res).transactions;
    expect(row?.occurredAt).toBeNull();
    expect(row?.currencyCode).toBeNull();
  });

  it('returns one synthetic initial balance for a manual account with no transactions', async () => {
    mocks.findOne.mockResolvedValue(account({ balance: 250.75, currencyKey: { code: 'USD' } as unknown as Account['currencyKey'] }));
    mocks.find.mockResolvedValue([]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    expect(jsonOf(res).transactions).toEqual([
      { amount: 250.75, currencyCode: 'USD', displayName: null, entryType: 'synthetic_initial_balance', occurredAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('returns an empty list for an Open Banking account with no transactions (no synthetic row)', async () => {
    mocks.findOne.mockResolvedValue(account({ accountId: 'ES-123', balance: 5, nordigenRequisitionKey: { nordigenRequisitionKey: 9 } as unknown as Account['nordigenRequisitionKey'] }));
    mocks.find.mockResolvedValue([]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    expect(jsonOf(res).transactions).toEqual([]);
  });

  it('never returns a synthetic row when a manual account has transactions', async () => {
    mocks.findOne.mockResolvedValue(account({ balance: 5 }));
    mocks.find.mockResolvedValue([txn()]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    const rows = jsonOf(res).transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryType).toBe('persisted_transaction');
  });

  it('coerces numeric strings from the driver into finite numbers', async () => {
    mocks.findOne.mockResolvedValue(account());
    mocks.find.mockResolvedValue([txn({ editedSettlementAmount: undefined, settlementAmount: '42.10' as unknown as Transaction['settlementAmount'] })]);
    const res = makeResponse();

    await getRecentTransactions(request(), res);

    expect(jsonOf(res).transactions[0]?.amount).toBe(42.1);
  });

  it('returns the same generic not-found outcome for any invisible account and never queries transactions', async () => {
    mocks.findOne.mockResolvedValue(null);
    const res = makeResponse();

    await expect(getRecentTransactions(request(), res)).rejects.toThrow('Account not found');
    expect(mocks.find).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each([
    ['user', { params: { accountId: '41' }, tenant: { tenantKey: 113 } }],
    ['tenant', { params: { accountId: '41' }, user: { appuserKey: 71 } }],
  ])('rejects before querying when request %s context is absent', async (_ctx, req) => {
    const res = makeResponse();

    await expect(getRecentTransactions(req as unknown as Request, res)).rejects.toThrow(
      'Authenticated user and tenant are required',
    );
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
