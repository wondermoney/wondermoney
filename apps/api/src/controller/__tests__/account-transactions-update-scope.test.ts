import { LockMode, QueryOrder } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { InternalServerError, NotFoundError, UnauthorizedError } from '@utils/errors';

import { mockRes } from '../../__tests__/__helpers__/mock-request';

// An amount edit rewrites running balances on the edited transaction's later rows. Scoped only by
// app user + date, editing one account could rewrite balances on another account — and potentially
// another tenant. These tests pin the authorization + scoping + atomicity contract of that path.

const mocked = vi.hoisted(() => {
  // Declare the async signatures explicitly so mockImplementation callbacks may return promises;
  // captured call args come back as `unknown` and are cast at the few property-access sites.
  const em = {
    find: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    findOne: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    flush: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    persist: vi.fn<(...args: unknown[]) => unknown>(),
    transactional: vi.fn<(cb: (em: unknown) => Promise<unknown>) => Promise<unknown>>(),
  };
  return { em };
});

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema, req: unknown) => Promise.resolve(req)),
}));

vi.mock('../../app.js', () => ({ DI: { em: mocked.em } }));

const { updateTransaction } = await import('../account/transactions');

const USER = { appuserKey: 1 };
const TENANT = { tenantKey: 7 };
const EDIT_DATE = new Date('2026-01-10T00:00:00.000Z');

function editedTransaction() {
  return {
    accountKey: { accountKey: 100 },
    appuserCurrencyBalance: 100,
    appuserCurrencyKey: { code: 'EUR' },
    appuserSettlementAmount: -100,
    appuserTransactionCategories: { getItems: () => [] },
    balance: 100,
    settlementAmount: -100,
    settlementCurrencyKey: { code: 'EUR' },
    transactionDate: EDIT_DATE,
    transactionKey: 10,
  };
}

function futureTransaction(overrides: Record<string, unknown> = {}) {
  return {
    appuserCurrencyBalance: 80,
    appuserCurrencyKey: { code: 'EUR' },
    appuserSettlementAmount: -50,
    balance: 80,
    settlementAmount: -50,
    settlementCurrencyKey: { code: 'EUR' },
    transactionDate: new Date('2026-01-11T00:00:00.000Z'),
    transactionKey: 11,
    ...overrides,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    body: { updatedAmount: -40 },
    params: { transactionId: 10 },
    tenant: TENANT,
    user: USER,
    ...overrides,
  } as unknown as Parameters<typeof updateTransaction>[0];
}

function setupHappyPath({ chain = [editedTransaction()] as Record<string, unknown>[] } = {}) {
  const account = { accountKey: 100, appuserCurrencyBalance: 500, balance: 500, tenantKey: TENANT };
  // The chain load returns the same anchor row the controller mutated via findOne — in production
  // they are the same managed entity. Mirror that here so the controller's edit is visible to the
  // chain helper.
  const anchor = chain[0] ?? editedTransaction();
  mocked.em.findOne.mockImplementation((entity: unknown) => {
    if (entity === Transaction) return Promise.resolve(anchor);
    if (entity === Account) return Promise.resolve(account);
    return Promise.resolve(null);
  });
  mocked.em.find.mockResolvedValue(chain);
  mocked.em.flush.mockResolvedValue(undefined);
  return { account, anchor, chain };
}

describe('updateTransaction — account/tenant scoping and atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.em.persist.mockReturnValue(mocked.em);
    mocked.em.transactional.mockImplementation((cb) => cb(mocked.em));
  });

  it('fails before any database access when the authenticated user is missing', async () => {
    const next = vi.fn();
    await expect(updateTransaction(makeReq({ user: undefined }), mockRes({ json: vi.fn() }), next)).rejects.toBeInstanceOf(UnauthorizedError);

    expect(next).not.toHaveBeenCalled();
    expect(mocked.em.findOne).not.toHaveBeenCalled();
    expect(mocked.em.find).not.toHaveBeenCalled();
    expect(mocked.em.transactional).not.toHaveBeenCalled();
  });

  it('fails before any database access when the tenant is unresolved', async () => {
    const next = vi.fn();
    await expect(updateTransaction(makeReq({ tenant: undefined }), mockRes({ json: vi.fn() }), next)).rejects.toBeInstanceOf(InternalServerError);

    expect(next).not.toHaveBeenCalled();
    expect(mocked.em.findOne).not.toHaveBeenCalled();
  });

  it('scopes the edited-transaction lookup by tenant, active row, and key', async () => {
    setupHappyPath();
    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    const txnLookup = mocked.em.findOne.mock.calls.find(([entity]) => entity === Transaction);
    expect(txnLookup?.[1]).toMatchObject({
      deletedAt: undefined,
      tenantKey: TENANT,
      transactionKey: 10,
    });
  });

  it('produces a single non-enumerating not-found outcome for a foreign/deleted/cross-tenant id', async () => {
    mocked.em.findOne.mockResolvedValue(null);
    const next = vi.fn();
    const json = vi.fn();

    await updateTransaction(makeReq(), mockRes({ json }), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(json).not.toHaveBeenCalled();
    expect(mocked.em.find).not.toHaveBeenCalled();
    expect(mocked.em.transactional).not.toHaveBeenCalled();
  });

  it('loads the chain on the same account, scoped to settled, BOOKED-only statuses', async () => {
    setupHappyPath();
    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    expect(mocked.em.find).toHaveBeenCalledTimes(1);
    const [entity, filter] = mocked.em.find.mock.calls[0]!;
    expect(entity).toBe(Transaction);
    expect(filter).toMatchObject({
      accountKey: { accountKey: 100 },
    });
    // The chain load narrows to settled statuses; hidden rows stay included via the disabled filter.
    const statuses = (filter as { transactionStatusKey?: { name?: { $in?: unknown } } }).transactionStatusKey?.name?.$in;
    expect(statuses).toEqual(['BOOKED']);
  });

  it('orders the chain deterministically ascending by date then key', async () => {
    setupHappyPath();
    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    const [, , opts] = mocked.em.find.mock.calls[0]!;
    expect((opts as { orderBy?: unknown }).orderBy).toEqual({ transactionDate: QueryOrder.ASC, transactionKey: QueryOrder.ASC });
  });

  it('includes hidden transactions in the chain load so the stored balance chain stays accurate', async () => {
    setupHappyPath();
    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    const [, , opts] = mocked.em.find.mock.calls[0]!;
    expect((opts as { filters?: unknown }).filters).toEqual({ hidden: false });
  });

  it('mutates balances inside a transaction, locking the owning account by tenant', async () => {
    setupHappyPath();
    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    expect(mocked.em.transactional).toHaveBeenCalledTimes(1);
    const accountLookup = mocked.em.findOne.mock.calls.find(([entity]) => entity === Account);
    expect(accountLookup?.[1]).toMatchObject({
      deletedAt: undefined,
      tenantKey: TENANT,
    });
    expect(accountLookup?.[2]).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE });
  });

  it('recomputes every later same-account balance via the chain helper and sets account.balance to the chain tail', async () => {
    // The controller overwrites the anchor's amounts with the new `updatedAmount` before the
    // helper runs, so the anchor contributes -40 (not the original -100). The anchor is the
    // oldest row, so the chain opens on what the account held before it: its stored balance
    // minus its pre-edit amount, 100 - -100 = 200 (not 0). Then:
    //   row 10: 200 + -40 = 160 (anchor, edited)
    //   row 11: 160 + -50 = 110
    //   row 12: 110 + -50 = 60
    const future1 = futureTransaction({ appuserCurrencyBalance: 80, appuserSettlementAmount: -50, balance: 80, settlementAmount: -50, transactionDate: new Date('2026-01-11T00:00:00.000Z'), transactionKey: 11 });
    const future2 = futureTransaction({ appuserCurrencyBalance: 60, appuserSettlementAmount: -50, balance: 60, settlementAmount: -50, transactionDate: new Date('2026-01-12T00:00:00.000Z'), transactionKey: 12 });
    const anchor = editedTransaction();
    const chain = [anchor, future1, future2];
    const { account } = setupHappyPath({ chain });

    await updateTransaction(makeReq(), mockRes({ json: vi.fn() }), vi.fn());

    expect(anchor.balance).toBe(160);
    expect(future1.balance).toBe(110);
    expect(future2.balance).toBe(60);
    expect(account.balance).toBe(60);
  });
});
