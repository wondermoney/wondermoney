import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { heartbeatJob } = vi.hoisted(() => ({ heartbeatJob: vi.fn().mockResolvedValue(true) }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException, captureMessage: sentry.captureMessage }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { heartbeatJob } }));

import { BankConnectionStatus } from '@entity/BankConnection';
import { connectionRef as conn, providerFromClient } from '@service/bank-providers/__tests__/helpers';

import service, { selectProviderBalanceAmount } from '../account-initial-sync-account.service';

type Em = NonNullable<SyncDeps['em']>;
type SyncDeps = NonNullable<Parameters<typeof service.syncAccountsForRequisition>[1]>;
// The tests drive a hand-rolled fake `em` whose methods are `vi.fn()`s; expose it through the
// service's structural `em` type at the boundary.
const asEm = (emMock: object): Em => emMock as Em;

// `account.balance` is the anchor the whole running-balance chain is rebuilt from, so which
// of the provider's balance types it comes from has to be deterministic. Taking whichever entry came
// first would let it flip between a booked balance and one including pending authorisations,
// shifting every row on the account with no transaction to explain it.
describe('provider balance selection', () => {
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

  it('falls back to the first usable entry for an unknown balance type, and to nothing for none', () => {
    expect(selectProviderBalanceAmount({ balances: [{ balanceAmount: { amount: '4.00' }, balanceType: 'somethingNew' }] })).toBe('4.00');
    expect(selectProviderBalanceAmount({ balances: [] })).toBeUndefined();
    expect(selectProviderBalanceAmount({})).toBeUndefined();
  });
});

interface Client {
  account: (accountId: string) => {
    getBalances: () => Promise<{ balances: { balanceAmount: { amount: string } }[] }>;
    getDetails: () => Promise<{ account?: { cashAccountType?: string; currency: string; name: string; ownerName: string } }>;
    getMetadata: () => Promise<{ iban?: string; institution_id: string }>;
  };
  requisition: { getRequisitionById: (id: string) => Promise<{ accounts: string[]; institution_id?: string }> };
}

interface Currency { code: string }

interface Tenant { appuserKey: { appuserKey: number; currencyKey?: Currency }; tenantKey: { tenantKey: number } }

const tenant = (): Tenant => ({ appuserKey: { appuserKey: 9 }, tenantKey: { tenantKey: 3 } });
const currency = (): Currency => ({ code: 'EUR' });

const client = (opts: { accounts?: string[]; balance?: string; cashAccountType?: string; fail?: string; failWith?: Error } = {}): Client => ({
  account: (accountId: string) => ({
    getBalances: () => opts.fail === accountId ? Promise.reject(opts.failWith ?? new Error('balances failed')) : Promise.resolve({ balances: [{ balanceAmount: { amount: opts.balance ?? '10' } }] }),
    getDetails: () => Promise.resolve({ account: { cashAccountType: opts.cashAccountType, currency: 'EUR', name: `Name ${accountId}`, ownerName: 'Owner' } }),
    getMetadata: () => Promise.resolve({ iban: 'DE123', institution_id: 'bank-1' }),
  }),
  requisition: { getRequisitionById: () => Promise.resolve({ accounts: opts.accounts ?? ['acc-1'] }) },
});

/** An Axios-shaped rejection: the message carries only the status, the reason lives on `response`. */
const axiosLikeError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, name: 'AxiosError', response: { data, status } });

const createEm = (overrides: Partial<{ accountType: unknown; currency: Currency | null; deletedAccount: unknown; exchangeRate: unknown; existingAccount: unknown; institution: unknown; tenant: null | Tenant }> = {}) => ({
  create: vi.fn((_entity: unknown, data: unknown) => data),
  findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
    const name = (entity as { name?: string }).name;
    if (name === 'AppuserTenant') return Object.hasOwn(overrides, 'tenant') ? overrides.tenant : tenant();
    if (name === 'Currency') return Object.hasOwn(overrides, 'currency') ? overrides.currency : currency();
    if (name === 'ExchangeRate') return Object.hasOwn(overrides, 'exchangeRate') ? overrides.exchangeRate : null;
    if (name === 'AccountFinancialInstitution') return Object.hasOwn(overrides, 'institution') ? overrides.institution : null;
    if (name === 'AccountType') return Object.hasOwn(overrides, 'accountType') ? overrides.accountType : null;
    if (name === 'Account') return Object.hasOwn(where, 'deletedAt') ? (Object.hasOwn(overrides, 'deletedAccount') ? overrides.deletedAccount : null) : (Object.hasOwn(overrides, 'existingAccount') ? overrides.existingAccount : null);
    return null;
  }),
  findOneOrFail: vi.fn(() => (Object.hasOwn(overrides, 'institution') ? overrides.institution : { id: 'bank-1' })),
  flush: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockReturnThis(),
});


/** An em whose active-account lookup finds `account`, as a re-sync of a linked account does. */
const emWithActiveAccount = (account: Record<string, unknown>) => {
  const em = createEm({ institution: { accountFinancialInstitutionKey: 1 } });
  const findOne = em.findOne.getMockImplementation()!;
  em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
    if ((entity as { name?: string }).name !== 'Account') return findOne(entity, where);
    return (where['deletedAt'] as undefined | { $ne?: unknown })?.$ne === null ? null : account;
  });
  return em;
};

beforeEach(() => vi.clearAllMocks());

describe('account initial sync account service', () => {
  it('fails when the connection is not linked', async () => {
    const em = createEm();
    await expect(service.syncAccountsForRequisition({ connection: conn(1, { status: BankConnectionStatus.CREATED }) }, { em: asEm(em), provider: providerFromClient(client()) })).rejects.toThrow('Bank connection is not linked');
  });

  it('fails when no provider is configured', async () => {
    const em = createEm();
    await expect(service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em) })).rejects.toThrow('Bank sync provider is not configured');
  });

  it('fails when tenant is missing', async () => {
    const em = createEm({ tenant: null });
    await expect(service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) })).rejects.toThrow('Active tenant not found for requisition');
  });

  it('creates institution and account on happy path', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(1), correlationId: 'c1', queueJobId: 'j1' }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(result).toMatchObject({ accountsCreated: 1, accountsFailed: 0, accountsFetched: 1, status: 'completed' });
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), { appuserKey: 9, deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
  });

  it('sets appuserCurrencyBalance to balance for same currency', async () => {
    const em = createEm({ tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } } });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['appuserCurrencyBalance']).toBe(10);
    expect(created?.['fxStatus']).toBe('exact');
  });

  it('stores no converted balance, and marks it missing, when no rate exists', async () => {
    const em = createEm({ exchangeRate: null, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD' } }, tenantKey: { tenantKey: 3 } } });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['appuserCurrencyBalance']).toBeNull();
    expect(created?.['fxStatus']).toBe('missing');
  });

  it('types an account the provider reports as a card', async () => {
    const creditCardType = { description: 'CREDIT_CARD' };
    const em = createEm({ accountType: creditCardType });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ cashAccountType: 'CARD' })) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['accountTypeKey']).toBe(creditCardType);
  });

  it('leaves the account type alone when the provider reports no card', async () => {
    const em = createEm({ accountType: { description: 'CREDIT_CARD' } });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ cashAccountType: 'CACC' })) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['accountTypeKey']).toBeUndefined();
  });

  it('returns partial when one account fails', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })) });
    expect(result.status).toBe('partial');
    expect(result.failedAccountIds).toEqual(['acc-2']);
  });

  describe('provider failure signals', () => {
    const providerError = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`provider ${status}`), { status, ...extra });
    /** A client whose `getBalances` answers per account: an error to throw, or a balances list. */
    const balancesClient = (accounts: string[], answers: Record<string, Error | { balances: { balanceAmount?: { amount: string } }[] }>) => {
      const balanceCalls: string[] = [];
      const fake: Client = {
        account: (accountId: string) => ({
          getBalances: () => {
            balanceCalls.push(accountId);
            const answer = answers[accountId] ?? { balances: [{ balanceAmount: { amount: '10' } }] };
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as { balances: { balanceAmount: { amount: string } }[] });
          },
          getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: accountId, ownerName: 'Owner' } }),
          getMetadata: () => Promise.resolve({ institution_id: 'bank-1' }),
        }),
        requisition: { getRequisitionById: () => Promise.resolve({ accounts }) },
      };
      return { balanceCalls, fake };
    };

    it('stops calling the provider at the first rate limit and reports Retry-After', async () => {
      const { balanceCalls, fake } = balancesClient(['acc-1', 'acc-2', 'acc-3'], { 'acc-1': providerError(429, { retryAfter: 900 }) });
      const em = createEm();
      const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(fake) });
      expect(balanceCalls).toEqual(['acc-1']);
      expect(result).toMatchObject({ accountsFailed: 3, accountsFetched: 0, rateLimited: { retryAfterSeconds: 900 }, status: 'failed' });
      expect(em.persist).not.toHaveBeenCalled();
    });

    it('keeps accounts synced before the rate limit and reports a partial result', async () => {
      const { balanceCalls, fake } = balancesClient(['acc-1', 'acc-2', 'acc-3'], { 'acc-2': providerError(429) });
      const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(createEm()), provider: providerFromClient(fake) });
      expect(balanceCalls).toEqual(['acc-1', 'acc-2']);
      expect(result).toMatchObject({ accountsFailed: 2, accountsFetched: 1, failedAccountIds: ['acc-2', 'acc-3'], rateLimited: {}, status: 'partial' });
    });

    it('reports every account rejected when each one fails with 400 or 401', async () => {
      const { fake } = balancesClient(['acc-1', 'acc-2'], { 'acc-1': providerError(400), 'acc-2': providerError(401) });
      const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(createEm()), provider: providerFromClient(fake) });
      expect(result).toMatchObject({ everyAccountRejected: true, status: 'failed' });
    });

    it('does not report every account rejected when one failed for another reason', async () => {
      const { fake } = balancesClient(['acc-1', 'acc-2'], { 'acc-1': providerError(400), 'acc-2': providerError(502) });
      const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(createEm()), provider: providerFromClient(fake) });
      expect(result.status).toBe('failed');
      expect(result.everyAccountRejected).toBeFalsy();
    });

    it('fails an account whose provider answered with no balances, leaving its balance and freshness alone', async () => {
      const existingAccount = { accountId: 'acc-1', accountKey: 9, balance: 250, refreshedAt: new Date('2026-01-01T00:00:00Z') };
      const { fake } = balancesClient(['acc-1'], { 'acc-1': { balances: [] } });
      // Served from the first `Account` lookup, so the sync would update it if it got that far.
      const em = createEm({ deletedAccount: existingAccount });
      const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(fake) });
      expect(result).toMatchObject({ accountsFailed: 1, status: 'failed' });
      expect(existingAccount.balance).toBe(250);
      expect(existingAccount.refreshedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    });
  });

  it('marks non-duplicate institution create errors as failed', async () => {
    const em = createEm({ institution: null });
    em.flush.mockRejectedValueOnce(new Error('boom'));
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('marks non-duplicate account create errors as failed', async () => {
    const em = createEm({ institution: null });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('handles duplicate institution create by reloading', async () => {
    const em = createEm({ institution: null });
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(result.accountsFailed).toBe(0);
  });

  it('handles duplicate account create by reloading', async () => {
    const em = createEm({ existingAccount: { accountKey: 9 }, institution: { accountFinancialInstitutionKey: 1 } });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(result.accountsFailed).toBe(0);
  });

  it('copies appuserCurrencyBalance into duplicate fallback reloads', async () => {
    const reloaded = { accountKey: 9, appuserCurrencyBalance: undefined };
    const em = createEm({ currency: { code: 'EUR' }, institution: { accountFinancialInstitutionKey: 1 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } } });
    let reloadCount = 0;
    em.findOne.mockImplementation((entity: unknown) => {
      const name = (entity as { name?: string }).name;
      if (name === 'AppuserTenant') return { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR' } }, tenantKey: { tenantKey: 3 } };
      if (name === 'Currency') return { code: 'EUR' };
      if (name === 'AccountFinancialInstitution') return { accountFinancialInstitutionKey: 1 };
      if (name === 'Account') return reloadCount++ < 2 ? null : reloaded;
      return null;
    });
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockResolvedValue(undefined);
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    const createdAccount = em.persist.mock.calls[0]?.[0] as undefined | { appuserCurrencyBalance?: number };
    expect(createdAccount?.appuserCurrencyBalance).toBe(10);
  });

  it('records the first provider balance it sees as the opening balance', async () => {
    const em = createEm();
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ balance: '250.5' })) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['accountId'] === 'acc-1')?.[1];
    expect(created?.['openingBalance']).toBe(250.5);
    expect(created?.['openingBalanceDate']).toBeInstanceOf(Date);
  });

  it('records an opening balance for an account linked without a balance', async () => {
    const existingAccount: Record<string, unknown> = { accountId: 'acc-1', accountKey: 9 };
    const em = emWithActiveAccount(existingAccount);
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ balance: '40' })) });
    expect(existingAccount['openingBalance']).toBe(40);
  });

  it('keeps the opening balance when a later sync reports a new balance', async () => {
    const openingBalanceDate = new Date('2026-01-01T00:00:00Z');
    const existingAccount: Record<string, unknown> = { accountId: 'acc-1', accountKey: 9, balance: 100, openingBalance: 100, openingBalanceDate };
    const em = emWithActiveAccount(existingAccount);
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ balance: '75' })) });
    expect(existingAccount).toMatchObject({ balance: 75, openingBalance: 100, openingBalanceDate });
  });

  it('leaves the opening balance of an account synced before opening balances existed to the backfill', async () => {
    const existingAccount: Record<string, unknown> = { accountId: 'acc-1', accountKey: 9, balance: 100 };
    const em = emWithActiveAccount(existingAccount);
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ balance: '75' })) });
    expect(existingAccount['openingBalance']).toBeUndefined();
  });

  it('preserves existing account fields when syncing existing accounts', async () => {
    const existingAccount = { accountId: 'acc-1', accountKey: 9, accountName: 'User Override', accountNumber: '123', holderName: 'Existing Holder' };
    const em = createEm({ existingAccount, institution: { accountFinancialInstitutionKey: 1 } });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client()) });
    expect(existingAccount.accountName).toBe('User Override');
    expect(existingAccount.accountNumber).toBe('123');
    expect(existingAccount.holderName).toBe('Existing Holder');
  });

  it('marks invalid balance as failed', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ balance: '10abc' })) });
    expect(result.status).toBe('failed');
    expect(result.accountsFailed).toBe(1);
  });

  it('returns failed when requisition has no accounts', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ accounts: [] })) });
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
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(await bankSyncFactory()) });
    expect(result.status).toBe('completed');
    expect(callOrder).toEqual(expect.arrayContaining(['balances:acc-1', 'balances:acc-2']));
  });

  it('marks all fetch failures as failed', async () => {
    const em = createEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ accounts: ['acc-1'], fail: 'acc-1' })) });
    expect(result.status).toBe('failed');
    expect(result.accountsFetched).toBe(0);
  });

  it('logs the real per-account error instead of swallowing it', async () => {
    const em = createEm();
    const warn = vi.fn();
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), logger: { error: vi.fn(), info: vi.fn(), warn }, provider: providerFromClient(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })) });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-2', error: expect.objectContaining({ message: 'balances failed' }), requisitionId: 'sess-1' }),
      'Account initial sync account fetch failed',
    );
  });

  it('reports the real per-account error to Sentry instead of swallowing it', async () => {
    const em = createEm();
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(client({ accounts: ['acc-1', 'acc-2'], fail: 'acc-2' })) });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'balances failed' }),
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
        { connection: conn(1) },
        { em: asEm(createEm()), provider: providerFromClient(client({ accounts: ['acc-1'], fail: 'acc-1', failWith })) },
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
        { connection: conn(1) },
        { em: asEm(createEm()), logger: { error: vi.fn(), info: vi.fn(), warn }, provider: providerFromClient(client({ accounts: ['acc-1'], fail: 'acc-1', failWith: axiosLikeError(409, gocardless409) })) },
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
      await runWith(new Error('balances failed'));

      expect(sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'balances failed' }), {
        tags: { accountId: 'acc-1', requisitionId: 'sess-1', stage: 'account-phase' },
      });
    });
  });

  it('reports the requisition-level institution id even when every account fails', async () => {
    const em = createEm();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({
        getBalances: () => Promise.reject(new Error('balances failed')),
        getDetails: () => Promise.resolve({}),
        getMetadata: () => Promise.resolve({ iban: 'DE123', institution_id: 'bank-1' }),
      }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: ['acc-1'], institution_id: 'bank-1' }) },
    });
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(await bankSyncFactory()) });
    expect(result.status).toBe('failed');
    expect(result.institutionIds).toEqual(['bank-1']);
  });

  it('reports the requisition-level institution id when the requisition has no accounts', async () => {
    const em = createEm();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({ getBalances: () => Promise.resolve({ balances: [] }), getDetails: () => Promise.resolve({}), getMetadata: () => Promise.resolve({ institution_id: 'bank-1' }) }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [], institution_id: 'bank-1' }) },
    });
    const result = await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(await bankSyncFactory()) });
    expect(result.status).toBe('failed');
    expect(result.institutionIds).toEqual(['bank-1']);
  });

  it('reports zero accounts from a linked requisition to Sentry instead of failing silently', async () => {
    const em = createEm();
    const warn = vi.fn();
    const bankSyncFactory = () => Promise.resolve<Client>({
      account: () => ({ getBalances: () => Promise.resolve({ balances: [] }), getDetails: () => Promise.resolve({}), getMetadata: () => Promise.resolve({ institution_id: 'bank-1' }) }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [], institution_id: 'bank-1', status: 'SU' }) },
    });
    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), logger: { error: vi.fn(), info: vi.fn(), warn }, provider: providerFromClient(await bankSyncFactory()) });
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
 * A provider can issue a fresh external accountId per requisition/session even for what is really
 * the same real-world bank account, so a duplicate consent flow for the same institution
 * (double-click on "Connect", a stale redirect retried, a second requisition triggered while the
 * first was still in flight) is a fully valid, independently-linked EnableBankingConnection whose
 * accountId-keyed account lookup never matches the first. Without a fallback that creates a
 * second Account row, which then runs its own full transaction sync and duplicates every
 * transaction too.
 *
 * These tests exercise `syncAccountsForRequisition` twice against a shared, stateful fake `em` —
 * once per simulated requisition/session — to prove the second call collapses onto the account the
 * first call created (via the IBAN+institution+owner fallback lookup) instead of creating a second
 * one.
 */
describe('duplicate-requisition account dedup', () => {
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
  function createStatefulEm(tenantRecord: Tenant) {
    const accounts: Record<string, unknown>[] = [];
    const institutions: Record<string, unknown>[] = [];
    let nextAccountKey = 1;

    const em = {
      create: vi.fn((entityClass: unknown, data: unknown) => ({ ...(data as object), __entity: (entityClass as { name: string }).name })),
      findOne: vi.fn((entityClass: unknown, where: Record<string, unknown>) => {
        const name = (entityClass as { name: string }).name;
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
    const { accounts, em } = createStatefulEm(tenantRecord);

    // Session 1: the user completes the sandbox consent flow once — creates exactly one account.
    const first = await service.syncAccountsForRequisition(
      { connection: conn(1) },
      { em: asEm(em), provider: providerFromClient(sandboxClient('sandbox-acc-session-1')) },
    );
    expect(first).toMatchObject({ accountsCreated: 1, accountsFailed: 0 });
    expect(accounts).toHaveLength(1);

    // Session 2: a duplicate consent flow for the same institution/user (double-click "Connect", a
    // stale redirect retried, a second requisition started while the first was still in flight).
    // The provider issues a brand-new external accountId, but the account carries the identical
    // IBAN. It must collapse onto the existing account instead of creating a second Account row and
    // re-running the full transaction sync against it.
    const second = await service.syncAccountsForRequisition(
      { connection: conn(2) },
      { em: asEm(em), provider: providerFromClient(sandboxClient('sandbox-acc-session-2')) },
    );
    expect(second).toMatchObject({ accountsCreated: 0, accountsFailed: 0, accountsUpdated: 1 });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ accountId: 'sandbox-acc-session-2', accountNumber: 'GB00SANDBOXFINANCE00000000' });
  });

  it('still creates a separate account when the provider supplies no IBAN (no false merge)', async () => {
    const owner = { appuserKey: 9 };
    const tenantRecord: Tenant = { appuserKey: owner, tenantKey: { tenantKey: 3 } };
    const { accounts, em } = createStatefulEm(tenantRecord);
    const noIbanClient = (accountId: string) => ({
      account: () => ({
        getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '10.00' }, balanceType: 'closingBooked' }] }),
        getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: 'Checking', ownerName: 'Real Owner' } }),
        getMetadata: () => Promise.resolve({ institution_id: 'REAL_BANK' }),
      }),
      requisition: { getRequisitionById: () => Promise.resolve({ accounts: [accountId], institution_id: 'REAL_BANK' }) },
    });

    await service.syncAccountsForRequisition({ connection: conn(1) }, { em: asEm(em), provider: providerFromClient(noIbanClient('real-acc-1')) });
    const second = await service.syncAccountsForRequisition({ connection: conn(2) }, { em: asEm(em), provider: providerFromClient(noIbanClient('real-acc-2')) });

    expect(second).toMatchObject({ accountsCreated: 1 });
    expect(accounts).toHaveLength(2);
  });
});

// The Enable Banking path through the same `syncAccountsForRequisition`, with a fake provider
// built from an Enable-Banking-shaped client. The reconciliation/institution/balance logic is
// identical to the requisition tests above; only the provider differs.
describe('account initial sync account service — Enable Banking', () => {
  const enableBankingClient = (opts: { accounts?: string[]; institutionId?: string } = {}) => ({
    account: () => ({
      getBalances: () => Promise.resolve({ balances: [{ balanceAmount: { amount: '42.00' }, balanceType: 'closingBooked' }] }),
      getDetails: () => Promise.resolve({ account: { currency: 'EUR', name: 'EB Checking', ownerName: 'EB Owner' } }),
      getMetadata: () => Promise.resolve({ iban: 'PT50000000000000000000000', institution_id: opts.institutionId ?? 'enable_banking:pt:test-bank' }),
    }),
    requisition: { getRequisitionById: () => Promise.resolve({ accounts: opts.accounts ?? ['eb-acc-1'], institution_id: opts.institutionId ?? 'enable_banking:pt:test-bank' }) },
  });

  const createEbEm = (overrides: Partial<{ existingAccount: unknown; institution: unknown; tenant: null | Tenant }> = {}) => ({
    create: vi.fn((_entity: unknown, data: unknown) => data),
    findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
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

  it('fails when the connection is not linked', async () => {
    const em = createEbEm();
    await expect(service.syncAccountsForRequisition({ connection: conn(5, { status: BankConnectionStatus.CREATED }) }, { em: asEm(em), provider: providerFromClient(enableBankingClient()) })).rejects.toThrow('Bank connection is not linked');
  });

  it('creates an account via the injected Enable Banking adapter, tagging the institution provider', async () => {
    const em = createEbEm();
    const result = await service.syncAccountsForRequisition({ connection: conn(5, { externalId: 'session-1' }) }, { em: asEm(em), provider: providerFromClient(enableBankingClient()) });

    expect(result).toMatchObject({ accountsCreated: 1, accountsFailed: 0, requisitionId: 'session-1', requisitionKey: 5, status: 'completed' });
    const createdInstitution = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([entity]) => (entity as { name?: string }).name === 'AccountFinancialInstitution')?.[1];
    expect(createdInstitution?.['provider']).toBe('enable_banking');
  });

  it('sets Account.bankConnectionKey (not nordigenRequisitionKey) on the persisted account', async () => {
    // Pre-existing institution so the only `em.persist` call is the account itself.
    const em = createEbEm({ institution: { accountFinancialInstitutionKey: 1 } });
    await service.syncAccountsForRequisition({ connection: conn(5) }, { em: asEm(em), provider: providerFromClient(enableBankingClient()) });
    const persisted = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted['bankConnectionKey']).toBe(5);
    expect(persisted['nordigenRequisitionKey']).toBeUndefined();
  });
});
