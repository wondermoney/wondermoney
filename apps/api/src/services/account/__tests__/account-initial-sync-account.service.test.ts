import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { heartbeatJob } = vi.hoisted(() => ({ heartbeatJob: vi.fn().mockResolvedValue(true) }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException, captureMessage: sentry.captureMessage }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { heartbeatJob } }));

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import service, { selectProviderBalanceAmount } from '../account-initial-sync-account.service';

type Em = NonNullable<SyncDeps['em']>;
type SyncDeps = NonNullable<Parameters<typeof service.syncAccountsForRequisition>[1]>;
// The tests drive a hand-rolled fake `em` whose methods are `vi.fn()`s; expose it through the
// service's structural `em` type at the boundary.
const asEm = (emMock: object): Em => emMock as Em;

// RAD-564: `account.balance` is the anchor the whole running-balance chain is rebuilt from, so which
// of the provider's balance types it comes from has to be deterministic. Taking whichever entry came
// first let it flip between a booked balance and one including pending authorisations, shifting
// every row on the account with no transaction to explain it.
describe('provider balance selection (RAD-564)', () => {
  it('prefers closingBooked over an available balance regardless of array order', () => {
    expect(selectProviderBalanceAmount({ balances: [
      { balanceAmount: { amount: '150.00' }, balanceType: 'interimAvailable' },
      { balanceAmount: { amount: '100.00' }, balanceType: 'closingBooked' },
    ] })).toBe('100.00');
  });

  it('is stable when the provider reorders the array between syncs', () => {
    const ordered = [{ balanceAmount: { amount: '100.00' }, balanceType: 'closingBooked' }, { balanceAmount: { amount: '150.00' }, balanceType: 'expected' }];
    expect(selectProviderBalanceAmount({ balances: ordered })).toBe(selectProviderBalanceAmount({ balances: [...ordered].reverse() }));
  });

  it('walks down the preference list when the preferred types are absent', () => {
    expect(selectProviderBalanceAmount({ balances: [
      { balanceAmount: { amount: '9.00' }, balanceType: 'forwardAvailable' },
      { balanceAmount: { amount: '7.00' }, balanceType: 'expected' },
    ] })).toBe('7.00');
  });

  it('skips entries with no amount', () => {
    expect(selectProviderBalanceAmount({ balances: [{ balanceType: 'closingBooked' }, { balanceAmount: { amount: '3.00' }, balanceType: 'expected' }] })).toBe('3.00');
  });

  it('falls back to the first usable entry for an unknown balance type, and to zero for none', () => {
    expect(selectProviderBalanceAmount({ balances: [{ balanceAmount: { amount: '4.00' }, balanceType: 'somethingNew' }] })).toBe('4.00');
    expect(selectProviderBalanceAmount({ balances: [] })).toBe('0');
    expect(selectProviderBalanceAmount({})).toBe('0');
  });
});

interface Client {
  account: (accountId: string) => {
    getBalances: () => Promise<{ balances: { balanceAmount: { amount: string } }[] }>;
    getDetails: () => Promise<{ account?: { currency: string; name: string; ownerName: string } }>;
    getMetadata: () => Promise<{ iban?: string; institution_id: string }>;
  };
  requisition: { getRequisitionById: (id: string) => Promise<{ accounts: string[]; institution_id?: string }> };
}

interface Connection { appuserKey: { appuserKey: number }; enableBankingConnectionKey: number; sessionId: string; state: string; status: EnableBankingConnectionStatus }

interface Currency { code: string }

interface Tenant { appuserKey: { appuserKey: number; currencyKey?: Currency }; tenantKey: { tenantKey: number } }

const linkedConnection = (): Connection => ({ appuserKey: { appuserKey: 9 }, enableBankingConnectionKey: 1, sessionId: 'sess-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED });
const tenant = (): Tenant => ({ appuserKey: { appuserKey: 9 }, tenantKey: { tenantKey: 3 } });
const currency = (): Currency => ({ code: 'EUR' });

const client = (opts: { accounts?: string[]; balance?: string; fail?: string; failWith?: Error } = {}): Client => ({
  account: (accountId: string) => ({
    getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: opts.balance ?? '10' } }] }),
    getDetails: () => opts.fail === accountId ? Promise.reject(opts.failWith ?? new Error('details failed')) : Promise.resolve({ account: { currency: 'EUR', name: `Name ${accountId}`, ownerName: 'Owner' } }),
    getMetadata: () => Promise.resolve({ iban: 'DE123', institution_id: 'bank-1' }),
  }),
  requisition: { getRequisitionById: () => Promise.resolve({ accounts: opts.accounts ?? ['acc-1'] }) },
});

/** An Axios-shaped rejection: the message carries only the status, the reason lives on `response`. */
const axiosLikeError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, name: 'AxiosError', response: { data, status } });

const createEm = (overrides: Partial<{ connection: Connection | null; currency: Currency | null; deletedAccount: unknown; exchangeRate: unknown; existingAccount: unknown; institution: unknown; tenant: null | Tenant }> = {}) => ({
  create: vi.fn((_entity: unknown, data: unknown) => data),
  findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
    const name = (entity as { name?: string }).name;
    if (name === 'EnableBankingConnection') return Object.hasOwn(overrides, 'connection') ? overrides.connection : linkedConnection();
    if (name === 'AppuserTenant') return Object.hasOwn(overrides, 'tenant') ? overrides.tenant : tenant();
    if (name === 'Currency') return Object.hasOwn(overrides, 'currency') ? overrides.currency : currency();
    if (name === 'ExchangeRate') return Object.hasOwn(overrides, 'exchangeRate') ? overrides.exchangeRate : null;
    if (name === 'AccountFinancialInstitution') return Object.hasOwn(overrides, 'institution') ? overrides.institution : null;
    if (name === 'Account') return Object.hasOwn(where, 'deletedAt') ? (Object.hasOwn(overrides, 'deletedAccount') ? overrides.deletedAccount : null) : (Object.hasOwn(overrides, 'existingAccount') ? overrides.existingAccount : null);
    return null;
  }),
  findOneOrFail: vi.fn(() => (Object.hasOwn(overrides, 'institution') ? overrides.institution : { id: 'bank-1' })),
  flush: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockReturnThis(),
});

beforeEach(() => vi.clearAllMocks());

describe('account initial sync account service', () => {
  it('fails when requisition is missing', async () => {
    const em = createEm({ connection: null });
    await expect(service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) })).rejects.toThrow('Enable Banking connection not found');
  });

  it('fails when requisition is not linked', async () => {
    const em = createEm({ connection: { ...linkedConnection(), status: EnableBankingConnectionStatus.CREATED } });
    await expect(service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) })).rejects.toThrow('Enable Banking connection is not linked');
  });

  it('fails when tenant is missing', async () => {
    const em = createEm({ tenant: null });
    await expect(service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) })).rejects.toThrow('Active tenant not found for requisition');
  });

  it('creates institution and account on happy path', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ correlationId: 'c1', enableBankingConnectionKey: 1, queueJobId: 'j1' }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(result).toMatchObject({ accountsCreated: 1, accountsFailed: 0, accountsFetched: 1, status: 'completed' });
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { appuserKey: { appuserKey: 9 }, deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
  });

  it('sets appuserCurrencyBalance to balance for same currency', async () => {
    const em = createEm({ tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } } });
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['appuserCurrencyBalance']).toBe(10);
  });

  it('leaves appuserCurrencyBalance undefined when conversion is missing', async () => {
    const em = createEm({ exchangeRate: null, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD' } }, tenantKey: { tenantKey: 3 } } });
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['appuserCurrencyBalance']).toBeUndefined();
  });

  it('returns partial when one account fails', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })) });
    expect(result.status).toBe('partial');
    expect(result.failedAccountIds).toEqual(['acc-2']);
  });

  it('marks non-duplicate institution create errors as failed', async () => {
    const em = createEm({ institution: null });
    em.flush.mockRejectedValueOnce(new Error('boom'));
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('marks non-duplicate account create errors as failed', async () => {
    const em = createEm({ institution: null });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('handles duplicate institution create by reloading', async () => {
    const em = createEm({ institution: null });
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(result.accountsFailed).toBe(0);
  });

  it('handles duplicate account create by reloading', async () => {
    const em = createEm({ existingAccount: { accountKey: 9 }, institution: { accountFinancialInstitutionKey: 1 } });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(result.accountsFailed).toBe(0);
  });

  it('copies appuserCurrencyBalance into duplicate fallback reloads', async () => {
    const reloaded = { accountKey: 9, appuserCurrencyBalance: undefined };
    const em = createEm({ currency: { code: 'EUR' }, institution: { accountFinancialInstitutionKey: 1 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } } });
    let reloadCount = 0;
    em.findOne.mockImplementation((entity: unknown) => {
      const name = (entity as { name?: string }).name;
      if (name === 'EnableBankingConnection') return linkedConnection();
      if (name === 'AppuserTenant') return { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } };
      if (name === 'Currency') return { code: 'EUR' };
      if (name === 'AccountFinancialInstitution') return { accountFinancialInstitutionKey: 1 };
      if (name === 'Account') return reloadCount++ < 2 ? null : reloaded;
      return null;
    });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    const createdAccount = em.persist.mock.calls[0]?.[0] as undefined | { appuserCurrencyBalance?: number };
    expect(createdAccount?.appuserCurrencyBalance).toBe(10);
  });

  it('preserves existing account fields when syncing existing accounts', async () => {
    const existingAccount = { accountId: 'acc-1', accountKey: 9, accountName: 'User Override', accountNumber: '123', holderName: 'Existing Holder' };
    const em = createEm({ existingAccount, institution: { accountFinancialInstitutionKey: 1 } });
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client()) });
    expect(existingAccount.accountName).toBe('User Override');
    expect(existingAccount.accountNumber).toBe('123');
    expect(existingAccount.holderName).toBe('Existing Holder');
  });

  it('marks invalid balance as failed', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ balance: '10abc' })) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('returns failed when requisition has no accounts', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: [] })) });
    expect(result.status).toBe('failed');
    expect(result.accountsTotal).toBe(0);
    expect(result.accountsFetched).toBe(0);
    expect(result.accountsFailed).toBe(0);
    expect(em.persist).not.toHaveBeenCalled();
  });


  it('processes accounts serially and preserves partial success', async () => {
    const em = createEm();
    const callOrder: string[] = [];
    const bankSyncFactory = () => Promise.resolve({
      account: (accountId: string) => ({
        getBalances: () => { callOrder.push(`balances:${accountId}`); return Promise.resolve({ balances: [{ balanceAmount: { amount: '10' } }] }); },
        getDetails: () => { callOrder.push(`details:${accountId}`); return Promise.resolve({ account: { currency: 'EUR', name: `Name ${accountId}`, ownerName: 'Owner' } }); },
        getMetadata: () => { callOrder.push(`metadata:${accountId}`); return Promise.resolve({ iban: 'DE123', institution_id: 'bank-1' }); },
      }),
      requisition: { getRequisitionById: () => Promise.resolve(({ accounts: ['acc-1', 'acc-2'] })) },
    });
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory });
    expect(result.status).toBe('completed');
    expect(callOrder.indexOf('details:acc-2')).toBeGreaterThan(callOrder.indexOf('balances:acc-1'));
  });

  it('marks all fetch failures as failed', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1'], fail: 'acc-1' })) });
    expect(result.status).toBe('failed');
    expect(result.accountsFetched).toBe(0);
  });

  it('logs the real per-account error instead of swallowing it (RAD-519)', async () => {
    const em = createEm();
    const warn = vi.fn();
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })), logger: { error: vi.fn(), info: vi.fn(), warn } });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-2', error: expect.objectContaining({ message: 'details failed' }), requisitionId: 'sess-1' }),
      'Account initial sync account fetch failed',
    );
  });

  it('reports the real per-account error to Sentry instead of swallowing it (RAD-519)', async () => {
    const em = createEm();
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })) });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'details failed' }),
      { tags: { accountId: 'acc-2', requisitionId: 'sess-1', stage: 'account-phase' } },
    );
  });

  /**
   * API-W6: 573 Axios 409s over six days, all reading "Request failed with status code 409" and
   * nothing else, because both the log line and the Sentry event dropped `error.response.data`.
   * A status code on its own cannot be triaged.
   */
  describe('provider response capture (API-W6)', () => {
    const gocardless409 = { detail: 'Requisition already has accounts linked.', status_code: 409, summary: 'Conflict' };

    const runWith = (failWith: Error) =>
      service.syncAccountsForRequisition(
        { enableBankingConnectionKey: 1 },
        { em: asEm(createEm()), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1'], fail: 'acc-1', failWith })) },
      );

    it("attaches the provider's explanation to the Sentry event instead of only the status code", async () => {
      await runWith(axiosLikeError(409, gocardless409));

      expect(sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Request failed with status code 409' }),
        expect.objectContaining({
          extra: { providerResponse: { body: JSON.stringify(gocardless409), status: 409 } },
          tags: { accountId: 'acc-1', requisitionId: 'sess-1', stage: 'account-phase' },
        }),
      );
    });

    it('puts the same explanation in the log line', async () => {
      const warn = vi.fn();
      await service.syncAccountsForRequisition(
        { enableBankingConnectionKey: 1 },
        { em: asEm(createEm()), enableBankingSyncAdapterFactory: () => Promise.resolve(client({ accounts: ['acc-1'], fail: 'acc-1', failWith: axiosLikeError(409, gocardless409) })), logger: { error: vi.fn(), info: vi.fn(), warn } },
      );

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ providerResponse: { body: JSON.stringify(gocardless409), status: 409 } }) }),
        'Account initial sync account fetch failed',
      );
    });

    it('redacts sensitive fields before anything leaves for Sentry', async () => {
      await runWith(axiosLikeError(409, { detail: 'nope', iban: 'PT50000201231234567890154', owner: { email: 'a@b.pt' }, summary: 'Conflict' }));

      const body = sentry.captureException.mock.calls.at(-1)?.[1]?.extra?.providerResponse?.body as string;
      expect(body).toContain('Conflict');
      expect(body).not.toContain('PT50000201231234567890154');
      expect(body).not.toContain('a@b.pt');
    });

    it('caps an oversized body so an HTML error page cannot flood the event', async () => {
      await runWith(axiosLikeError(502, { detail: 'x'.repeat(9000) }));

      const body = sentry.captureException.mock.calls.at(-1)?.[1]?.extra?.providerResponse?.body as string;
      expect(body.length).toBeLessThan(2100);
      expect(body.endsWith('…[truncated]')).toBe(true);
    });

    it('adds no extra scaffolding for an error that carries no provider response', async () => {
      await runWith(new Error('details failed'));

      expect(sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'details failed' }), {
        tags: { accountId: 'acc-1', requisitionId: 'sess-1', stage: 'account-phase' },
      });
    });
  });

  it('reports the requisition-level institution id even when every account fails (RAD-519)', async () => {
    const em = createEm();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({
        getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '10' } }] }),
        getDetails: () => Promise.reject(new Error('details failed')),
        getMetadata: () => Promise.resolve({ iban: 'DE123', institution_id: 'bank-1' }),
      }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: ['acc-1'], institution_id: 'bank-1' }) },
    });
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory });
    expect(result.status).toBe('failed');
    expect(result.institutionIds).toEqual(['bank-1']);
  });

  it('reports the requisition-level institution id when the requisition has no accounts (RAD-519)', async () => {
    const em = createEm();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({ getBalances: () => Promise.resolve({ balances: [] }), getDetails: () => Promise.resolve({}), getMetadata: () => Promise.resolve({ institution_id: 'bank-1' }) }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [], institution_id: 'bank-1' }) },
    });
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory });
    expect(result.status).toBe('failed');
    expect(result.institutionIds).toEqual(['bank-1']);
  });

  it('reports zero accounts from a linked requisition to Sentry instead of failing silently (RAD-519)', async () => {
    const em = createEm();
    const warn = vi.fn();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({ getBalances: () => Promise.resolve({ balances: [] }), getDetails: () => Promise.resolve({}), getMetadata: () => Promise.resolve({ institution_id: 'bank-1' }) }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [], institution_id: 'bank-1', status: 'SU' }) },
    });
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory, logger: { error: vi.fn(), info: vi.fn(), warn } });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: 'bank-1', providerStatus: 'SU', requisitionId: 'sess-1' }),
      'Account initial sync: provider returned zero accounts for a linked requisition',
    );
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'Account initial sync: provider returned zero accounts for a linked requisition',
      expect.objectContaining({ tags: { requisitionId: 'sess-1', stage: 'account-phase' } }),
    );
  });
});

/**
 * RAD-631: sandbox GoCardless bank-link duplicated the account and every synced transaction.
 * Root cause — GoCardless issues a fresh external accountId per requisition/session even for what
 * is really the same real-world bank account, so a duplicate consent flow for the same institution
 * (double-click on "Connect", a stale redirect retried, a second requisition triggered while the
 * first was still in flight) is a fully valid, independently-linked EnableBankingConnection whose
 * accountId-keyed account lookup never matches the first — creating a second Account row, which
 * then ran its own full transaction sync and duplicated every transaction too.
 *
 * These tests exercise `syncAccountsForRequisition` twice against a shared, stateful fake `em` —
 * once per simulated requisition/session — to prove the second call collapses onto the account the
 * first call created (via the IBAN+institution+owner fallback lookup) instead of creating a second
 * one.
 */
describe('RAD-631: duplicate-requisition account dedup', () => {
  function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, val] of Object.entries(where)) {
      if (key === 'deletedAt') {
        const isDeletedQuery = Boolean(val) && typeof val === 'object' && '$ne' in val!;
        if (isDeletedQuery ? row['deletedAt'] == null : row['deletedAt'] != null) return false;
        continue;
      }
      if (row[key] !== val) return false;
    }
    return true;
  }

  /**
   * A minimal, stateful fake `em` that behaves like a real find-then-persist database for exactly
   * the entities this service touches, so `syncAccountsForRequisition` can be called twice in a row
   * — once per simulated requisition/session — and the second call sees what the first one wrote.
   * `connectionsByKey` and `tenantRecord` are fixed fixtures; `Account` / `AccountFinancialInstitution`
   * rows are tracked in-memory across calls.
   */
  function createStatefulEm(connectionsByKey: Record<number, Connection>, tenantRecord: Tenant) {
    const accounts: Record<string, unknown>[] = [];
    const institutions: Record<string, unknown>[] = [];
    let nextAccountKey = 1;

    const em = {
      create: vi.fn((entityClass: unknown, data: unknown) => ({ ...(data as object), __entity: (entityClass as { name: string }).name })),
      findOne: vi.fn((entityClass: unknown, where: Record<string, unknown>) => {
        const name = (entityClass as { name: string }).name;
        if (name === 'EnableBankingConnection') return Promise.resolve(connectionsByKey[where['enableBankingConnectionKey'] as number] ?? null);
        if (name === 'AppuserTenant') return Promise.resolve(tenantRecord);
        if (name === 'Currency') return Promise.resolve({ code: 'EUR' });
        if (name === 'AccountFinancialInstitution') return Promise.resolve(institutions.find((row) => row['id'] === where['id']) ?? null);
        if (name === 'Account') return Promise.resolve(accounts.find((row) => matchesWhere(row, where)) ?? null);
        return Promise.resolve(null);
      }),
      findOneOrFail: vi.fn(async (entityClass: unknown, where: Record<string, unknown>) => {
        const found = await em.findOne(entityClass, where);
        if (!found) throw new Error('not found in fake em');
        return found;
      }),
      persist: vi.fn((entity: Record<string, unknown>) => ({
        flush: vi.fn(() => {
          if (entity['__entity'] === 'AccountFinancialInstitution' && !institutions.includes(entity)) institutions.push(entity);
          if (entity['__entity'] === 'Account' && !accounts.includes(entity)) { entity['accountKey'] = nextAccountKey++; accounts.push(entity); }
          return Promise.resolve(undefined);
        }),
      })),
    };
    return { accounts, em, institutions };
  }

  const sandboxClient = (accountId: string) => ({
    account: () => ({
      getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '3826.00' }, balanceType: 'closingBooked' }] }),
      getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: 'Main Account · Sandbox Finance', ownerName: 'Sandbox Owner' } }),
      getMetadata: () => Promise.resolve({ iban: 'GB00SANDBOXFINANCE00000000', institution_id: 'SANDBOXFINANCE_SFIN0000' }),
    }),
    requisition: { getRequisitionById: () => Promise.resolve({ accounts: [accountId], institution_id: 'SANDBOXFINANCE_SFIN0000' }) },
  });

  it('collapses a second, independently-linked connection onto the account the first created (matched by IBAN)', async () => {
    const owner = { appuserKey: 9 };
    const tenantRecord: Tenant = { appuserKey: owner, tenantKey: { tenantKey: 3 } };
    const connectionsByKey: Record<number, Connection> = {
      1: { appuserKey: owner, enableBankingConnectionKey: 1, sessionId: 'sess-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED },
      2: { appuserKey: owner, enableBankingConnectionKey: 2, sessionId: 'sess-2', state: 'state-2', status: EnableBankingConnectionStatus.LINKED },
    };
    const { accounts, em } = createStatefulEm(connectionsByKey, tenantRecord);

    // Session 1: the user completes the sandbox consent flow once — creates exactly one account.
    const first = await service.syncAccountsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(sandboxClient('sandbox-acc-session-1')) },
    );
    expect(first).toMatchObject({ accountsCreated: 1, accountsFailed: 0 });
    expect(accounts).toHaveLength(1);

    // Session 2: a duplicate consent flow for the same institution/user (double-click "Connect", a
    // stale redirect retried, a second requisition started while the first was still in flight).
    // GoCardless issues a brand-new external accountId, but the sandbox's canned test data carries
    // the identical IBAN. Before RAD-631 this created a second Account row and re-ran the full
    // transaction sync against it. It must now collapse onto the existing account instead.
    const second = await service.syncAccountsForRequisition(
      { enableBankingConnectionKey: 2 },
      { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(sandboxClient('sandbox-acc-session-2')) },
    );
    expect(second).toMatchObject({ accountsCreated: 0, accountsFailed: 0, accountsUpdated: 1 });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ accountId: 'sandbox-acc-session-2', accountNumber: 'GB00SANDBOXFINANCE00000000' });
  });

  it('still creates a separate account when the provider supplies no IBAN (no false merge)', async () => {
    const owner = { appuserKey: 9 };
    const tenantRecord: Tenant = { appuserKey: owner, tenantKey: { tenantKey: 3 } };
    const connectionsByKey: Record<number, Connection> = {
      1: { appuserKey: owner, enableBankingConnectionKey: 1, sessionId: 'sess-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED },
      2: { appuserKey: owner, enableBankingConnectionKey: 2, sessionId: 'sess-2', state: 'state-2', status: EnableBankingConnectionStatus.LINKED },
    };
    const { accounts, em } = createStatefulEm(connectionsByKey, tenantRecord);
    const noIbanClient = (accountId: string) => ({
      account: () => ({
        getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '10.00' }, balanceType: 'closingBooked' }] }),
        getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: 'Checking', ownerName: 'Real Owner' } }),
        getMetadata: () => Promise.resolve({ institution_id: 'REAL_BANK' }),
      }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [accountId], institution_id: 'REAL_BANK' }) },
    });

    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(noIbanClient('real-acc-1')) });
    const second = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 2 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(noIbanClient('real-acc-2')) });

    expect(second).toMatchObject({ accountsCreated: 1 });
    expect(accounts).toHaveLength(2);
  });
});

// Phase 1d: the Enable Banking path through the same widened `syncAccountsForRequisition`.
// `enableBankingSyncAdapterFactory` stands in for `createEnableBankingSyncAdapter` so these tests
// never touch real Enable Banking credentials/HTTP — only the client-construction seam differs
// from the GoCardless tests above; the reconciliation/institution/balance logic they exercise is
// identical code.
describe('account initial sync account service — Enable Banking', () => {
  const linkedConnection = () => ({ appuserKey: { appuserKey: 9 }, aspspCountry: 'PT', aspspName: 'Test Bank', enableBankingConnectionKey: 5, sessionId: 'session-1', status: 'linked' });

  const enableBankingClient = (opts: { accounts?: string[]; institutionId?: string } = {}) => ({
    account: () => ({
      getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '42.00' }, balanceType: 'closingBooked' }] }),
      getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: 'EB Checking', ownerName: 'EB Owner' } }),
      getMetadata: () => Promise.resolve({ iban: 'PT50000000000000000000000', institution_id: opts.institutionId ?? 'enable_banking:pt:test-bank' }),
    }),
    requisition: { getRequisitionById: () => Promise.resolve({ accounts: opts.accounts ?? ['eb-acc-1'], institution_id: opts.institutionId ?? 'enable_banking:pt:test-bank' }) },
  });

  const createEbEm = (overrides: Partial<{ connection: null | ReturnType<typeof linkedConnection>; existingAccount: unknown; institution: unknown; tenant: null | Tenant }> = {}) => ({
    create: vi.fn((_entity: unknown, data: unknown) => data),
    findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'EnableBankingConnection') return Object.hasOwn(overrides, 'connection') ? overrides.connection : linkedConnection();
      if (name === 'AppuserTenant') return Object.hasOwn(overrides, 'tenant') ? overrides.tenant : tenant();
      if (name === 'Currency') return currency();
      if (name === 'AccountFinancialInstitution') return Object.hasOwn(overrides, 'institution') ? overrides.institution : null;
      if (name === 'Account') return Object.hasOwn(where, 'deletedAt') && where['deletedAt'] !== undefined ? null : (Object.hasOwn(overrides, 'existingAccount') ? overrides.existingAccount : null);
      return null;
    }),
    findOneOrFail: vi.fn(() => (Object.hasOwn(overrides, 'institution') ? overrides.institution : { id: 'enable_banking:pt:test-bank' })),
    flush: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockReturnThis(),
  });

  it('fails when the connection is missing', async () => {
    const em = createEbEm({ connection: null });
    await expect(service.syncAccountsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(enableBankingClient()) })).rejects.toThrow('Enable Banking connection not found');
  });

  it('fails when the connection is not linked', async () => {
    const em = createEbEm({ connection: { ...linkedConnection(), status: 'created' } });
    await expect(service.syncAccountsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(enableBankingClient()) })).rejects.toThrow('Enable Banking connection is not linked');
  });

  it('creates an account via the injected Enable Banking adapter, tagging the institution provider', async () => {
    const em = createEbEm();
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(enableBankingClient()) });

    expect(result).toMatchObject({ accountsCreated: 1, accountsFailed: 0, requisitionId: 'session-1', requisitionKey: 5, status: 'completed' });
    const createdInstitution = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([entity]) => (entity as { name?: string }).name === 'AccountFinancialInstitution')?.[1];
    expect(createdInstitution?.['provider']).toBe('enable_banking');
  });

  it('sets Account.enableBankingConnectionKey (not nordigenRequisitionKey) on the persisted account', async () => {
    // Pre-existing institution so the only `em.persist` call is the account itself.
    const em = createEbEm({ institution: { accountFinancialInstitutionKey: 1 } });
    await service.syncAccountsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(enableBankingClient()) });
    const persisted = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted['enableBankingConnectionKey']).toMatchObject({ enableBankingConnectionKey: 5 });
    expect(persisted['nordigenRequisitionKey']).toBeUndefined();
  });

  it('falls back to the pre-link state as requisitionId when no sessionId exists yet (defensive)', async () => {
    const em = createEbEm({ connection: { ...linkedConnection(), sessionId: undefined, state: 'pre-link-state' } as unknown as ReturnType<typeof linkedConnection> });
    const result = await service.syncAccountsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: () => Promise.resolve(enableBankingClient()) });
    expect(result.requisitionId).toBe('pre-link-state');
  });
});
