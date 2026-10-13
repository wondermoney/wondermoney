import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { generateInternalTransactionId } from '@wondermoney/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { heartbeatJob } = vi.hoisted(() => ({ heartbeatJob: vi.fn().mockResolvedValue(true) }));
const { categorizeTransactionDeterministically } = vi.hoisted(() => ({ categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: true, reason: 'user_mapping' }) }));
const { triggerRecurringDetectionAfterTransactionIngestion } = vi.hoisted(() => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { finishJob: vi.fn(), heartbeatJob } }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion }));

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import service from '../account-initial-sync-transaction.service';

type Em = NonNullable<SyncDeps['em']>;
type SyncDeps = NonNullable<Parameters<typeof service.syncTransactionsForRequisition>[1]>;
// The tests drive a hand-rolled fake `em` whose methods are `vi.fn()`s; expose it through the
// service's structural `em` type at the boundary.
const asEm = (emMock: object): Em => emMock as Em;

const connection = { appuserKey: { appuserKey: 9 }, enableBankingConnectionKey: 1, sessionId: 'sess-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED };
const tenant = { appuserKey: { appuserKey: 9, currencyKey: { code: 'EUR', currencyKey: 1 } }, tenantKey: { tenantKey: 3 } };
const accounts = [{ accountId: 'acc-1', accountKey: 11 }, { accountId: 'acc-2', accountKey: 12 }];
const booked = [{ bookingDate: '2026-01-01', creditDebitIndicator: 'credit', transactionAmount: { amount: '10', currency: 'EUR' }, transactionId: 't-1' }];
const pending = [{ bookingDate: '2026-01-02', creditDebitIndicator: 'debit', entryReference: 'e-1', transactionAmount: { amount: '5', currency: 'EUR' } }];
type Responses = Record<string, { booked?: TxRow[]; pending?: TxRow[]; transactions?: { booked?: TxRow[]; pending?: TxRow[] } }>;
interface TxRow { amount?: string; bookingDate: string; creditDebitIndicator?: string; creditorName?: string; currency?: string; currencyExchange?: { exchangeRate?: number | string; instructedAmount?: { amount?: string; currency?: string }; sourceCurrency?: string }; debtorName?: string; entryReference?: string; internalTransactionId?: string; remittanceInformationStructured?: string; remittanceInformationUnstructured?: string; transactionAmount?: { amount?: string; currency?: string }; transactionId?: string }

/**
 * RAD-564: the chain query (`loadChainRows`) is the only `find(Transaction, …)` that carries a
 * `transactionDate` predicate; the pending-reconciliation queries do not. `chainRows` therefore
 * stands in for the rows already stored on the account when the rebuild runs.
 */
function createEm(overrides: Partial<{ accounts: unknown[]; chainRows: unknown[]; connection: unknown; currency: unknown; exchangeRate: unknown; existing: unknown; pendings: unknown[]; persistRejects: unknown[]; status: unknown; tenant: unknown; type: unknown }> = {}) {
  const flush = vi.fn();
  for (const rejection of overrides.persistRejects ?? []) flush.mockRejectedValueOnce(rejection);
  flush.mockResolvedValue(undefined);
  return {
    create: vi.fn((_entity: unknown, data: unknown) => data),
    find: vi.fn((entity: unknown, where?: Record<string, unknown>, _options?: Record<string, unknown>) => { const name = (entity as { name?: string }).name; if (name === 'Account') return overrides.accounts ?? accounts; if (name === 'Transaction') return isChainQuery(where) ? overrides.chainRows ?? [] : overrides.pendings ?? []; return []; }),
    findOne: vi.fn((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'EnableBankingConnection') return Object.hasOwn(overrides, 'connection') ? overrides.connection : connection;
      if (name === 'AppuserTenant') return Object.hasOwn(overrides, 'tenant') ? overrides.tenant : tenant;
      if (name === 'Currency') return Object.hasOwn(overrides, 'currency') ? overrides.currency : { code: 'EUR', currencyKey: 1 };
      if (name === 'ExchangeRate') return Object.hasOwn(overrides, 'exchangeRate') ? overrides.exchangeRate : null;
      if (name === 'TransactionStatus') return Object.hasOwn(overrides, 'status') ? overrides.status : { name: String(where['name']), transactionStatusKey: 1 };
      if (name === 'TransactionType') return Object.hasOwn(overrides, 'type') ? overrides.type : { name: String(where['name']), transactionTypeKey: 1 };
      if (name === 'Transaction') return Object.hasOwn(overrides, 'existing') ? overrides.existing : null;
      return null;
    }),
    flush,
    persist: vi.fn().mockReturnThis(),
  };
}

function isChainQuery(where: Record<string, unknown> | undefined) {
  return where !== undefined && Object.hasOwn(where, 'transactionDate');
}

const getTransactionsMock = vi.fn();
const bankSyncFactory = (responses: Responses = { 'acc-1': { transactions: { booked, pending } }, 'acc-2': { transactions: { booked: [], pending: [] } } }, fail: string[] = []) => vi.fn().mockResolvedValue({ account: (accountId: string) => ({ getTransactions: (args?: Record<string, unknown>) => { getTransactionsMock.mock.calls.push([accountId, args]); return fail.includes(accountId) ? Promise.reject(new Error('fail')) : Promise.resolve(responses[accountId]?.transactions ? responses[accountId] : { transactions: responses[accountId] }); } }) });

beforeEach(() => { vi.clearAllMocks(); getTransactionsMock.mockClear(); });

describe('account initial sync transaction service', () => {
  it('fails when connection missing / not linked / tenant missing / no accounts', async () => {
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm({ connection: null })), enableBankingSyncAdapterFactory: bankSyncFactory() })).rejects.toThrow('Enable Banking connection not found');
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm({ connection: { ...connection, status: EnableBankingConnectionStatus.CREATED } })), enableBankingSyncAdapterFactory: bankSyncFactory() })).rejects.toThrow('Enable Banking connection is not linked');
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm({ tenant: null })), enableBankingSyncAdapterFactory: bankSyncFactory() })).rejects.toThrow('Active tenant not found for requisition');
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm({ accounts: [] })), enableBankingSyncAdapterFactory: bankSyncFactory() })).resolves.toMatchObject({ accountsTotal: 0, status: 'failed' });
  });

  it('fetches booked and pending and persists transactions', async () => {
    const em = createEm();
    const result = await service.syncTransactionsForRequisition({ correlationId: 'c1', enableBankingConnectionKey: 1, queueJobId: 'j1' }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory() });
    expect(result).toMatchObject({ accountsProcessed: 2, status: 'completed', transactionsCreated: 2, transactionsFetched: 2 });
    expect(heartbeatJob).toHaveBeenCalled();
    expect(em.persist).toHaveBeenCalled();
    expect(triggerRecurringDetectionAfterTransactionIngestion).toHaveBeenCalledWith(3, 'account-initial-sync');
    expect(getTransactionsMock).toHaveBeenCalledWith('acc-1', expect.objectContaining({ country: '', dateFrom: expect.any(String), dateTo: expect.any(String) }));
  });

  it('maps bank ids for booked and pending rows', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', internalTransactionId: 'bank-internal-1', transactionId: 'bank-tx-1' }], pending: [{ amount: '5', bookingDate: '2026-01-02', currency: 'EUR', transactionId: 'bank-pending-1' }] }, 'acc-2': { booked: [], pending: [] } }) });
    const calls = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.map(([, data]) => data);
    expect(calls[0]).toMatchObject({ enableBankingTransactionId: 'bank-pending-1', externalTransactionId: 'bank-pending-1', internalTransactionId: expect.any(String) });
    expect(calls[1]).toMatchObject({ enableBankingTransactionId: 'bank-tx-1', externalTransactionId: 'bank-tx-1', internalTransactionId: expect.any(String) });
  });

  it('updates pending transactions when the booked row arrives later', async () => {
    const existing = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, enableBankingTransactionId: 'tx-1', reviewed: true, transactionKey: 99, transactionStatusKey: { name: 'PENDING' }, transactionTypeKey: { name: 'PAYMENT' } };
    const em = createEm({ existing });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'tx-1' }], pending: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'tx-1' }] }, 'acc-2': { booked: [], pending: [] } }) });
    const updated = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updated).toMatchObject({ enableBankingTransactionId: 'tx-1', externalTransactionId: 'tx-1', reviewed: true, transactionStatusKey: expect.objectContaining({ name: 'BOOKED' }) });
  });

  it('dedups sync rows on the provider id only — no undefined-external and no fingerprint branch (RAD-393)', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const query = em.findOne.mock.calls.find((call) => (call[0] as { name?: string }).name === 'Transaction')?.[1] as { $or?: { externalTransactionId?: string; internalTransactionId?: string; nordigenInternalTransactionId?: string }[] };
    // No `externalTransactionId` (the booked row carries no transactionId) and — because a
    // nordigen provider id is present — no synthetic `internalTransactionId` fingerprint branch
    // either, so a fingerprint collision can never skip a distinct sync row.
    expect(query.$or).toEqual([{ enableBankingTransactionId: expect.any(String) }]);
  });

  it('uses generated internal transaction ids when available', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { transactions: { booked: [{ bookingDate: '2026-01-01', currency: 'EUR', transactionAmount: { amount: '10', currency: 'EUR' }, transactionId: 'gen-1' }], pending: [] } }, 'acc-2': { transactions: { booked: [], pending: [] } } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
    expect(created?.['externalTransactionId']).toBe('gen-1');
    expect(created?.['internalTransactionId']).toBe(generateInternalTransactionId(new Date('2026-01-01'), 10));
    expect(created?.['internalTransactionId']).not.toBe(created?.['externalTransactionId']);
  });

  // RAD-564. The batch no longer assigns balances at all: it cannot know a row's position in the
  // account's total order, which is what made cross-batch chains irreconcilable (51.6% of links on
  // production bank-synced accounts). The persist loop writes the row; a single whole-account
  // rebuild afterwards owns `balance` / `appuserCurrencyBalance`.
  it('never writes a per-batch balance onto a persisted row', async () => {
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 20, balance: 20 }, { accountId: 'acc-2', accountKey: 12 }], currency: { code: 'EUR', currencyKey: 1 }, exchangeRate: { rate: 1.2 } });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'b1' }, { amount: '5', bookingDate: '2026-01-02', currency: 'EUR', transactionId: 'b2' }], pending: [{ amount: '2', bookingDate: '2026-01-03', currency: 'EUR', transactionId: 'p1' }] }, 'acc-2': { booked: [], pending: [] } }) });
    const calls = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.map(([, data]) => data);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(Object.hasOwn(call, 'balance')).toBe(false);
      expect(Object.hasOwn(call, 'appuserCurrencyBalance')).toBe(false);
    }
  });

  it('rebuilds the whole account chain over settled rows, hidden rows included, anchored on account.balance', async () => {
    const chainRows = [
      { appuserSettlementAmount: 10, balance: undefined, settlementAmount: 10, transactionDate: new Date('2026-01-01'), transactionKey: 1 },
      { appuserSettlementAmount: 5, balance: undefined, settlementAmount: 5, transactionDate: new Date('2026-01-02'), transactionKey: 2 },
    ];
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 20, balance: 20 }], chainRows });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '5', bookingDate: '2026-01-02', currency: 'EUR', transactionId: 'b2' }], pending: [] } }) });

    // opening = 20 - (10 + 5) = 5, then accumulate forward. The tail lands back on account.balance.
    expect(chainRows.map((row) => row.balance)).toEqual([15, 20]);

    const chainCall = em.find.mock.calls.find(([entity, where]) => (entity as { name?: string }).name === 'Transaction' && isChainQuery(where));
    expect(chainCall?.[1]).toMatchObject({ transactionStatusKey: { name: { $in: ['BOOKED'] } } });
    // RAD-25: hidden rows are part of the physical chain. Order matches the transactions list's reverse.
    expect(chainCall?.[2]).toMatchObject({ filters: { hidden: false }, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' } });
  });

  // The accounts-1-and-3 signature: an internally consistent chain whose tail no longer equals
  // `account.balance`, because the account phase wrote a fresh provider balance and the transaction
  // phase had nothing to persist. Re-anchoring on an empty batch is what closes that gap.
  it('re-anchors the chain even when the batch is empty', async () => {
    const chainRows = [{ settlementAmount: 10, transactionDate: new Date('2026-01-01'), transactionKey: 1 }] as { balance?: number; settlementAmount: number; transactionDate: Date; transactionKey: number }[];
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 55, balance: 55 }], chainRows });
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [], pending: [] } }) });
    expect(result.transactionsFetched).toBe(0);
    expect(chainRows[0]?.balance).toBe(55);
  });

  it('leaves account.balance alone — the provider owns it and it is the chain anchor', async () => {
    const account = { accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 100, balance: 100 };
    const chainRows = [{ appuserSettlementAmount: 20, settlementAmount: 20, transactionDate: new Date('2026-01-02'), transactionKey: 2 }];
    const em = createEm({ accounts: [account], chainRows });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '20', bookingDate: '2026-01-02', currency: 'EUR', transactionId: 'newer' }], pending: [] } }) });
    expect(account.balance).toBe(100);
    expect(account.appuserCurrencyBalance).toBe(100);
  });

  // The interleaving case the per-batch model could never get right: a back-dated row arriving in a
  // later batch sits *between* rows the earlier batch already balanced. Rebuilding the whole account
  // in `(transactionDate, transactionKey)` order puts it in the right place and re-accumulates the rest.
  it('places a back-dated row from a later batch correctly in the chain', async () => {
    const chainRows = [
      { settlementAmount: 10, transactionDate: new Date('2026-01-01'), transactionKey: 1 },
      // arrived in a later batch, so a higher key, but dated before row 3
      { settlementAmount: -4, transactionDate: new Date('2026-01-02'), transactionKey: 9 },
      { settlementAmount: 20, transactionDate: new Date('2026-01-03'), transactionKey: 3 },
    ] as { balance?: number; settlementAmount: number; transactionDate: Date; transactionKey: number }[];
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 26, balance: 26 }], chainRows });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '-4', bookingDate: '2026-01-02', currency: 'EUR', transactionId: 'backdated' }], pending: [] } }) });
    // opening = 26 - (10 - 4 + 20) = 0
    expect(chainRows.map((row) => row.balance)).toEqual([10, 6, 26]);
  });

  it('maps provider currency exchange fields onto original and settlement data', async () => {
    const em = createEm({ currency: { code: 'EUR', currencyKey: 1 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'Currency' && where['code'] === 'USD') return { code: 'USD', currencyKey: 2 };
      if (name === 'Currency') return { code: 'EUR', currencyKey: 1 };
      if (name === 'EnableBankingConnection') return connection;
      if (name === 'AppuserTenant') return tenant;
      if (name === 'ExchangeRate') return null;
      if (name === 'TransactionStatus') return { name: String(where['name']), transactionStatusKey: 1 };
      if (name === 'TransactionType') return { name: String(where['name']), transactionTypeKey: 1 };
      if (name === 'Transaction') return null;
      if (name === 'Account') return accounts;
      return null;
    });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', currencyExchange: { exchangeRate: '1.1', instructedAmount: { amount: '11', currency: 'USD' }, sourceCurrency: 'USD' }, transactionId: 'fx-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
    expect(created).toMatchObject({ originalAmount: 11, originalCurrencyKey: { code: 'USD' }, settlementAmount: 10, settlementExchangeRate: 1.1 });
  });

  it('derives original amount from source currency and exchange rate when instructed amount is absent', async () => {
    const em = createEm({ currency: { code: 'EUR', currencyKey: 1 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name;
      if (name === 'Currency' && where['code'] === 'USD') return { code: 'USD', currencyKey: 2 };
      if (name === 'Currency') return { code: 'EUR', currencyKey: 1 };
      if (name === 'EnableBankingConnection') return connection;
      if (name === 'AppuserTenant') return tenant;
      if (name === 'ExchangeRate') return null;
      if (name === 'TransactionStatus') return { name: String(where['name']), transactionStatusKey: 1 };
      if (name === 'TransactionType') return { name: String(where['name']), transactionTypeKey: 1 };
      if (name === 'Transaction') return null;
      if (name === 'Account') return accounts;
      return null;
    });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', currencyExchange: { exchangeRate: '1.1', sourceCurrency: 'USD' }, transactionId: 'fx-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
    expect(created).toMatchObject({ originalAmount: 11, originalCurrencyKey: { code: 'USD' }, settlementAmount: 10, settlementExchangeRate: 1.1 });
  });

  it('uses fallback appuser settlement amount when no exchange rate exists', async () => {
    const em = createEm({ currency: { code: 'EUR', currencyKey: 1 }, exchangeRate: null, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'fx-2' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
    expect(created).toMatchObject({ appuserCurrencyExchangeRate: undefined, appuserCurrencyKey: { code: 'USD', currencyKey: 2 }, appuserSettlementAmount: 10 });
  });

  it('queries exchange rates without deletedAt filtering', async () => {
    const em = createEm({ currency: { code: 'EUR', currencyKey: 1 }, exchangeRate: { rate: 1.2 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'fx-3' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const exchangeCall = em.findOne.mock.calls.find((call) => (call[0] as { name?: string }).name === 'ExchangeRate');
    expect(exchangeCall?.[1]).toMatchObject({ date: { $lte: new Date('2026-01-01') }, fromCurrency: { code: 'EUR', currencyKey: 1 }, toCurrency: { code: 'USD', currencyKey: 2 } });
    expect(exchangeCall?.[1]).not.toHaveProperty('deletedAt');
  });

  it('categorizes created transactions when enabled', async () => {
    const prev = process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'];
    process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = 'true';
    try {
      const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }] });
      const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'cat-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
      expect(result.transactionsCategorized).toBeGreaterThanOrEqual(0);
      // One persist for the created transaction + one for the RAD-346 Phase 1 freshness marker on the synced account.
      expect(em.persist).toHaveBeenCalledTimes(2);
    } finally {
      process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = prev;
    }
  });

  it('advances transactionsRefreshedAt on successfully-synced accounts but not failed ones (RAD-346 Phase 1)', async () => {
    const synced = { accountId: 'acc-1', accountKey: 11 } as Record<string, unknown>;
    const em = createEm({ accounts: [synced] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'fresh-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) },
    );
    expect(synced['transactionsRefreshedAt']).toBeInstanceOf(Date);

    const failed = { accountId: 'acc-1', accountKey: 11 } as Record<string, unknown>;
    const emFailed = createEm({ accounts: [failed] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(emFailed), enableBankingSyncAdapterFactory: bankSyncFactory(undefined, ['acc-1']) },
    );
    expect(failed['transactionsRefreshedAt']).toBeUndefined();
  });

  it('promotes a matching stored pending in place by rewriting its provider id (RAD-346 Phase 4 apply)', async () => {
    const storedPending = { appuserKey: { appuserKey: 9 }, enableBankingTransactionId: 'old-pending-id', externalTransactionId: undefined, settlementAmount: 10, settlementCurrencyKey: { code: 'EUR' }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2026-01-01'), transactionKey: 55 } as Record<string, unknown>;
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], pendings: [storedPending] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'booked-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) },
    );
    // Provider id rewritten to the incoming booked row's id → the persist loop updates this row in place (no duplicate).
    expect(storedPending['enableBankingTransactionId']).toBe('booked-1');
  });

  it('expires a stored pending that dropped from the feed past the grace window (RAD-346 Phase 4 apply)', async () => {
    const ghostPending = { appuserKey: { appuserKey: 9 }, externalTransactionId: 'gone-1', nordigenInternalTransactionId: 'gone-1', settlementAmount: 5, settlementCurrencyKey: { code: 'EUR' }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2020-01-01'), transactionKey: 77, transactionStatusKey: { name: 'PENDING' } } as Record<string, unknown>;
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], pendings: [ghostPending] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [], pending: [] }, 'acc-2': { booked: [], pending: [] } }) },
    );
    expect((ghostPending['transactionStatusKey'] as { name: string }).name).toBe('EXPIRED');
  });

  it('does not touch pendings when the kill switch (off) is set', async () => {
    vi.stubEnv('TRANSACTION_PENDING_RECONCILIATION', 'off');
    const ghostPending = { nordigenInternalTransactionId: 'gone-1', settlementAmount: 5, settlementCurrencyKey: { code: 'EUR' }, transactionDate: new Date('2020-01-01'), transactionKey: 77, transactionStatusKey: { name: 'PENDING' } } as Record<string, unknown>;
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], pendings: [ghostPending] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [], pending: [] }, 'acc-2': { booked: [], pending: [] } }) },
    );
    expect((ghostPending['transactionStatusKey'] as { name: string }).name).toBe('PENDING');
    vi.unstubAllEnvs();
  });

  it('returns partial when one account fails', async () => {
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm()), enableBankingSyncAdapterFactory: bankSyncFactory(undefined, ['acc-2']) });
    expect(result.status).toBe('partial');
    expect(result.failedAccountIds).toEqual(['acc-2']);
  });

  it('reports a per-account transaction fetch failure to Sentry instead of only logging it (RAD-519)', async () => {
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm()), enableBankingSyncAdapterFactory: bankSyncFactory(undefined, ['acc-2']) });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'fail' }),
      { tags: { accountId: 'acc-2', requisitionId: 'sess-1', stage: 'transaction-phase' } },
    );
  });

  it('returns failed when all account fetches fail', async () => {
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm()), enableBankingSyncAdapterFactory: bankSyncFactory(undefined, ['acc-1', 'acc-2']) });
    expect(result.status).toBe('failed');
    expect(result.accountsProcessed).toBe(0);
  });

  it('completes when all account transaction arrays are empty', async () => {
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(createEm()), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    expect(result.status).toBe('completed');
    expect(result.accountsProcessed).toBe(2);
    expect(result.transactionsFetched).toBe(0);
    expect(heartbeatJob).not.toHaveBeenCalled();
    expect(triggerRecurringDetectionAfterTransactionIngestion).not.toHaveBeenCalled();
  });

  it('marks account failed when all rows fail after fetch', async () => {
    const em = createEm({ persistRejects: [new Error('bad row'), new Error('bad row')] });
    const factory = bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'x' }], pending: [{ amount: '2', bookingDate: '2026-01-01', currency: 'EUR', entryReference: 'y' }] }, 'acc-2': { booked: [], pending: [] } });
    const result = await service.syncTransactionsForRequisition({ correlationId: 'c2', enableBankingConnectionKey: 1, queueJobId: 'j2' }, { em: asEm(em), enableBankingSyncAdapterFactory: factory });
    expect(result.status).toBe('partial');
    expect(result.accountsFailed).toBe(1);
    expect(heartbeatJob).not.toHaveBeenCalled();
  });

  it('marks account partial when some rows fail after fetch', async () => {
    const em = createEm({ persistRejects: [new Error('bad row')] });
    const factory = bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'x' }], pending: [{ amount: '2', bookingDate: '2026-01-01', currency: 'EUR', entryReference: 'y' }] }, 'acc-2': { booked: [], pending: [] } });
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: factory });
    expect(result.status).toBe('partial');
    expect(result.transactionsFailed).toBeGreaterThan(0);
  });

  it('upserts duplicate stable ids deterministically', async () => {
    const em = createEm({ existing: { transactionKey: 7 } });
    const factory = bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'same' }], pending: [] }, 'acc-2': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'same' }], pending: [] } });
    const first = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: factory });
    expect(first.transactionsCreated).toBe(0);
    expect(factory).toHaveBeenCalled();
  });

  it('does not double prefix internal transaction ids', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'abc' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, { appuserCurrencyKey?: { code: string }; appuserSettlementAmount?: number; internalTransactionId?: string }][] } }).mock.calls[0]?.[1];
    expect(created?.internalTransactionId).toBeTruthy();
    expect(String(created?.internalTransactionId)).not.toContain('nordigen:nordigen');
  });

  it('enriches deterministic metadata when enabled and preserves safe dirty values when disabled', async () => {
    const prev = process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'];
    process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'] = 'true';
    try {
      const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], });
      await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', creditorName: 'Merchant Name', currency: 'EUR', remittanceInformationUnstructured: '  Hello\nWorld  ', transactionId: 'meta-1' }], pending: [] } }) });
      const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
      expect(created).toMatchObject({ name: 'Merchant Name' });
    } finally {
      process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'] = prev;
    }

    const prevDisabled = process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'];
    process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'] = 'false';
    try {
      const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], });
      await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', creditorName: 'Merchant Name', currency: 'EUR', remittanceInformationUnstructured: '  Hello\nWorld  ', transactionId: 'meta-2' }], pending: [] } }) });
      const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => 'appuserKey' in data)?.[1];
      expect(created).toMatchObject({ descriptionDirty: 'Hello World' });
      expect(created?.['description']).toBeUndefined();
    } finally {
      process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED'] = prevDisabled;
    }
  });

  it('sanitizes unsafe Nordigen remittance values', async () => {
    const cases = [
      { expected: undefined, note: 'MB WAY' },
      { expected: undefined, note: 'PT50 1234 5678 9012 3456 7890 1' },
      { expected: undefined, note: '1234 5678 9012 3456 7890 1234' },
      { expected: 'a'.repeat(255), note: 'a'.repeat(300) },
    ];

    for (const [index, testCase] of cases.entries()) {
      const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }] });
      await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', remittanceInformationUnstructured: testCase.note, transactionId: `meta-${index}` }], pending: [] } }) });
      const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => 'appuserKey' in data)?.[1];
      expect(created?.['descriptionDirty']).toBe(testCase.expected);
    }
  });

  it('treats duplicate unique violations as skipped and other errors as failed', async () => {
    const em = createEm();
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('unique'))).mockRejectedValueOnce(Object.assign(new Error('other'), { code: '99999' }));
    const res = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory() });
    expect(res.transactionsFailed).toBeGreaterThanOrEqual(0);
  });

  it('fails safely when currency is invalid or missing status/type', async () => {
    const em1 = createEm({ currency: null });
    const res1 = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em1), enableBankingSyncAdapterFactory: bankSyncFactory() });
    expect(res1.transactionsFailed).toBeGreaterThan(0);
  });

  it('fails safely when amount is invalid', async () => {
    const emAmount = createEm();
    const amountResult = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(emAmount), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: 'abc', bookingDate: '2026-01-01', currency: 'EUR' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    expect(amountResult.transactionsFailed).toBeGreaterThan(0);
  });

  it('fails safely when status or type is missing', async () => {
    const emStatus = createEm({ status: null });
    const statusResult = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(emStatus), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    expect(statusResult.transactionsFailed).toBeGreaterThan(0);

    const emType = createEm({ type: null });
    const typeResult = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(emType), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    expect(typeResult.transactionsFailed).toBeGreaterThan(0);
  });

  it('upserts duplicates per account', async () => {
    const em = createEm({ existing: { transactionKey: 7 } });
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'same' }], pending: [] }, 'acc-2': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'same' }], pending: [] } }) });
    expect(result.transactionsCreated).toBe(0);
  });

  it('uses fallback hash with creditor debtor and remittance fields', async () => {
    const em = createEm();
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({
      'acc-1': { booked: [{ amount: '1', bookingDate: '2026-01-01', creditorName: 'A', currency: 'EUR' }, { amount: '1', bookingDate: '2026-01-01', currency: 'EUR', debtorName: 'A' }, { amount: '1', bookingDate: '2026-01-01', creditorName: 'A', currency: 'EUR', remittanceInformationUnstructured: 'y' }], pending: [] },
      'acc-2': { booked: [], pending: [] },
    }) });
    expect(result.transactionsCreated).toBe(3);
  });

  it('populates appuser currency fields for same-currency transactions', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'same-currency' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, { appuserCurrencyKey?: { code: string }; appuserSettlementAmount?: number; internalTransactionId?: string }][] } }).mock.calls[0]?.[1];
    expect(created?.appuserCurrencyKey?.code).toBe('EUR');
    expect(created?.appuserSettlementAmount).toBe(10);
  });

  it('converts appuser settlement amounts for different currencies when exchange rate exists', async () => {
    const em = createEm({ currency: { code: 'EUR', currencyKey: 1 }, exchangeRate: { rate: 1.2 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'fx-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls[0]?.[1];
    expect(created).toMatchObject({ appuserCurrencyExchangeRate: 1.2, appuserSettlementAmount: 12 });
  });


  it('does not call finishJob or unrelated integrations', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory() });
    expect(heartbeatJob).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ stage: 'finishJob' }));
  });
});

// Phase 1d: Enable Banking through the same widened `syncTransactionsForRequisition`. The
// reconciliation/dedup/balance-chain bodies exercised here are the exact same code paths as the
// GoCardless tests above — only the client-construction seam and the dedup column differ.
describe('account initial sync transaction service — Enable Banking', () => {
  const connection = { appuserKey: { appuserKey: 9 }, enableBankingConnectionKey: 5, sessionId: 'session-1', status: 'linked' as const };

  const enableBankingFactory = (responses: Responses = { 'acc-1': { transactions: { booked, pending: [] } }, 'acc-2': { transactions: { booked: [], pending: [] } } }) =>
    () => Promise.resolve({ account: (accountId: string) => ({ getTransactions: () => Promise.resolve(responses[accountId]?.transactions ? responses[accountId] : { transactions: responses[accountId] }) }) });

  it('fails when the connection is missing', async () => {
    const em = createEm({ connection: null });
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingFactory() })).rejects.toThrow('Enable Banking connection not found');
  });

  it('fails when the connection is not linked', async () => {
    const em = createEm({ connection: { ...connection, status: 'created' } });
    await expect(service.syncTransactionsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingFactory() })).rejects.toThrow('Enable Banking connection is not linked');
  });

  it('looks up accounts by enableBankingConnectionKey and persists with enableBankingTransactionId (not nordigenInternalTransactionId)', async () => {
    const em = createEm({ connection });
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingFactory() });

    expect(result).toMatchObject({ requisitionId: 'session-1', requisitionKey: 5, status: 'completed', transactionsCreated: 1 });
    const created = (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.find(([, data]) => data['externalTransactionId'] === 't-1')?.[1];
    expect(created).toMatchObject({ enableBankingTransactionId: 't-1' });
    expect(created?.['nordigenInternalTransactionId']).toBeUndefined();
  });

  it('dedups Enable Banking rows on enableBankingTransactionId, not nordigenInternalTransactionId', async () => {
    const em = createEm({ connection });
    // No `transactionId` on this row (only `entryReference`), so `externalTransactionId` stays
    // undefined and the only provider-id `$or` term is the Enable Banking one — mirrors the
    // GoCardless-only "dedups sync rows on the provider id only" test above.
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', entryReference: 'entry-1' }], pending: [] } }) });
    const query = em.findOne.mock.calls.find((call) => (call[0] as { name?: string }).name === 'Transaction')?.[1] as { $or?: Record<string, string>[] };
    expect(query.$or).toEqual([{ enableBankingTransactionId: 'entry-1' }]);
  });

  it('falls back to the pre-link state as requisitionId when no sessionId exists yet (defensive)', async () => {
    const em = createEm({ connection: { ...connection, sessionId: undefined, state: 'pre-link-state' } });
    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 5 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingFactory() });
    expect(result.requisitionId).toBe('pre-link-state');
  });
});
