import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: false, reason: 'none' }) } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

import service, { type BankSyncTransaction } from '../account-initial-sync-transaction.service';

/*
 * A synced row in a currency WonderMoney has no rate for keeps its own amount, and stores no
 * amount in the user's currency: 10,000 JPY is never 10,000 EUR.
 */
describe('bank sync: rows in a currency with no exchange rate', () => {
  const db = useTestDatabase();

  async function linkedAccount(currencyCode: string, opts: { rate?: number } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['DEPOSIT', 'PAYMENT', 'CARD_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    const currency = await currencyFor(em, currencyCode);
    if (opts.rate !== undefined) em.create(ExchangeRate, { date: new Date('2026-06-30T00:00:00Z'), fromCurrency: currency, rate: opts.rate, toCurrency: household.currency }, { partial: true });
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: household.appuser, aspspCountry: 'JP', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household, { balance: 10_000, currency, name: 'Tokyo' });
    // What the account phase stores for a balance it cannot convert.
    if (currencyCode !== 'EUR' && opts.rate === undefined) account.fxStatus = FxStatus.MISSING;
    account.accountId = 'acc-foreign';
    account.enableBankingConnectionKey = connection;
    await em.flush();
    return { connection, household };
  }

  async function sync(connectionKey: number, currencyCode: string) {
    const feed: BankSyncTransaction[] = [{ bookingDate: '2026-07-02', creditDebitIndicator: 'debit', entryReference: 'ramen', transactionAmount: { amount: '-10000', currency: currencyCode } }];
    const client = { account: () => ({ getTransactions: () => Promise.resolve({ transactions: { booked: feed, pending: [] } }) }) };
    await service.syncTransactionsForRequisition({ enableBankingConnectionKey: connectionKey, fetchWindowDays: 3650 }, { em: db.em(), enableBankingSyncAdapterFactory: () => Promise.resolve(client) });
    return db.em().findOneOrFail(Transaction, { enableBankingTransactionId: { $ne: null } }, { filters: false });
  }

  it('stores no converted amount and marks the row missing', async () => {
    const { connection } = await linkedAccount('JPY');

    const row = await sync(connection.enableBankingConnectionKey, 'JPY');

    expect(row).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING, settlementAmount: -10_000 });
    expect(row.appuserCurrencyBalance).toBeNull();
  });

  it('converts at the stored rate and marks the row exact', async () => {
    const { connection } = await linkedAccount('USD', { rate: 0.9 });

    const row = await sync(connection.enableBankingConnectionKey, 'USD');

    expect(row).toMatchObject({ appuserSettlementAmount: -9000, fxStatus: FxStatus.EXACT });
  });

  it('marks a same-currency row exact', async () => {
    const { connection } = await linkedAccount('EUR');

    const row = await sync(connection.enableBankingConnectionKey, 'EUR');

    expect(row).toMatchObject({ appuserSettlementAmount: -10_000, fxStatus: FxStatus.EXACT });
  });
});
