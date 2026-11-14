import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: false, reason: 'none' }) } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addCategory, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionSplit } from '@entity/TransactionSplit';
import { TransactionType } from '@entity/TransactionType';
import { connectionRef as conn, providerFromClient } from '@service/bank-providers/__tests__/helpers';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';

import service, { type BankSyncTransaction } from '../account-initial-sync-transaction.service';

/*
 * The bank can report a transaction again after the user split it: unchanged, settled from
 * pending, or with a new amount (a tip, a currency settlement). The split survives an unchanged
 * amount untouched; a new amount rescales the lines and sends the row back to the review inbox.
 * The split never adds or removes a transaction row, so dedup and the balance are unaffected.
 */
describe('bank sync of a split transaction', () => {
  const db = useTestDatabase();
  let testAppuserId = 0;

  async function linkedAccount() {
    const em = db.em();
    const household = await seedHousehold(em);
    testAppuserId = household.appuser.appuserKey;
    for (const name of ['DEPOSIT', 'PAYMENT', 'CARD_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household, { balance: 1000, name: 'Current' });
    account.accountId = 'acc-split';
    account.enableBankingConnectionKey = connection;
    const groceries = await addCategory(em, household, 'Groceries');
    const homeware = await addCategory(em, household, 'Homeware');
    await em.flush();
    return { connection, groceries, homeware, household };
  }

  const row = (amount: string, booked = true): BankSyncTransaction => ({ bookingDate: '2026-07-02', creditDebitIndicator: 'debit', entryReference: 'shop-1', transactionAmount: { amount, currency: 'EUR' }, ...(booked ? {} : { status: 'PDNG' }) });

  async function sync(connectionKey: number, feed: { booked?: BankSyncTransaction[]; pending?: BankSyncTransaction[] }) {
    const client = { account: () => ({ getTransactions: () => Promise.resolve({ transactions: { booked: feed.booked ?? [], pending: feed.pending ?? [] } }) }) };
    await service.syncTransactionsForRequisition({ connection: conn(connectionKey, { appuserId: testAppuserId }), fetchWindowDays: 3650 }, { em: db.em(), provider: providerFromClient(client) });
    return db.em().find(Transaction, { enableBankingTransactionId: { $ne: null } }, { filters: false });
  }

  async function split(household: Household, transaction: Transaction, lines: { amount: number; categoryKey: number }[]) {
    await db.em().nativeUpdate(Transaction, { transactionKey: transaction.transactionKey }, { reviewed: true });
    await setTransactionSplits(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, transaction.transactionKey, lines);
  }

  const liveAmounts = async (transactionKey: number) => (await db.em().find(TransactionSplit, { transactionKey: { transactionKey } }, { filters: false, orderBy: { position: 'asc' } })).filter((line) => !line.deletedAt).map((line) => line.amount);

  it('keeps the split and the review state when the bank reports the same amount', async () => {
    const { connection, groceries, homeware, household } = await linkedAccount();
    const [stored] = await sync(connection.enableBankingConnectionKey, { booked: [row('-100')] });
    await split(household, stored!, [{ amount: -60, categoryKey: groceries.categoryKey }, { amount: -40, categoryKey: homeware.categoryKey }]);

    const after = await sync(connection.enableBankingConnectionKey, { booked: [row('-100')] });

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ reviewed: true, settlementAmount: -100 });
    expect(await liveAmounts(stored!.transactionKey)).toEqual([-60, -40]);
  });

  it('rescales the lines and marks the row unreviewed when the bank reports a new amount', async () => {
    const { connection, groceries, homeware, household } = await linkedAccount();
    const [stored] = await sync(connection.enableBankingConnectionKey, { booked: [row('-100')] });
    await split(household, stored!, [{ amount: -60, categoryKey: groceries.categoryKey }, { amount: -40, categoryKey: homeware.categoryKey }]);

    const after = await sync(connection.enableBankingConnectionKey, { booked: [row('-110')] });

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ reviewed: false, settlementAmount: -110 });
    expect(await liveAmounts(stored!.transactionKey)).toEqual([-66, -44]);
    const audit = await db.em().find(TransactionAuditLog, { actorType: TransactionAuditActorType.SYNC, source: 'transaction-splits-rescale' }, { filters: false });
    expect(audit.map((entry) => entry.changes?.['splits'])).toEqual([{ from: [{ amount: -60, categoryKey: groceries.categoryKey }, { amount: -40, categoryKey: homeware.categoryKey }], to: [{ amount: -66, categoryKey: groceries.categoryKey }, { amount: -44, categoryKey: homeware.categoryKey }] }]);
  });

  it('follows a pending row that settles at another amount', async () => {
    const { connection, groceries, homeware, household } = await linkedAccount();
    const [pending] = await sync(connection.enableBankingConnectionKey, { pending: [row('-100', false)] });
    await split(household, pending!, [{ amount: -50, categoryKey: groceries.categoryKey }, { amount: -50, categoryKey: homeware.categoryKey }]);

    const after = await sync(connection.enableBankingConnectionKey, { booked: [row('-90')] });

    expect(after.filter((transaction) => !transaction.deletedAt)).toHaveLength(1);
    expect(await liveAmounts(pending!.transactionKey)).toEqual([-45, -45]);
  });
});
