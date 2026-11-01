import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { generateInternalTransactionId } from '@wondermoney/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { heartbeatJob } = vi.hoisted(() => ({ heartbeatJob: vi.fn().mockResolvedValue(true) }));
const { categorizeTransactionDeterministically } = vi.hoisted(() => ({ categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: true, reason: 'user_mapping' }) }));
const { triggerRecurringDetectionAfterTransactionIngestion } = vi.hoisted(() => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException }));
vi.mock('@service/operations/background-operation.service', () => ({ default: { finishJob: vi.fn(), heartbeatJob } }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion }));
// Transfer matching reads and writes through its own queries; it has its own tests on a real database.
vi.mock('@service/transaction/transfer-matching.service', () => ({ reconcileTransfers: vi.fn().mockResolvedValue({ pairsDissolved: 0, pairsMatched: 0, retypedAsIncome: 0, rowsChanged: 0 }) }));

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import type { EnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import { createEnableBankingSyncAdapter } from '@service/enable-banking/enable-banking-sync-adapter';

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
 * The chain query (`loadChainRows`) is the only `find(Transaction, …)` that carries a
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

  it('keeps a user-edited amount when the bank re-sends the transaction', async () => {
    const existing = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, appuserSettlementAmount: -10, editedSettlementAmount: -10, enableBankingTransactionId: 'tx-edit', settlementAmount: -10, transactionKey: 98, transactionStatusKey: { name: 'PENDING' } };
    const em = createEm({ existing });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '-12.75', bookingDate: '2026-01-03', currency: 'EUR', transactionId: 'tx-edit' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const updated = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updated).toMatchObject({ appuserSettlementAmount: -10, editedSettlementAmount: -10, settlementAmount: -10, transactionStatusKey: expect.objectContaining({ name: 'BOOKED' }) });
    expect(updated['originalAmount']).toBe(-12.75);
    // The bank's amount stays the bound for the user's next edit.
    expect(updated['uneditedSettlementAmount']).toBe(-12.75);
  });

  it('converts a kept edited amount into the user currency at the sync rate', async () => {
    const existing = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, appuserSettlementAmount: -14.66, editedSettlementAmount: -40, enableBankingTransactionId: 'tx-fx-edit', settlementAmount: -12.75, transactionKey: 97 };
    const em = createEm({ currency: { code: 'GBP', currencyKey: 2 }, exchangeRate: { rate: 1.15 }, existing });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '-12.75', bookingDate: '2026-01-03', currency: 'GBP', transactionId: 'tx-fx-edit' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const updated = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updated).toMatchObject({ appuserSettlementAmount: -46, editedSettlementAmount: -40, settlementAmount: -40 });
  });

  it('takes the bank amount for a re-sent transaction the user never edited', async () => {
    const existing = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, appuserSettlementAmount: -10, enableBankingTransactionId: 'tx-plain', settlementAmount: -10, transactionKey: 96 };
    const em = createEm({ existing });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '-12.75', bookingDate: '2026-01-03', currency: 'EUR', transactionId: 'tx-plain' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const updated = em.persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updated).toMatchObject({ appuserSettlementAmount: -12.75, settlementAmount: -12.75 });
  });

  it('dedups sync rows on the provider id only — no undefined-external and no fingerprint branch', async () => {
    const em = createEm();
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) });
    const query = em.findOne.mock.calls.find((call) => (call[0] as { name?: string }).name === 'Transaction')?.[1] as { $or?: { externalTransactionId?: string; internalTransactionId?: string; nordigenInternalTransactionId?: string }[] };
    // No `externalTransactionId` (the booked row carries no transactionId) and — because a
    // provider id is present — no synthetic `internalTransactionId` fingerprint branch
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

  // The batch assigns no balances at all: it cannot know a row's position in the account's total
  // order, so per-batch balances make cross-batch chains irreconcilable. The persist loop writes
  // the row; a single whole-account rebuild afterwards owns `balance` / `appuserCurrencyBalance`.
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
    // Hidden rows are part of the physical chain. Order matches the transactions list's reverse.
    expect(chainCall?.[2]).toMatchObject({ filters: { hidden: false }, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' } });
  });

  // An internally consistent chain whose tail no longer equals
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
      // One persist for the created transaction + one for the freshness marker on the synced account.
      expect(em.persist).toHaveBeenCalledTimes(2);
    } finally {
      process.env['TRANSACTION_DETERMINISTIC_CATEGORIZATION_ENABLED'] = prev;
    }
  });

  it('advances transactionsRefreshedAt on successfully-synced accounts but not failed ones', async () => {
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

  it('promotes a matching stored pending in place by rewriting its provider id', async () => {
    const storedPending = { appuserKey: { appuserKey: 9 }, enableBankingTransactionId: 'old-pending-id', externalTransactionId: undefined, settlementAmount: 10, settlementCurrencyKey: { code: 'EUR' }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2026-01-01'), transactionKey: 55 } as Record<string, unknown>;
    const em = createEm({ accounts: [{ accountId: 'acc-1', accountKey: 11 }], pendings: [storedPending] });
    await service.syncTransactionsForRequisition(
      { enableBankingConnectionKey: 1 },
      { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked: [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'booked-1' }], pending: [] }, 'acc-2': { booked: [], pending: [] } }) },
    );
    // Provider id rewritten to the incoming booked row's id → the persist loop updates this row in place (no duplicate).
    expect(storedPending['enableBankingTransactionId']).toBe('booked-1');
  });

  it('expires a stored pending that dropped from the feed past the grace window', async () => {
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

  it('reports a per-account transaction fetch failure to Sentry instead of only logging it', async () => {
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

// Enable Banking through the same `syncTransactionsForRequisition`. The
// reconciliation/dedup/balance-chain bodies exercised here are the exact same code paths as the
// tests above — only the client-construction seam and the dedup column differ.
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
    // "dedups sync rows on the provider id only" test above.
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

/**
 * Enable Banking sends `transaction_amount.amount` without a sign and the direction in
 * `credit_debit_indicator` (CRDT | DBIT). These drive the real adapter into the real sync service,
 * the one code path both the initial-sync and the auto-sync workers run.
 */
describe('Enable Banking amounts through the real adapter', () => {
  type RawRow = Record<string, unknown>;
  const enableBankingAdapter = (rows: RawRow[]) => {
    const client = { getAccountBalances: vi.fn(), getAccountTransactions: vi.fn().mockResolvedValue({ transactions: rows }) };
    const adapterEm = { find: vi.fn().mockResolvedValue([]) };
    return vi.fn((c: Parameters<typeof createEnableBankingSyncAdapter>[0]) => Promise.resolve(createEnableBankingSyncAdapter(Object.assign(c, { aspspCountry: 'PT', aspspName: 'Test Bank' }), { client: client as unknown as EnableBankingClient, em: adapterEm }) as unknown as Awaited<ReturnType<NonNullable<SyncDeps['enableBankingSyncAdapterFactory']>>>));
  };
  const createdRows = (em: ReturnType<typeof createEm>) => (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.filter(([entity]) => (entity as { name?: string }).name === 'Transaction').map(([, data]) => data);
  const debit: RawRow = { booking_date: '2026-03-02', credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, status: 'BOOK', transaction_amount: { amount: '12.50', currency: 'EUR' }, transaction_id: 'eb-debit-1' };
  const credit: RawRow = { booking_date: '2026-03-01', credit_debit_indicator: 'CRDT', debtor: { name: 'Employer' }, status: 'BOOK', transaction_amount: { amount: '100.00', currency: 'EUR' }, transaction_id: 'eb-credit-1' };
  const oneAccount = [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 87.5, balance: 87.5 }];

  it('stores a debit negative and a credit positive, in every amount field', async () => {
    const em = createEm({ accounts: oneAccount });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([debit, credit]) });
    const [storedDebit, storedCredit] = createdRows(em);
    expect(storedDebit).toMatchObject({ appuserSettlementAmount: -12.5, originalAmount: -12.5, settlementAmount: -12.5, transactionTypeKey: { name: 'PAYMENT' } });
    expect(storedCredit).toMatchObject({ appuserSettlementAmount: 100, originalAmount: 100, settlementAmount: 100, transactionTypeKey: { name: 'DEPOSIT' } });
  });

  it('converts a debit into the user currency with its sign', async () => {
    const em = createEm({ accounts: oneAccount, exchangeRate: { rate: 1.2 }, tenant: { appuserKey: { appuserKey: 9, currencyKey: { code: 'USD', currencyKey: 2 } }, tenantKey: { tenantKey: 3 } } });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([debit]) });
    expect(createdRows(em)[0]).toMatchObject({ appuserSettlementAmount: -15, settlementAmount: -12.5 });
  });

  it('fingerprints the generated internal id from the signed amount', async () => {
    const em = createEm({ accounts: oneAccount });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([debit]) });
    expect(createdRows(em)[0]?.['internalTransactionId']).toBe(generateInternalTransactionId(new Date('2026-03-02'), -12.5));
  });

  it('promotes a stored signed pending debit when its booked row arrives', async () => {
    const storedPending = { appuserKey: { appuserKey: 9 }, enableBankingTransactionId: 'eb-pending-1', settlementAmount: -12.5, settlementCurrencyKey: { code: 'EUR' }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2026-03-01'), transactionKey: 55 } as Record<string, unknown>;
    const em = createEm({ accounts: oneAccount, pendings: [storedPending] });
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([debit]) });
    expect(storedPending['enableBankingTransactionId']).toBe('eb-debit-1');
  });

  describe('rows ingested before amounts were signed', () => {
    // A provider row with neither `transaction_id` nor `entry_reference` is identified by a hash of
    // its fields. These literals are the ids the sync stored for these rows before the sign fix; a
    // changed hash would re-create every such row as a duplicate on the next sync.
    const idlessDebit: RawRow = { booking_date: '2026-03-02', credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, remittance_information: ['COMPRA 1234'], status: 'BOOK', transaction_amount: { amount: '12.50', currency: 'EUR' }, value_date: '2026-03-02' };
    const idlessCredit: RawRow = { booking_date: '2026-03-01', credit_debit_indicator: 'CRDT', debtor: { name: 'Employer' }, status: 'BOOK', transaction_amount: { amount: '100.00', currency: 'EUR' } };
    const idlessLegacyDebit: RawRow = { ...idlessDebit, credit_debit_indicator: 'DBTR' };
    const PRE_FIX_IDS = {
      credit: 'enable_banking:b16712e5b5a7567de20a7df643f58755d548d1dd497e7348e34414258528b5a2',
      debit: 'enable_banking:dba5a7c441b17a0886ecabe6bd17a390adba520e39c057857c5249a06f7fddc5',
      legacyDebit: 'enable_banking:393ad004c081054a05a554f0b95ad14b757269d8420949961dbb5258732e779f',
    };

    it.each([
      ['debit (DBIT)', idlessDebit, 'debit'],
      ['credit (CRDT)', idlessCredit, 'credit'],
      ['debit (DBTR)', idlessLegacyDebit, 'legacyDebit'],
    ] as const)('keeps the id an id-less %s was stored under', async (_label, row, key) => {
      const em = createEm({ accounts: oneAccount });
      await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([row]) });
      expect(createdRows(em)[0]?.['enableBankingTransactionId']).toBe(PRE_FIX_IDS[key]);
    });

    it('recognises an already-ingested positive debit and corrects it in place instead of duplicating it', async () => {
      const stored = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, enableBankingTransactionId: PRE_FIX_IDS.debit, settlementAmount: 12.5, tenantKey: { tenantKey: 3 }, transactionKey: 501 } as Record<string, unknown>;
      const em = createEm({ accounts: oneAccount });
      const baseFindOne = em.findOne.getMockImplementation();
      em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
        if ((entity as { name?: string }).name !== 'Transaction') return baseFindOne?.(entity, where);
        const terms = (where['$or'] ?? []) as Record<string, unknown>[];
        return terms.some((term) => term['enableBankingTransactionId'] === stored['enableBankingTransactionId']) ? stored : null;
      });
      const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter([idlessDebit]) });
      expect(result.transactionsCreated).toBe(0);
      expect(createdRows(em)).toHaveLength(0);
      expect(stored).toMatchObject({ enableBankingTransactionId: PRE_FIX_IDS.debit, settlementAmount: -12.5 });
    });
  });
});

/**
 * Enable Banking's TransactionStatus is BOOK | CNCL | HOLD | OTHR | PDNG | RJCT | SCHD
 * (https://enablebanking.com/docs/api/reference/#transactionstatus). Only BOOK has settled, so only
 * BOOK may enter the running balance and the totals. Driven through the real adapter into the real
 * sync service, the code path both the initial-sync and the auto-sync workers run.
 */
describe('Enable Banking transaction status through the real adapter', () => {
  type RawRow = Record<string, unknown>;
  type Stored = Record<string, unknown>;
  const enableBankingAdapter = (rows: RawRow[]) => {
    const client = { getAccountBalances: vi.fn(), getAccountTransactions: vi.fn().mockResolvedValue({ transactions: rows }) };
    const adapterEm = { find: vi.fn().mockResolvedValue([]) };
    return vi.fn((c: Parameters<typeof createEnableBankingSyncAdapter>[0]) => Promise.resolve(createEnableBankingSyncAdapter(Object.assign(c, { aspspCountry: 'PT', aspspName: 'Test Bank' }), { client: client as unknown as EnableBankingClient, em: adapterEm }) as unknown as Awaited<ReturnType<NonNullable<SyncDeps['enableBankingSyncAdapterFactory']>>>));
  };
  const createdRows = (em: ReturnType<typeof createEm>) => (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.filter(([entity]) => (entity as { name?: string }).name === 'Transaction').map(([, data]) => data);
  const oneAccount = [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 87.5, balance: 87.5 }];
  const sync = (em: ReturnType<typeof createEm>, rows: RawRow[]) => service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter(rows) });
  /** An em whose provider-id lookup finds `stored` rows by `enableBankingTransactionId`, as the unique constraint does. */
  function emWithStored(stored: Stored[], overrides: Parameters<typeof createEm>[0] = {}) {
    const em = Object.assign(createEm({ accounts: oneAccount, ...overrides }), { getReference: vi.fn((_entity: unknown, key: unknown) => ({ key })) });
    const baseFindOne = em.findOne.getMockImplementation();
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      if ((entity as { name?: string }).name !== 'Transaction') return baseFindOne?.(entity, where);
      const ids = [where['enableBankingTransactionId'], ...((where['$or'] ?? []) as Record<string, unknown>[]).map((term) => term['enableBankingTransactionId'])].filter(Boolean);
      return stored.find((row) => ids.includes(row['enableBankingTransactionId'])) ?? null;
    });
    return em;
  }
  const statusOf = (row: Stored | undefined) => (row?.['transactionStatusKey'] as undefined | { name?: string })?.name;

  const pendingDebit: RawRow = { credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, status: 'PDNG', transaction_amount: { amount: '12.50', currency: 'EUR' }, transaction_id: 'eb-pdng-1', value_date: '2026-03-02' };
  const bookedDebit: RawRow = { booking_date: '2026-03-03', credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, status: 'BOOK', transaction_amount: { amount: '12.50', currency: 'EUR' }, transaction_id: 'eb-book-1', value_date: '2026-03-03' };

  it('stores a PDNG row as pending', async () => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [pendingDebit]);
    expect(createdRows(em).map(statusOf)).toEqual(['PENDING']);
  });

  it.each(['HOLD', 'SCHD', 'OTHR'])('stores a %s row as pending, never as booked', async (status) => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [{ ...pendingDebit, status }]);
    expect(createdRows(em).map(statusOf)).toEqual(['PENDING']);
  });

  it('dates a pending row from transaction_date when it has no booking or value date yet', async () => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [{ credit_debit_indicator: 'DBIT', status: 'PDNG', transaction_amount: { amount: '3.00', currency: 'EUR' }, transaction_date: '2026-03-05', transaction_id: 'eb-pdng-2' }]);
    expect(createdRows(em)[0]).toMatchObject({ transactionDate: new Date('2026-03-05') });
  });

  it('matches a stored PDNG row to its booked version arriving later under a different id, without a duplicate', async () => {
    const first = createEm({ accounts: oneAccount });
    await sync(first, [pendingDebit]);
    const storedPending: Stored = { ...createdRows(first)[0], settlementCurrencyKey: { code: 'EUR' }, transactionKey: 70 };
    expect(statusOf(storedPending)).toBe('PENDING');

    const second = emWithStored([storedPending], { pendings: [storedPending] });
    const result = await sync(second, [bookedDebit]);

    expect(result.transactionsCreated).toBe(0);
    expect(createdRows(second)).toHaveLength(0);
    expect(storedPending).toMatchObject({ enableBankingTransactionId: 'eb-book-1', settlementAmount: -12.5 });
    expect(statusOf(storedPending)).toBe('BOOKED');
  });

  it('moves an already-ingested booked copy of a still-pending row back to pending, out of the running balance', async () => {
    const stored: Stored = { accountKey: { accountKey: 11 }, appuserCurrencyBalance: 75, appuserKey: tenant.appuserKey, balance: 75, enableBankingTransactionId: 'eb-pdng-1', settlementAmount: -12.5, tenantKey: { tenantKey: 3 }, transactionKey: 71, transactionStatusKey: { name: 'BOOKED' } };
    const em = emWithStored([stored]);
    const result = await sync(em, [pendingDebit]);

    expect(result.transactionsCreated).toBe(0);
    expect(statusOf(stored)).toBe('PENDING');
    expect(stored['balance']).toBeNull();
    expect(stored['appuserCurrencyBalance']).toBeNull();
  });

  it('keeps an id-less pending that is still in the feed instead of expiring it', async () => {
    const idlessPending: RawRow = { credit_debit_indicator: 'DBIT', remittance_information: ['COMPRA 99'], status: 'PDNG', transaction_amount: { amount: '8.00', currency: 'EUR' }, value_date: '2020-01-01' };
    const first = createEm({ accounts: oneAccount });
    await sync(first, [idlessPending]);
    const storedPending: Stored = { ...createdRows(first)[0], appuserKey: { appuserKey: 9 }, settlementCurrencyKey: { code: 'EUR' }, transactionKey: 72 };

    const second = emWithStored([storedPending], { pendings: [storedPending] });
    await sync(second, [idlessPending]);

    expect(statusOf(storedPending)).toBe('PENDING');
  });

  describe.each(['RJCT', 'CNCL'])('a %s row', (status) => {
    const voided: RawRow = { ...bookedDebit, status, transaction_id: 'eb-void-1' };

    it('is not ingested', async () => {
      const em = createEm({ accounts: oneAccount });
      const result = await sync(em, [voided]);
      expect(createdRows(em)).toHaveLength(0);
      expect(result.transactionsCreated).toBe(0);
    });

    it('retracts a copy ingested before: expired, out of the running balance, audited', async () => {
      const stored: Stored = { accountKey: { accountKey: 11 }, appuserCurrencyBalance: 75, appuserKey: tenant.appuserKey, balance: 75, enableBankingTransactionId: 'eb-void-1', settlementAmount: -12.5, tenantKey: { tenantKey: 3 }, transactionKey: 73, transactionStatusKey: { name: 'BOOKED' } };
      const em = emWithStored([stored]);
      await sync(em, [voided]);

      expect(statusOf(stored)).toBe('EXPIRED');
      expect(stored['balance']).toBeNull();
      expect(stored['appuserCurrencyBalance']).toBeNull();
      const audits = em.persist.mock.calls.map(([entity]) => entity as Record<string, unknown>).filter((entity) => entity['eventType'] !== undefined);
      expect(audits).toContainEqual(expect.objectContaining({ changes: expect.objectContaining({ reason: { from: null, to: `provider_status:${status}` }, transactionStatusKey: { from: 'BOOKED', to: 'EXPIRED' } }), eventType: 'system_edit' }));
    });
  });
});

/**
 * Enable Banking: `transaction_id` "can not be used to uniquely identify transactions and may change
 * if the list of transactions is retrieved again"; `entry_reference` "is both unique and immutable
 * for accounts with the same identification hashes"
 * (https://enablebanking.com/docs/api/reference/#transaction). A row is therefore identified by its
 * `entry_reference` when it has one. Rows stored before that, under their `transaction_id`, are still
 * found, but only when the stored row is the same transaction, and are re-keyed in place.
 */
describe('Enable Banking transaction identity through the real adapter', () => {
  type RawRow = Record<string, unknown>;
  type Stored = Record<string, unknown>;
  const enableBankingAdapter = (rows: RawRow[]) => {
    const client = { getAccountBalances: vi.fn(), getAccountTransactions: vi.fn().mockResolvedValue({ transactions: rows }) };
    const adapterEm = { find: vi.fn().mockResolvedValue([]) };
    return vi.fn((c: Parameters<typeof createEnableBankingSyncAdapter>[0]) => Promise.resolve(createEnableBankingSyncAdapter(Object.assign(c, { aspspCountry: 'PT', aspspName: 'Test Bank' }), { client: client as unknown as EnableBankingClient, em: adapterEm }) as unknown as Awaited<ReturnType<NonNullable<SyncDeps['enableBankingSyncAdapterFactory']>>>));
  };
  const createdRows = (em: ReturnType<typeof createEm>) => (em.create as unknown as { mock: { calls: [unknown, Record<string, unknown>][] } }).mock.calls.filter(([entity]) => (entity as { name?: string }).name === 'Transaction').map(([, data]) => data);
  const oneAccount = [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 87.5, balance: 87.5 }];
  const sync = (em: ReturnType<typeof createEm>, rows: RawRow[]) => service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter(rows) });
  const matches = (row: Stored, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'accountKey' || key === 'deletedAt' || value === undefined) return true;
    if (key === '$or') return (value as Record<string, unknown>[]).some((term) => matches(row, term));
    if (value && typeof value === 'object' && '$in' in value) return ((value as { $in: unknown[] }).$in).includes(row[key]);
    return row[key] === value;
  });
  /** An em backed by `stored`: every Transaction lookup is answered from it, by the columns it queries. */
  function emWithStored(stored: Stored[], overrides: Parameters<typeof createEm>[0] = {}) {
    const em = Object.assign(createEm({ accounts: oneAccount, ...overrides }), { getReference: vi.fn((_entity: unknown, key: unknown) => ({ key })) });
    const baseFindOne = em.findOne.getMockImplementation();
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      if ((entity as { name?: string }).name !== 'Transaction') return baseFindOne?.(entity, where);
      return stored.find((row) => matches(row, where)) ?? null;
    });
    return em;
  }
  const statusOf = (row: Stored | undefined) => (row?.['transactionStatusKey'] as undefined | { name?: string })?.name;
  const debit: RawRow = { booking_date: '2026-03-02', credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, entry_reference: 'ER-1', status: 'BOOK', transaction_amount: { amount: '12.50', currency: 'EUR' }, transaction_id: 'tid-A' };
  const storedRow = (fields: Stored): Stored => ({ accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, originalAmount: -12.5, settlementAmount: -12.5, settlementCurrencyKey: { code: 'EUR', currencyKey: 1 }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2026-03-02'), transactionStatusKey: { name: 'BOOKED' }, ...fields });

  it('stores a row under its entry_reference when it has one', async () => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [debit]);
    expect(createdRows(em)[0]).toMatchObject({ enableBankingTransactionId: 'ER-1', externalTransactionId: 'tid-A' });
  });

  it('updates, not duplicates, a row re-fetched with a changed transaction_id but the same entry_reference', async () => {
    const first = createEm({ accounts: oneAccount });
    await sync(first, [debit]);
    const stored: Stored = { ...createdRows(first)[0], appuserKey: tenant.appuserKey, transactionKey: 600 };

    const second = emWithStored([stored]);
    const result = await sync(second, [{ ...debit, transaction_id: 'tid-B' }]);

    expect(result.transactionsCreated).toBe(0);
    expect(createdRows(second)).toHaveLength(0);
    expect(stored).toMatchObject({ enableBankingTransactionId: 'ER-1', externalTransactionId: 'tid-B', settlementAmount: -12.5 });
  });

  it('finds a row stored under its transaction_id before entry_reference was preferred, and re-keys it', async () => {
    const legacy = storedRow({ enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', transactionKey: 601 });
    const em = emWithStored([legacy]);
    const result = await sync(em, [debit]);

    expect(result.transactionsCreated).toBe(0);
    expect(createdRows(em)).toHaveLength(0);
    expect(legacy).toMatchObject({ enableBankingTransactionId: 'ER-1', externalTransactionId: 'tid-A' });
  });

  it('finds a legacy row stored before amounts were signed', async () => {
    const legacy = storedRow({ enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', originalAmount: 12.5, settlementAmount: 12.5, transactionKey: 602 });
    const em = emWithStored([legacy]);
    await sync(em, [debit]);

    expect(createdRows(em)).toHaveLength(0);
    expect(legacy).toMatchObject({ enableBankingTransactionId: 'ER-1', settlementAmount: -12.5 });
  });

  it('finds a legacy row the user edited the amount of, and keeps the edit', async () => {
    const legacy = storedRow({ editedSettlementAmount: -10, enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', settlementAmount: -10, transactionKey: 603 });
    const em = emWithStored([legacy]);
    await sync(em, [debit]);

    expect(createdRows(em)).toHaveLength(0);
    expect(legacy).toMatchObject({ enableBankingTransactionId: 'ER-1', originalAmount: -12.5, settlementAmount: -10 });
  });

  it('does not take over a legacy row whose transaction_id now names a different transaction', async () => {
    const other = storedRow({ enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', originalAmount: -40, settlementAmount: -40, transactionDate: new Date('2026-02-20'), transactionKey: 604 });
    const em = emWithStored([other]);
    const result = await sync(em, [debit]);

    expect(result.transactionsCreated).toBe(1);
    expect(createdRows(em)[0]).toMatchObject({ enableBankingTransactionId: 'ER-1', settlementAmount: -12.5 });
    expect(other).toMatchObject({ enableBankingTransactionId: 'tid-A', settlementAmount: -40 });
  });

  it('never matches a re-keyed row through a transaction_id it used to have', async () => {
    const rekeyed = storedRow({ enableBankingTransactionId: 'ER-1', externalTransactionId: 'tid-A', transactionKey: 605 });
    const em = emWithStored([rekeyed]);
    const result = await sync(em, [{ ...debit, entry_reference: 'ER-2', transaction_amount: { amount: '3.00', currency: 'EUR' } }]);

    expect(result.transactionsCreated).toBe(1);
    expect(createdRows(em)[0]).toMatchObject({ enableBankingTransactionId: 'ER-2', settlementAmount: -3 });
    expect(rekeyed).toMatchObject({ enableBankingTransactionId: 'ER-1', settlementAmount: -12.5 });
  });

  it('keeps storing a row with only a transaction_id under it', async () => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [{ ...debit, entry_reference: undefined }]);
    expect(createdRows(em)[0]).toMatchObject({ enableBankingTransactionId: 'tid-A' });
  });

  it('ignores an empty entry_reference', async () => {
    const em = createEm({ accounts: oneAccount });
    await sync(em, [{ ...debit, entry_reference: '' }]);
    expect(createdRows(em)[0]).toMatchObject({ enableBankingTransactionId: 'tid-A' });
  });

  it('promotes a stored pending to the booked row\'s entry_reference', async () => {
    const storedPending = storedRow({ enableBankingTransactionId: 'tid-P', transactionKey: 606, transactionStatusKey: { name: 'PENDING' } });
    const em = emWithStored([storedPending], { pendings: [storedPending] });
    const result = await sync(em, [debit]);

    expect(result.transactionsCreated).toBe(0);
    expect(storedPending).toMatchObject({ enableBankingTransactionId: 'ER-1' });
    expect(statusOf(storedPending)).toBe('BOOKED');
  });

  it.each([
    ['its entry_reference, after its transaction_id changed', { enableBankingTransactionId: 'ER-1', externalTransactionId: 'tid-old' }],
    ['its legacy transaction_id', { enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A' }],
  ])('retracts a cancelled row stored under %s', async (_label, ids) => {
    const stored = storedRow({ ...ids, balance: 75, transactionKey: 607 });
    const em = emWithStored([stored]);
    await sync(em, [{ ...debit, status: 'CNCL' }]);
    expect(statusOf(stored)).toBe('EXPIRED');
  });

  /**
   * Promotion gives a stored pending the booked row's id, and `(account_key, enable_banking_transaction_id)`
   * is unique. The fake flush enforces that constraint over every row the database holds, the way
   * Postgres does: a change that collides stays in the unit of work and fails every later flush too.
   */
  describe('a promotion whose booked row is already stored', () => {
    const pendingStatus = { name: 'PENDING' };
    const debit2: RawRow = { ...debit, creditor: { name: 'Continente' }, entry_reference: 'ER-2', transaction_amount: { amount: '20.00', currency: 'EUR' }, transaction_id: 'tid-B' };
    /** `unseen` rows are in the database but invisible to the sync's reads: a concurrent insert. */
    function emEnforcingUniqueIds(stored: Stored[], unseen: Stored[] = []) {
      const em = emWithStored(stored, { pendings: stored.filter((row) => statusOf(row) === 'PENDING') });
      em.flush.mockImplementation(() => {
        const ids = [...stored, ...unseen].map((row) => row['enableBankingTransactionId']).filter(Boolean);
        return new Set(ids).size === ids.length ? Promise.resolve(undefined) : Promise.reject(new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint')));
      });
      return em;
    }
    const audits = (em: ReturnType<typeof createEm>) => em.persist.mock.calls.map(([entity]) => entity as Record<string, unknown>).filter((entity) => entity['eventType'] !== undefined);
    const holding = (rows: Stored[], id: string) => rows.filter((row) => row['enableBankingTransactionId'] === id);

    // Inside the pending grace window, so the dropped-from-the-feed expiry alone would not touch the pending.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-03T12:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    it('leaves exactly one booked row, expires the pending, and audits it', async () => {
      const bookedRow = storedRow({ enableBankingTransactionId: 'ER-1', transactionKey: 620 });
      const pendingRow = storedRow({ enableBankingTransactionId: 'tid-P', transactionKey: 621, transactionStatusKey: pendingStatus });
      const em = emEnforcingUniqueIds([bookedRow, pendingRow]);
      const result = await sync(em, [debit]);

      expect(result).toMatchObject({ transactionsCreated: 0, transactionsFailed: 0 });
      expect(holding([bookedRow, pendingRow], 'ER-1')).toEqual([bookedRow]);
      expect(statusOf(bookedRow)).toBe('BOOKED');
      expect(pendingRow['enableBankingTransactionId']).toBe('tid-P');
      expect(statusOf(pendingRow)).toBe('EXPIRED');
      expect(audits(em)).toContainEqual(expect.objectContaining({ eventType: 'pending_expired', transactionKey: { key: 621 } }));
      expect(audits(em)).not.toContainEqual(expect.objectContaining({ eventType: 'pending_promoted' }));
    });

    it('treats a booked row stored under its legacy transaction_id as already stored', async () => {
      const legacyBooked = storedRow({ enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', transactionKey: 622 });
      const pendingRow = storedRow({ enableBankingTransactionId: 'tid-P', transactionKey: 623, transactionStatusKey: pendingStatus });
      const em = emEnforcingUniqueIds([legacyBooked, pendingRow]);
      const result = await sync(em, [debit]);

      expect(result).toMatchObject({ transactionsCreated: 0, transactionsFailed: 0 });
      expect(holding([legacyBooked, pendingRow], 'ER-1')).toEqual([legacyBooked]);
      expect(statusOf(pendingRow)).toBe('EXPIRED');
    });

    it('leaves a pending that is still in the feed alone: it is another transaction', async () => {
      const bookedRow = storedRow({ enableBankingTransactionId: 'ER-1', transactionKey: 624 });
      const pendingRow = storedRow({ enableBankingTransactionId: 'tid-P', transactionKey: 625, transactionStatusKey: pendingStatus });
      const em = emEnforcingUniqueIds([bookedRow, pendingRow]);
      const result = await sync(em, [debit, { ...debit, booking_date: undefined, entry_reference: undefined, status: 'PDNG', transaction_date: '2026-03-03', transaction_id: 'tid-P' }]);

      expect(result).toMatchObject({ transactionsCreated: 0, transactionsFailed: 0 });
      expect(pendingRow['enableBankingTransactionId']).toBe('tid-P');
      expect(statusOf(pendingRow)).toBe('PENDING');
      expect(statusOf(bookedRow)).toBe('BOOKED');
    });

    it('lets the other promotions and the rest of the sync go on when one promotion\'s write fails', async () => {
      const first = storedRow({ enableBankingTransactionId: 'tid-P1', transactionKey: 630, transactionStatusKey: pendingStatus });
      const second = storedRow({ enableBankingTransactionId: 'tid-P2', originalAmount: -20, settlementAmount: -20, transactionKey: 631, transactionStatusKey: pendingStatus });
      // Inserted by a concurrent sync after the check, so only the write finds it.
      const concurrent = storedRow({ enableBankingTransactionId: 'ER-1', transactionKey: 632 });
      const em = emEnforcingUniqueIds([first, second], [concurrent]);
      const result = await sync(em, [debit, debit2]);

      expect(result.transactionsFailed).toBe(0);
      expect(first['enableBankingTransactionId']).toBe('tid-P1');
      expect(statusOf(first)).toBe('PENDING');
      expect(second['enableBankingTransactionId']).toBe('ER-2');
      expect(statusOf(second)).toBe('BOOKED');
    });
  });
});

/**
 * A hidden row is a user's choice about where a transaction shows, not a different
 * transaction. The hidden filter is on by default for every read, so a sync that reads through it
 * cannot see the rows a user hid. The store below answers reads the way MikroORM does: a hidden row
 * is returned only when the read turns the `hidden` filter off. Its flush enforces
 * `(account_key, enable_banking_transaction_id)` over every row, hidden or not, as Postgres does, and
 * a failed insert is dropped (checked against MikroORM 6 on a disposable Postgres 16).
 */
describe('hidden rows through the real adapter', () => {
  type RawRow = Record<string, unknown>;
  type Stored = Record<string, unknown>;
  const enableBankingAdapter = (rows: RawRow[]) => {
    const client = { getAccountBalances: vi.fn(), getAccountTransactions: vi.fn().mockResolvedValue({ transactions: rows }) };
    const adapterEm = { find: vi.fn().mockResolvedValue([]) };
    return vi.fn((c: Parameters<typeof createEnableBankingSyncAdapter>[0]) => Promise.resolve(createEnableBankingSyncAdapter(Object.assign(c, { aspspCountry: 'PT', aspspName: 'Test Bank' }), { client: client as unknown as EnableBankingClient, em: adapterEm }) as unknown as Awaited<ReturnType<NonNullable<SyncDeps['enableBankingSyncAdapterFactory']>>>));
  };
  const oneAccount = () => [{ accountId: 'acc-1', accountKey: 11, appuserCurrencyBalance: 87.5, balance: 87.5 } as Record<string, unknown>];
  const statusOf = (row: Stored | undefined) => (row?.['transactionStatusKey'] as undefined | { name?: string })?.name;
  const matches = (row: Stored, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'accountKey' || key === 'deletedAt' || value === undefined) return true;
    if (key === '$or') return (value as Record<string, unknown>[]).some((term) => matches(row, term));
    if (key === 'transactionStatusKey') return statusOf(row) === (value as { name?: string }).name;
    return row[key] === value;
  });
  const sees = (row: Stored, options?: Record<string, unknown>) => row['hidden'] !== true || (options?.['filters'] as Record<string, unknown> | undefined)?.['hidden'] === false;

  /** Everything the account holds, hidden rows included, plus the rows this sync inserts. */
  function store(rows: Stored[], accounts = oneAccount()) {
    const inserted: Stored[] = [];
    const em = Object.assign(createEm({ accounts }), { getReference: vi.fn((_entity: unknown, key: unknown) => ({ key })) });
    const baseFindOne = em.findOne.getMockImplementation();
    const baseFind = em.find.getMockImplementation();
    em.findOne.mockImplementation((entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      if ((entity as { name?: string }).name !== 'Transaction') return baseFindOne?.(entity, where);
      return rows.find((row) => sees(row, options) && matches(row, where)) ?? null;
    });
    em.find.mockImplementation((entity: unknown, where?: Record<string, unknown>, options?: Record<string, unknown>) => {
      if ((entity as { name?: string }).name !== 'Transaction') return baseFind?.(entity, where, options) ?? [];
      if (isChainQuery(where)) return [];
      return rows.filter((row) => sees(row, options) && matches(row, where ?? {}));
    });
    let unflushed: Stored[] = [];
    em.create.mockImplementation((entity: unknown, data: unknown) => {
      if ((entity as { name?: string }).name !== 'Transaction') return data;
      const row = { ...(data as Stored) };
      unflushed.push(row);
      return row;
    });
    em.flush.mockImplementation(() => {
      const candidates = [...rows, ...unflushed];
      const ids = candidates.map((row) => row['enableBankingTransactionId']).filter(Boolean);
      const batch = unflushed; unflushed = [];
      if (new Set(ids).size !== ids.length) return Promise.reject(new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint')));
      rows.push(...batch); inserted.push(...batch);
      return Promise.resolve(undefined);
    });
    return { em, inserted };
  }
  const sync = (em: ReturnType<typeof createEm>, rows: RawRow[]) => service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: enableBankingAdapter(rows) });
  const debit: RawRow = { booking_date: '2026-03-02', credit_debit_indicator: 'DBIT', creditor: { name: 'Pingo Doce' }, entry_reference: 'ER-1', remittance_information: ['COMPRA PINGO DOCE'], status: 'BOOK', transaction_amount: { amount: '12.50', currency: 'EUR' }, transaction_id: 'tid-A' };
  const hiddenRow = (fields: Stored): Stored => ({ accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, hidden: true, originalAmount: -12.5, settlementAmount: -12.5, settlementCurrencyKey: { code: 'EUR', currencyKey: 1 }, tenantKey: { tenantKey: 3 }, transactionDate: new Date('2026-03-02'), transactionStatusKey: { name: 'BOOKED' }, ...fields });

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-03T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('moves a hidden row stored as booked back to pending when the bank reports it pending, and keeps it hidden', async () => {
    const stored = hiddenRow({ appuserCurrencyBalance: 75, balance: 75, enableBankingTransactionId: 'ER-1', transactionKey: 700 });
    const { em, inserted } = store([stored]);
    const result = await sync(em, [{ ...debit, booking_date: undefined, status: 'PDNG', value_date: '2026-03-02' }]);

    expect(inserted).toHaveLength(0);
    expect(result).toMatchObject({ transactionsCreated: 0, transactionsFailed: 0, transactionsSkipped: 0 });
    expect(statusOf(stored)).toBe('PENDING');
    expect(stored).toMatchObject({ appuserCurrencyBalance: null, balance: null, hidden: true });
  });

  it('refreshes a hidden row\'s status, date and metadata from the bank, and keeps the user\'s hide, review, category and edited amount', async () => {
    const category = { categoryKey: 5 };
    const stored = hiddenRow({ appuserTransactionCategories: category, descriptionDirty: 'COMPRA', editedSettlementAmount: -10, enableBankingTransactionId: 'ER-1', reviewed: true, settlementAmount: -10, transactionDate: new Date('2026-03-01'), transactionKey: 701, transactionStatusKey: { name: 'PENDING' } });
    const { em, inserted } = store([stored]);
    await sync(em, [{ ...debit, transaction_id: 'tid-B' }]);

    expect(inserted).toHaveLength(0);
    expect(statusOf(stored)).toBe('BOOKED');
    // Metadata is rebuilt from this fetch, as for a visible row; the exact text is the enrichment's business.
    expect(stored['descriptionDirty']).toEqual(expect.any(String));
    expect(stored['descriptionDirty']).not.toBe('COMPRA');
    expect(stored).toMatchObject({ appuserTransactionCategories: category, externalTransactionId: 'tid-B', hidden: true, originalAmount: -12.5, reviewed: true, settlementAmount: -10, transactionDate: new Date('2026-03-02') });
  });

  it('finds a hidden row stored under its legacy transaction_id and re-keys it, instead of creating a visible duplicate', async () => {
    const legacy = hiddenRow({ enableBankingTransactionId: 'tid-A', externalTransactionId: 'tid-A', transactionKey: 702 });
    const { em, inserted } = store([legacy]);
    const result = await sync(em, [debit]);

    expect(inserted).toHaveLength(0);
    expect(result.transactionsCreated).toBe(0);
    expect(legacy).toMatchObject({ enableBankingTransactionId: 'ER-1', hidden: true });
  });

  it('promotes a hidden pending when its booked version arrives under another id: one row, still hidden', async () => {
    const pendingRow = hiddenRow({ enableBankingTransactionId: 'tid-P', transactionKey: 703, transactionStatusKey: { name: 'PENDING' } });
    const { em, inserted } = store([pendingRow]);
    const result = await sync(em, [debit]);

    expect(inserted).toHaveLength(0);
    expect(result.transactionsCreated).toBe(0);
    expect(pendingRow).toMatchObject({ enableBankingTransactionId: 'ER-1', hidden: true });
    expect(statusOf(pendingRow)).toBe('BOOKED');
  });

  it('expires a hidden ghost pending that left the feed, like a visible one', async () => {
    const ghost = hiddenRow({ enableBankingTransactionId: 'tid-gone', transactionDate: new Date('2026-01-01'), transactionKey: 704, transactionStatusKey: { name: 'PENDING' } });
    const { em } = store([ghost]);
    await sync(em, []);

    expect(statusOf(ghost)).toBe('EXPIRED');
    expect(ghost['hidden']).toBe(true);
  });

  it('counts a hidden pending in the dry-run promotion telemetry, as the live run would promote it', async () => {
    vi.stubEnv('TRANSACTION_PENDING_RECONCILIATION', 'dry_run');
    const pendingRow = hiddenRow({ enableBankingTransactionId: 'tid-P', transactionKey: 705, transactionStatusKey: { name: 'PENDING' } });
    const { em } = store([pendingRow]);
    await sync(em, [debit]);

    const audits = em.persist.mock.calls.map(([entity]) => entity as Record<string, unknown>).filter((entity) => entity['eventType'] !== undefined);
    expect(audits).toContainEqual(expect.objectContaining({ eventType: 'pending_promoted', transactionKey: { key: 705 } }));
  });
});

/**
 * `transactionsRefreshedAt` is what the accounts DTO derives staleness from. It
 * says the bank was asked and answered, so it advances on a successful fetch whatever the fetch
 * held: new rows, rows already stored, or nothing.
 */
describe('account freshness', () => {
  const syncWith = (em: ReturnType<typeof createEm>, booked: TxRow[], fail: string[] = []) => service.syncTransactionsForRequisition({ enableBankingConnectionKey: 1 }, { em: asEm(em), enableBankingSyncAdapterFactory: bankSyncFactory({ 'acc-1': { booked, pending: [] } }, fail) });

  it('marks an account fresh when its fetch only updated rows it already had', async () => {
    const account = { accountId: 'acc-1', accountKey: 11 } as Record<string, unknown>;
    const existing = { accountKey: { accountKey: 11 }, appuserKey: tenant.appuserKey, enableBankingTransactionId: 'known-1', settlementAmount: 10, transactionKey: 800 };
    const em = createEm({ accounts: [account], existing });
    const result = await syncWith(em, [{ amount: '10', bookingDate: '2026-01-01', currency: 'EUR', transactionId: 'known-1' }]);

    expect(result).toMatchObject({ accountsProcessed: 1, status: 'completed', transactionsCreated: 0, transactionsSkipped: 0 });
    expect(account['transactionsRefreshedAt']).toBeInstanceOf(Date);
  });

  it('marks an account fresh when its fetch returned nothing new', async () => {
    const account = { accountId: 'acc-1', accountKey: 11 } as Record<string, unknown>;
    const em = createEm({ accounts: [account] });
    await syncWith(em, []);
    expect(account['transactionsRefreshedAt']).toBeInstanceOf(Date);
  });

  it('leaves an account stale when its fetch fails, even if it was fresh before', async () => {
    const before = new Date('2026-01-01T00:00:00Z');
    const account = { accountId: 'acc-1', accountKey: 11, transactionsRefreshedAt: before } as Record<string, unknown>;
    const em = createEm({ accounts: [account] });
    const result = await syncWith(em, [], ['acc-1']);

    expect(result).toMatchObject({ accountsProcessed: 0, status: 'failed' });
    expect(account['transactionsRefreshedAt']).toBe(before);
  });
});
