import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/transaction/transaction-deterministic-categorization.service', () => ({ default: { categorizeTransactionDeterministically: vi.fn().mockResolvedValue({ assigned: false, reason: 'none' }) } }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { reportFiltersSchema } from '@validators/reports';

import service, { type BankSyncTransaction } from '../account-initial-sync-transaction.service';

/*
 * Reports leave transfers out by default, so a credit typed TRANSFER_IN is never income. A credit
 * is income unless it is the other half of a transfer between two of the household's accounts.
 */
describe('bank sync: incoming money is income unless it is an own-account transfer', () => {
  const db = useTestDatabase();
  const JULY = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  async function linkedHousehold() {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['DEPOSIT', 'PAYMENT', 'CARD_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const current = household.account;
    const savings = await addAccount(em, household, { name: 'Savings' });
    for (const [account, accountId] of [[current, 'acc-current'], [savings, 'acc-savings']] as const) {
      const managed = await em.findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: connection.enableBankingConnectionKey });
      account.accountId = accountId;
      account.enableBankingConnectionKey = managed;
      em.persist(account);
    }
    await em.flush();
    return { connection, current, household, savings };
  }

  const credit = (entryReference: string, amount: string, bookingDate: string): BankSyncTransaction => ({ bookingDate, creditDebitIndicator: 'credit', entryReference, transactionAmount: { amount, currency: 'EUR' } });
  const debit = (entryReference: string, amount: string, bookingDate: string): BankSyncTransaction => ({ bookingDate, creditDebitIndicator: 'debit', entryReference, transactionAmount: { amount: `-${amount}`, currency: 'EUR' } });

  const feed: Record<string, BankSyncTransaction[]> = {
    'acc-current': [credit('salary', '2000.00', '2026-07-01'), debit('to-savings', '500.00', '2026-07-03'), debit('groceries', '40.00', '2026-07-05')],
    'acc-savings': [credit('from-current', '500.00', '2026-07-04')],
  };

  async function sync(connectionKey: number) {
    const client = { account: (accountId: string) => ({ getTransactions: () => Promise.resolve({ transactions: { booked: feed[accountId] ?? [], pending: [] } }) }) };
    // A ten-year fetch window, so the fixed July 2026 rows stay inside it whenever this runs.
    return service.syncTransactionsForRequisition({ enableBankingConnectionKey: connectionKey, fetchWindowDays: 3650 }, { em: db.em(), enableBankingSyncAdapterFactory: () => Promise.resolve(client) });
  }

  async function typesByReference(): Promise<Record<string, string | undefined>> {
    const rows: Transaction[] = await db.em().find(Transaction, {}, { filters: false, populate: ['transactionTypeKey'] });
    return Object.fromEntries(rows.map((row) => [row.enableBankingTransactionId ?? '', row.transactionTypeKey?.name]));
  }

  /** The cash-flow report with the default filters, as web and mobile send them: transfers excluded. */
  function cashflow(household: Household) {
    return getCashflowReport({ filters: reportFiltersSchema.parse(JULY), tenant: household.tenant, user: household.appuser });
  }

  it('stores a salary as a deposit and the two halves of a transfer to savings as a transfer pair', async () => {
    const { connection } = await linkedHousehold();

    await sync(connection.enableBankingConnectionKey);

    expect(await typesByReference()).toEqual({ 'from-current': 'TRANSFER_IN', groceries: 'PAYMENT', salary: 'DEPOSIT', 'to-savings': 'TRANSFER_OUT' });
  });

  it('counts the salary as income in the cash-flow report, and leaves the transfer out', async () => {
    const { connection, household } = await linkedHousehold();

    await sync(connection.enableBankingConnectionKey);

    expect(await cashflow(household)).toEqual([expect.objectContaining({ expenses: 40, income: 2000, net: 1960 })]);
  });

  it('keeps the pair on the next sync, which re-fetches the same rows', async () => {
    const { connection, household } = await linkedHousehold();
    await sync(connection.enableBankingConnectionKey);

    await sync(connection.enableBankingConnectionKey);

    expect(await typesByReference()).toEqual({ 'from-current': 'TRANSFER_IN', groceries: 'PAYMENT', salary: 'DEPOSIT', 'to-savings': 'TRANSFER_OUT' });
    expect(await cashflow(household)).toEqual([expect.objectContaining({ income: 2000 })]);
  });

  it('re-types a salary stored as a transfer when the sync fetches it again', async () => {
    const { connection, current, household } = await linkedHousehold();
    await storeLegacyCredit(current, household, 'salary', 2000, '2026-07-01');

    await sync(connection.enableBankingConnectionKey);

    expect(await typesByReference()).toMatchObject({ salary: 'DEPOSIT' });
    expect(await cashflow(household)).toEqual([expect.objectContaining({ income: 2000 })]);
  });

  async function storeLegacyCredit(account: Account, household: Household, entryReference: string, amount: number, date: string) {
    const em = db.em();
    const transferIn = await em.findOneOrFail(TransactionType, { name: 'TRANSFER_IN' });
    em.create(Transaction, { accountKey: account, appuserKey: household.appuser, appuserSettlementAmount: amount, enableBankingTransactionId: entryReference, originalAmount: amount, settlementAmount: amount, settlementCurrencyKey: household.currency, tenantKey: household.tenant, transactionDate: new Date(`${date}T00:00:00Z`), transactionStatusKey: household.statuses.BOOKED, transactionTypeKey: transferIn }, { partial: true });
    await em.flush();
  }
});
