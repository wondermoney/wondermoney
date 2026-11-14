import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: false, reason: 'none' }) } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import service, { type BankSyncTransaction, buildStableId, enableBankingTransactionIdFor, withStableIdOccurrences } from '@service/account/account-initial-sync-transaction.service';
import { connectionRef as conn, providerFromClient } from '@service/bank-providers/__tests__/helpers';

/*
 * Two purchases with identical content (same shop, day and amount) that the bank sends without an
 * `entry_reference` or `transaction_id` are still two transactions. Such a row is identified by a
 * hash of its fields, so the nth identical row in one fetch is told apart by an occurrence suffix;
 * the first keeps the bare hash, which is what every row stored before the suffix existed is keyed by.
 */

// The hash the sync stored for `coffee` on account `acc-current` before occurrences existed. A
// change to it would re-create every id-less row a user already has as a duplicate on the next sync.
const COFFEE_HASH = '08f4a334380525bcc08cc3af98156c3a42555f05164440437ebb0d45d8f86fc0';
const COFFEE_ID = `enable_banking:${COFFEE_HASH}`;
const ACCOUNT_ID = 'acc-current';

const coffee = (overrides: Partial<BankSyncTransaction> = {}): BankSyncTransaction => ({ bookingDate: '2026-07-05', creditDebitIndicator: 'debit', creditorName: 'Cafe Central', transactionAmount: { amount: '-3.50', currency: 'EUR' }, ...overrides });

describe('stable ids of id-less rows', () => {
  it('keeps the id every existing row was stored under for the first occurrence, under both prefixes', () => {
    expect(buildStableId(ACCOUNT_ID, coffee(), 'enable_banking')).toBe(COFFEE_ID);
    expect(buildStableId(ACCOUNT_ID, coffee(), 'nordigen')).toBe(`nordigen:${COFFEE_HASH}`);
    const ids = withStableIdOccurrences(ACCOUNT_ID, [coffee()]).map((row) => [buildStableId(ACCOUNT_ID, row, 'enable_banking'), buildStableId(ACCOUNT_ID, row, 'nordigen'), enableBankingTransactionIdFor(ACCOUNT_ID, row)]);
    expect(ids).toEqual([[COFFEE_ID, `nordigen:${COFFEE_HASH}`, COFFEE_ID]]);
  });

  it('numbers the repeats of identical rows in one fetch, under both prefixes', () => {
    const rows = withStableIdOccurrences(ACCOUNT_ID, [coffee(), coffee({ creditorName: 'Bakery' }), coffee(), coffee()]);
    expect(rows.map((row) => buildStableId(ACCOUNT_ID, row, 'nordigen'))).toEqual([`nordigen:${COFFEE_HASH}`, buildStableId(ACCOUNT_ID, coffee({ creditorName: 'Bakery' }), 'nordigen'), `nordigen:${COFFEE_HASH}:1`, `nordigen:${COFFEE_HASH}:2`]);
    expect(rows.map((row) => enableBankingTransactionIdFor(ACCOUNT_ID, row))).toEqual([COFFEE_ID, buildStableId(ACCOUNT_ID, coffee({ creditorName: 'Bakery' }), 'enable_banking'), `${COFFEE_ID}:1`, `${COFFEE_ID}:2`]);
  });

  it('leaves the identity of rows that carry a provider id alone', () => {
    const rows = withStableIdOccurrences(ACCOUNT_ID, [coffee({ entryReference: 'ref-1' }), coffee({ entryReference: 'ref-1' }), coffee({ transactionId: 'tx-1' }), coffee({ transactionId: 'tx-1' })]);
    expect(rows.map((row) => enableBankingTransactionIdFor(ACCOUNT_ID, row))).toEqual(['ref-1', 'ref-1', 'tx-1', 'tx-1']);
    expect(rows.map((row) => buildStableId(ACCOUNT_ID, row, 'nordigen'))).toEqual(['nordigen:ref-1', 'nordigen:ref-1', 'nordigen:tx-1', 'nordigen:tx-1']);
  });
});

describe('syncing identical id-less rows', () => {
  const db = useTestDatabase({ schema: 'migrations' });
  let testAppuserId = 0;

  async function linkedHousehold() {
    const em = db.em();
    const household = await seedHousehold(em);
    testAppuserId = household.appuser.appuserKey;
    if (!(await em.findOne(TransactionType, { name: 'CARD_PAYMENT' }))) em.create(TransactionType, { displayName: 'Card payment', name: 'CARD_PAYMENT' }, { partial: true });
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    household.account.accountId = ACCOUNT_ID;
    household.account.enableBankingConnectionKey = await em.findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: connection.enableBankingConnectionKey });
    await em.persist(household.account).flush();
    return { connection, em, household };
  }

  async function sync(connectionKey: number, feed: { booked?: BankSyncTransaction[]; pending?: BankSyncTransaction[] }) {
    const client = { account: () => ({ getTransactions: () => Promise.resolve({ transactions: { booked: feed.booked ?? [], pending: feed.pending ?? [] } }) }) };
    return service.syncTransactionsForRequisition({ connection: conn(connectionKey, { appuserId: testAppuserId }), fetchWindowDays: 3650 }, { em: db.em(), provider: providerFromClient(client) });
  }

  const storedRows = async () => (await db.em().find(Transaction, { deletedAt: undefined }, { filters: false, orderBy: { transactionKey: 'ASC' }, populate: ['transactionStatusKey'] }));

  it('stores two identical rows from one fetch as two transactions', async () => {
    const { connection } = await linkedHousehold();

    const result = await sync(connection.enableBankingConnectionKey, { booked: [coffee(), coffee()] });

    expect(result).toMatchObject({ transactionsCreated: 2, transactionsSkipped: 0 });
    expect((await storedRows()).map((row) => row.enableBankingTransactionId)).toEqual([COFFEE_ID, `${COFFEE_ID}:1`]);
  });

  it('creates nothing when the same identical rows are fetched again', async () => {
    const { connection } = await linkedHousehold();
    await sync(connection.enableBankingConnectionKey, { booked: [coffee(), coffee()] });
    const before = (await storedRows()).map((row) => row.transactionKey);

    const result = await sync(connection.enableBankingConnectionKey, { booked: [coffee(), coffee()] });

    expect(result.transactionsCreated).toBe(0);
    expect((await storedRows()).map((row) => row.transactionKey)).toEqual(before);
  });

  it('matches a row stored under the bare hash before occurrences existed instead of duplicating it', async () => {
    const { connection, em, household } = await linkedHousehold();
    const legacy = await addTransaction(em, household, { amount: -3.5, date: new Date('2026-07-05T00:00:00Z'), enableBankingTransactionId: COFFEE_ID, status: 'BOOKED' });

    const once = await sync(connection.enableBankingConnectionKey, { booked: [coffee()] });
    expect(once.transactionsCreated).toBe(0);
    expect((await storedRows()).map((row) => [row.transactionKey, row.enableBankingTransactionId])).toEqual([[legacy.transactionKey, COFFEE_ID]]);

    // The bank also had a second, identical purchase that the bare hash collapsed into the first:
    // it is stored now, and the user's row keeps its identity.
    const twice = await sync(connection.enableBankingConnectionKey, { booked: [coffee(), coffee()] });
    expect(twice.transactionsCreated).toBe(1);
    expect((await storedRows()).map((row) => [row.transactionKey === legacy.transactionKey, row.enableBankingTransactionId])).toEqual([[true, COFFEE_ID], [false, `${COFFEE_ID}:1`]]);
  });

  it('keeps a stored repeat the next fetch no longer reports, and audits it for review', async () => {
    const { connection } = await linkedHousehold();
    await sync(connection.enableBankingConnectionKey, { booked: [coffee(), coffee()] });
    const [, repeat] = await storedRows();
    expect(repeat?.enableBankingTransactionId).toBe(`${COFFEE_ID}:1`);

    const result = await sync(connection.enableBankingConnectionKey, { booked: [coffee()] });

    expect(result.transactionsCreated).toBe(0);
    const rows = await storedRows();
    expect(rows.map((row) => [row.enableBankingTransactionId, row.transactionStatusKey?.name])).toEqual([[COFFEE_ID, 'BOOKED'], [`${COFFEE_ID}:1`, 'BOOKED']]);
    const audits = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.DEDUP_SKIPPED, transactionKey: repeat }, { filters: false });
    expect(audits.some((audit) => audit.source === 'account-initial-sync:occurrence-missing')).toBe(true);
  });

  it('stores identical pending rows separately and keeps both while the feed still reports them', async () => {
    const { connection } = await linkedHousehold();
    // Old enough that a pending the feed no longer reports would expire.
    const hold = coffee({ bookingDate: undefined, valueDate: '2026-01-05' });

    const first = await sync(connection.enableBankingConnectionKey, { pending: [hold, hold] });
    expect(first.transactionsCreated).toBe(2);

    const again = await sync(connection.enableBankingConnectionKey, { pending: [hold, hold] });
    expect(again.transactionsCreated).toBe(0);
    expect((await storedRows()).map((row) => row.transactionStatusKey?.name)).toEqual(['PENDING', 'PENDING']);
  });
});
