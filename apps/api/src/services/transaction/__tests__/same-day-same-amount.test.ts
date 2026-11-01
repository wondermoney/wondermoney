import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: false, reason: 'none' }) } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import service, { type BankSyncTransaction } from '@service/account/account-initial-sync-transaction.service';

import { transactionCreationService } from '../transaction-creation.service';

/*
 * Two purchases of the same amount on the same day are two transactions. The schema is built by
 * the real migrations, so whatever a fresh install enforces is enforced here too.
 */
describe('transactions on the same account, day and amount', () => {
  const db = useTestDatabase({ schema: 'migrations' });

  async function linkedHousehold() {
    const em = db.em();
    const household = await seedHousehold(em);
    if (!(await em.findOne(TransactionType, { name: 'CARD_PAYMENT' }))) em.create(TransactionType, { displayName: 'Card payment', name: 'CARD_PAYMENT' }, { partial: true });
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    household.account.accountId = 'acc-current';
    household.account.enableBankingConnectionKey = await em.findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: connection.enableBankingConnectionKey });
    await em.persist(household.account).flush();
    return { connection, household };
  }

  const coffee = (entryReference: string): BankSyncTransaction => ({ bookingDate: '2026-07-05', creditDebitIndicator: 'debit', entryReference, transactionAmount: { amount: '-3.50', currency: 'EUR' } });

  it('stores both when the bank reports them under different ids', async () => {
    const { connection } = await linkedHousehold();
    const client = { account: () => ({ getTransactions: () => Promise.resolve({ transactions: { booked: [coffee('coffee-1'), coffee('coffee-2')], pending: [] } }) }) };

    const result = await service.syncTransactionsForRequisition({ enableBankingConnectionKey: connection.enableBankingConnectionKey, fetchWindowDays: 3650 }, { em: db.em(), enableBankingSyncAdapterFactory: () => Promise.resolve(client) });

    expect(result).toMatchObject({ transactionsCreated: 2, transactionsSkipped: 0 });
    const stored = await db.em().find(Transaction, {}, { filters: false });
    expect(stored.map((row) => row.enableBankingTransactionId).sort()).toEqual(['coffee-1', 'coffee-2']);
  });

  it('creates a second identical manual entry instead of rejecting it', async () => {
    const household = await seedHousehold(db.em());
    const entry = {
      accountId: household.account.accountKey,
      appuserKey: household.appuser.appuserKey,
      settlementAmount: -3.5,
      settlementCurrencyId: household.currency.currencyKey,
      transactionDate: new Date('2026-07-05T00:00:00Z'),
      transactionMerchantName: 'Cafe',
      transactionTypeId: household.types.cardPayment.transactionTypeKey,
    };

    await transactionCreationService.createTransaction(entry);
    await transactionCreationService.createTransaction(entry);

    expect(await db.em().count(Transaction, { accountKey: household.account }, { filters: false })).toBe(2);
  });
});
