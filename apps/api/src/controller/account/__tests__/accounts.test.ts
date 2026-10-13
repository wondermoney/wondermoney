import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@entity/Account';
import { AccountType } from '@entity/AccountType';
import { Currency } from '@entity/Currency';
import { ForbiddenError, NotFoundError } from '@utils/errors';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  getAppuserTenantByAppuser: vi.fn(),
  getUserById: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('../../../app.js', () => ({
  DI: {
    em: {
      find: mocks.find,
      findOne: mocks.findOne,
      getRepository: () => ({
        getAppuserTenantByAppuser: mocks.getAppuserTenantByAppuser,
        getUserById: mocks.getUserById,
      }),
      persist: mocks.persist,
    },
  },
}));

import { createOfflineAccount, getAccount, getAccounts, getAccountTypes, mapAccountSummary, updateAccount } from '../accounts';

const makeResponse = () => ({ json: vi.fn() }) as unknown as Response;

// Partial relation shapes are intentional: these fixtures only carry the fields the controller
// reads, so typing the override surface loosely avoids a never-cast on every nested relation.
type AccountFixtureOverrides = Partial<
  Omit<Account, 'accountFinancialInstitutionKey' | 'accountOwnerAppuserKey' | 'currencyKey' | 'nordigenRequisitionKey' | 'tenantKey'>
> & {
  accountFinancialInstitutionKey?: null | { displayName?: null | string; logoUrl?: null | string };
  accountOwnerAppuserKey?: null | { appuserKey?: number; currencyKey?: { code?: string }; firstName?: string };
  currencyKey?: null | { code?: string };
  nordigenRequisitionKey?: null | { nordigenRequisitionKey?: number; requisitionId?: string };
  tenantKey?: null | { tenantKey?: number };
};

const account = (overrides: AccountFixtureOverrides = {}) => ({
  accountFinancialInstitutionKey: undefined,
  accountId: undefined,
  accountKey: 1,
  accountName: 'Cash',
  accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
  appuserCurrencyBalance: 0,
  balance: 0,
  currencyKey: { code: 'EUR' },
  isPrivate: false,
  nordigenRequisitionKey: undefined,
  refreshedAt: undefined,
  ...overrides,
}) as Account;

const accountSummaryPopulate = [
  'accountFinancialInstitutionKey',
  'currencyKey',
  'accountOwnerAppuserKey',
  'accountOwnerAppuserKey.currencyKey',
  'nordigenRequisitionKey',
];

describe('getAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries one active account by id and current tenant with summary relations', async () => {
    const user = { appuserKey: 71 };
    const tenant = { tenantKey: 113 };
    mocks.findOne.mockResolvedValue(account({ accountKey: 41 }));
    mocks.find.mockResolvedValue([]);
    const res = makeResponse();

    await getAccount(
      { params: { accountId: '41' }, tenant, user } as unknown as Request,
      res,
    );

    expect(mocks.findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountKey: 41,
        deletedAt: undefined,
        tenantKey: tenant,
      },
      { populate: accountSummaryPopulate },
    );
    // Plus the open-incident lookup (stale-sync) and the pending-sums lookup (available balance).
    expect(mocks.find).toHaveBeenCalledWith(
      expect.anything(),
      { appuserKey: user, deletedAt: undefined, finality: 'non_terminal', userVisible: true },
      { fields: ['requisitionId'] },
    );
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('returns the exact shared account summary without leaking entity fields', async () => {
    mocks.findOne.mockResolvedValue(
      account({
        accountFinancialInstitutionKey: { displayName: null, logoUrl: 'https://legacy.example/logo.svg' },
        accountKey: 41,
        accountName: undefined,
        accountNumber: 'sensitive-account-number',
        accountOwnerAppuserKey: { currencyKey: { code: 'USD' } },
        appuserCurrencyBalance: undefined,
        balance: 0,
        currencyKey: { code: 'GBP' },
        nordigenRequisitionKey: { nordigenRequisitionKey: 9 },
        refreshedAt: new Date('2026-07-18T10:15:00.000Z'),
        tenantKey: { tenantKey: 113 },
      }),
    );
    mocks.find.mockResolvedValue([]);
    const res = makeResponse();

    await getAccount(
      {
        params: { accountId: '41' },
        tenant: { tenantKey: 113 },
        user: { appuserKey: 71 },
      } as unknown as Request,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      account: {
        accountFinancialInstitutionKey: {
          displayName: null,
          logoUrl: 'https://legacy.example/logo.svg',
        },
        accountKey: 41,
        accountName: null,
        accountOwnerAppuserKey: { currencyKey: { code: 'USD' } },
        appuserCurrencyAvailableBalance: null,
        appuserCurrencyBalance: null,
        availableBalance: 0,
        balance: 0,
        currencyKey: { code: 'GBP' },
        isOwnedByViewer: false,
        isPrivate: false,
        ownerFirstName: null,
        refreshedAt: '2026-07-18T10:15:00.000Z',
        source: 'open_banking',
        syncStatus: { hasOpenIncident: false, lastSyncedAt: '2026-07-18T10:15:00.000Z', staleness: 'very_stale' },
      },
    });
    const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { account: Record<string, unknown> };
    expect(payload.account).not.toHaveProperty('accountNumber');
    expect(payload.account).not.toHaveProperty('tenantKey');
    expect(payload.account).not.toHaveProperty('nordigenRequisitionKey');
  });

  it.each([
    ['user', { params: { accountId: '41' }, tenant: { tenantKey: 113 } }],
    ['tenant', { params: { accountId: '41' }, user: { appuserKey: 71 } }],
  ])('rejects when request %s context is absent before querying', async (_context, request) => {
    const res = makeResponse();

    await expect(getAccount(request as unknown as Request, res)).rejects.toThrow(
      'Authenticated user and tenant are required',
    );

    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each(['nonexistent', 'foreign owner', 'foreign tenant', 'soft-deleted'])
    ('returns the same generic not-found outcome for an invisible %s account', async () => {
      mocks.findOne.mockResolvedValue(null);
      const res = makeResponse();

      const result = getAccount(
        {
          params: { accountId: '41' },
          tenant: { tenantKey: 113 },
          user: { appuserKey: 71 },
        } as unknown as Request,
        res,
      );

      await expect(result).rejects.toMatchObject({
        message: 'Account not found',
        name: 'NotFoundError',
        status: 404,
      });
      expect(res.json).not.toHaveBeenCalled();
    });

  it.each([
    account({ currencyKey: { code: '' } }),
    account({ accountOwnerAppuserKey: { currencyKey: { code: '' } } }),
  ])('fails closed without responding when a required currency is unavailable', async (value) => {
    mocks.findOne.mockResolvedValue(value);
    const res = makeResponse();

    await expect(
      getAccount(
        {
          params: { accountId: '41' },
          tenant: { tenantKey: 113 },
          user: { appuserKey: 71 },
        } as unknown as Request,
        res,
      ),
    ).rejects.toThrow(/currency relation is unavailable/i);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('getAccounts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the query to current tenant and active rows with deterministic ordering', async () => {
    mocks.find.mockResolvedValue([]);
    const user = { appuserKey: 7 };
    const tenant = { tenantKey: 11 };
    const req = { tenant, user } as unknown as Request;
    const res = makeResponse();

    await getAccounts(req, res);

    expect(mocks.find).toHaveBeenCalledWith(
      expect.anything(),
      { deletedAt: undefined, tenantKey: tenant },
      {
        orderBy: [{ accountName: QueryOrder.ASC }, { accountKey: QueryOrder.ASC }],
        populate: [
          'accountFinancialInstitutionKey',
          'currencyKey',
          'accountOwnerAppuserKey',
          'accountOwnerAppuserKey.currencyKey',
          'nordigenRequisitionKey',
        ],
      },
    );
    expect(res.json).toHaveBeenCalledWith({ accounts: [] });
  });

  it.each([
    ['user', { tenant: { tenantKey: 11 } }],
    ['tenant', { user: { appuserKey: 7 } }],
  ])('rejects when the request is missing %s context before querying', async (_context, request) => {
    const res = makeResponse();

    await expect(getAccounts(request as unknown as Request, res)).rejects.toThrow(
      'Authenticated user and tenant are required',
    );

    expect(mocks.find).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns explicit nullable values, zero balances, and authoritative source kinds', async () => {
    const refreshedAt = new Date('2026-07-17T09:30:00.000Z');
    mocks.find.mockResolvedValue([
      account({
        accountFinancialInstitutionKey: {
          displayName: 'Example Bank',
          logoUrl: undefined,
        },
        accountKey: 2,
        accountName: 'Linked',
        appuserCurrencyBalance: 0,
        balance: 0,
        nordigenRequisitionKey: { nordigenRequisitionKey: 4 },
        refreshedAt,
      }),
      account({
        accountKey: 3,
        accountName: undefined,
        appuserCurrencyBalance: undefined,
        balance: undefined,
      }),
    ]);
    const res = makeResponse();

    await getAccounts(
      { tenant: { tenantKey: 11 }, user: { appuserKey: 7 } } as unknown as Request,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      accounts: [
        {
          accountFinancialInstitutionKey: {
            displayName: 'Example Bank',
            logoUrl: null,
          },
          accountKey: 2,
          accountName: 'Linked',
          accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
          appuserCurrencyAvailableBalance: 0,
          appuserCurrencyBalance: 0,
          availableBalance: 0,
          balance: 0,
          currencyKey: { code: 'EUR' },
          isOwnedByViewer: false,
          isPrivate: false,
          ownerFirstName: null,
          refreshedAt: '2026-07-17T09:30:00.000Z',
          source: 'open_banking',
          syncStatus: { hasOpenIncident: false, lastSyncedAt: '2026-07-17T09:30:00.000Z', staleness: 'very_stale' },
        },
        {
          accountFinancialInstitutionKey: null,
          accountKey: 3,
          accountName: null,
          accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
          appuserCurrencyAvailableBalance: null,
          appuserCurrencyBalance: null,
          availableBalance: null,
          balance: null,
          currencyKey: { code: 'EUR' },
          isOwnedByViewer: false,
          isPrivate: false,
          ownerFirstName: null,
          refreshedAt: null,
          source: 'manual',
          syncStatus: null,
        },
      ],
    });
  });

  it('treats a legacy account id without a requisition as open banking', async () => {
    mocks.find.mockResolvedValue([account({ accountId: 'legacy-account', nordigenRequisitionKey: undefined })]);
    const res = makeResponse();

    await getAccounts(
      { tenant: { tenantKey: 11 }, user: { appuserKey: 7 } } as unknown as Request,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ accounts: [expect.objectContaining({ source: 'open_banking' })] });
  });

  it('flags an account with an open sync incident as error even when recently synced', async () => {
    mocks.find
      .mockResolvedValueOnce([
        account({
          accountKey: 5,
          nordigenRequisitionKey: { requisitionId: 'req-1' },
          refreshedAt: new Date(),
          transactionsRefreshedAt: new Date(),
        }),
      ])
      .mockResolvedValueOnce([{ requisitionId: 'req-1' }]);
    const res = makeResponse();

    await getAccounts({ tenant: { tenantKey: 11 }, user: { appuserKey: 7 } } as unknown as Request, res);

    const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { accounts: { syncStatus: unknown }[] };
    expect(payload.accounts[0]?.syncStatus).toEqual({ hasOpenIncident: true, lastSyncedAt: expect.any(String), staleness: 'error' });
  });

  it('exposes available balance as the current balance net of pending transactions', async () => {
    mocks.find
      .mockResolvedValueOnce([account({ accountKey: 8, appuserCurrencyBalance: 100, balance: 100 })]) // accounts
      .mockResolvedValueOnce([]) // open incidents
      .mockResolvedValueOnce([ // pending transactions on account 8
        { accountKey: { accountKey: 8 }, appuserSettlementAmount: -30, settlementAmount: -30 },
        { accountKey: { accountKey: 8 }, appuserSettlementAmount: -10, settlementAmount: -10 },
      ]);
    mocks.findOne.mockResolvedValue({ name: 'PENDING' }); // pending status lookup
    const res = makeResponse();

    await getAccounts({ tenant: { tenantKey: 11 }, user: { appuserKey: 7 } } as unknown as Request, res);

    const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { accounts: { appuserCurrencyAvailableBalance: number; availableBalance: number; balance: number }[] };
    expect(payload.accounts[0]).toMatchObject({ appuserCurrencyAvailableBalance: 60, availableBalance: 60, balance: 100 });
  });

  it('preserves account and institution name whitespace exactly', () => {
    const summary = mapAccountSummary(
      account({
        accountFinancialInstitutionKey: { displayName: '  Example Bank  ', logoUrl: undefined },
        accountName: '  Cash  ',
      }),
    );

    expect(summary.accountName).toBe('  Cash  ');
    expect(summary.accountFinancialInstitutionKey?.displayName).toBe('  Example Bank  ');
  });

  it('preserves repository order and does not leak entity-only fields', async () => {
    mocks.find.mockResolvedValue([
      account({ accountKey: 9, accountName: 'First', accountNumber: 'secret-1' }),
      account({ accountKey: 4, accountName: 'Second', accountNumber: 'secret-2' }),
    ]);
    const res = makeResponse();

    await getAccounts(
      { tenant: { tenantKey: 11 }, user: { appuserKey: 7 } } as unknown as Request,
      res,
    );

    const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { accounts: Record<string, unknown>[] };
    expect(payload.accounts.map((item) => item['accountKey'])).toEqual([9, 4]);
    expect(payload.accounts[0]).not.toHaveProperty('accountNumber');
    expect(payload.accounts[0]).not.toHaveProperty('tenantKey');
  });
});

describe('mapAccountSummary', () => {
  it.each([
    account({ currencyKey: {} }),
    account({ currencyKey: { code: 'eur' } }),
    account({ currencyKey: { code: 'EURO' } }),
    account({ accountOwnerAppuserKey: undefined }),
    account({ accountOwnerAppuserKey: { currencyKey: {} } }),
    account({ accountOwnerAppuserKey: { currencyKey: { code: 'usd' } } }),
  ])('fails closed when a required currency relation is unavailable', (value) => {
    expect(() => mapAccountSummary(value)).toThrow(/currency relation is unavailable/i);
  });

  // RAD-343 (C2): the DTO exposes privacy + ownership so the web can gate the
  // owner-only privacy toggle and surface shared context.
  it('exposes isPrivate, isOwnedByViewer, and ownerFirstName', () => {
    const owned = account({
      accountOwnerAppuserKey: { appuserKey: 7, currencyKey: { code: 'EUR' }, firstName: 'Ana' },
      isPrivate: true,
    });
    const asOwner = mapAccountSummary(owned, {
      now: new Date(),
      openIncidentRequisitionIds: new Set(),
      viewerAppuserKey: 7,
    });
    expect(asOwner).toMatchObject({ isOwnedByViewer: true, isPrivate: true, ownerFirstName: 'Ana' });

    const asOther = mapAccountSummary(owned, {
      now: new Date(),
      openIncidentRequisitionIds: new Set(),
      viewerAppuserKey: 8,
    });
    expect(asOther.isOwnedByViewer).toBe(false);
  });
});

describe('updateAccount privacy (RAD-343 C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persist.mockReturnValue({ flush: vi.fn() });
  });

  it('lets the account owner make it private', async () => {
    const account = { accountName: 'Cash', accountOwnerAppuserKey: { appuserKey: 1 }, isPrivate: false };
    mocks.findOne.mockResolvedValue(account);
    const next = vi.fn();
    const sendStatus = vi.fn();

    await updateAccount(
      { body: { isPrivate: true }, params: { accountId: '5' }, user: { appuserKey: 1 } } as unknown as Request,
      { sendStatus } as unknown as Response,
      next,
    );

    expect(account.isPrivate).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
  });

  it('forbids a non-owner from changing privacy', async () => {
    const account = { accountName: 'Cash', accountOwnerAppuserKey: { appuserKey: 1 }, isPrivate: false };
    mocks.findOne.mockResolvedValue(account);
    const next = vi.fn();

    await updateAccount(
      { body: { isPrivate: true }, params: { accountId: '5' }, user: { appuserKey: 2 } } as unknown as Request,
      { sendStatus: vi.fn() } as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(account.isPrivate).toBe(false);
  });
});

// RAD-651 — offline accounts had no way to record a type (checking/savings/credit/etc). These
// tests cover the new optional `accountTypeId` request field and its wiring into `accountTypeKey`.
describe('createOfflineAccount accountTypeId (RAD-651)', () => {
  const currency = { currencyKey: 1 };
  const appuser = { appuserKey: 7, currencyKey: currency };
  const appUserTenant = { appuserKey: { appuserKey: 7 }, tenantKey: { tenantKey: 11 } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserById.mockResolvedValue(appuser);
    mocks.getAppuserTenantByAppuser.mockResolvedValue(appUserTenant);
  });

  function captureFirstPersistedAccount() {
    const persisted: Record<string, unknown>[] = [];
    mocks.persist.mockImplementation((account: Record<string, unknown>) => {
      persisted.push(account);
      return { flush: vi.fn().mockResolvedValue(undefined) };
    });
    return persisted;
  }

  it('sets accountTypeKey from a looked-up AccountType when accountTypeId is provided', async () => {
    const accountType = { accountTypeKey: 3, description: 'SAVINGS' };
    mocks.findOne.mockImplementation((Entity: unknown) => (Entity === Currency ? currency : Entity === AccountType ? accountType : null));
    const persisted = captureFirstPersistedAccount();
    const sendStatus = vi.fn();
    const next = vi.fn();

    await createOfflineAccount(
      { body: { accountTypeId: '3', currencyId: 1, currentBalance: 100, name: 'Cash' }, user: { appuserKey: 7 } } as unknown as Request,
      { sendStatus } as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(201);
    expect(persisted[0]).toMatchObject({ accountTypeKey: accountType });
  });

  it('leaves accountTypeKey unset when accountTypeId is omitted, preserving existing client behaviour', async () => {
    mocks.findOne.mockImplementation((Entity: unknown) => (Entity === Currency ? currency : null));
    const persisted = captureFirstPersistedAccount();
    const sendStatus = vi.fn();
    const next = vi.fn();

    await createOfflineAccount(
      { body: { currencyId: 1, currentBalance: 100, name: 'Cash' }, user: { appuserKey: 7 } } as unknown as Request,
      { sendStatus } as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(201);
    expect(persisted[0]?.['accountTypeKey']).toBeUndefined();
  });

  it('fails closed with an error and does not persist when accountTypeId matches no seeded AccountType', async () => {
    mocks.findOne.mockImplementation((Entity: unknown) => (Entity === Currency ? currency : Entity === AccountType ? null : null));
    const sendStatus = vi.fn();
    const next = vi.fn();

    await createOfflineAccount(
      { body: { accountTypeId: '999', currencyId: 1, currentBalance: 100, name: 'Cash' }, user: { appuserKey: 7 } } as unknown as Request,
      { sendStatus } as unknown as Response,
      next,
    );

    // RAD-audit: was InternalServerError. An unknown accountTypeId is the client sending a
    // bad id — 404, not a server fault that pages Sentry. The property under test
    // (fails closed, persists nothing) is unchanged.
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(sendStatus).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});

describe('getAccountTypes (RAD-651)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists account types ordered by description, exposing only key and description', async () => {
    mocks.find.mockResolvedValue([
      { accountTypeKey: 1, description: 'CHECKING' },
      { accountTypeKey: 5, description: 'SAVINGS', secretInternalField: 'nope' },
    ]);
    const res = makeResponse();

    await getAccountTypes({} as unknown as Request, res);

    expect(mocks.find).toHaveBeenCalledWith(expect.anything(), {}, { orderBy: { description: QueryOrder.ASC } });
    expect(res.json).toHaveBeenCalledWith({
      accountTypes: [
        { accountTypeKey: 1, description: 'CHECKING' },
        { accountTypeKey: 5, description: 'SAVINGS' },
      ],
    });
    const payload = vi.mocked(res.json).mock.calls[0]?.[0] as { accountTypes: Record<string, unknown>[] };
    expect(payload.accountTypes[1]).not.toHaveProperty('secretInternalField');
  });
});
