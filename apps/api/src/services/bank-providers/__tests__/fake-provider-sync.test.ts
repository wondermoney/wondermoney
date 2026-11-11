import { describe, expect, it } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import accountInitialSyncAccountService from '@service/account/account-initial-sync-account.service';
import accountInitialSyncTransactionService from '@service/account/account-initial-sync-transaction.service';
import { runBankSyncPhases } from '@service/bank-sync-run/bank-sync-run';

import type { BankProvider } from '../types';

/**
 * The seam, end to end: a provider that is not Enable Banking runs the real account and
 * transaction phases through the real database. Nothing in the sync services knows the provider's
 * name; this fake implements only the interface.
 */
describe('a fake provider runs a full sync through the interface', () => {
  const db = useTestDatabase();

  const fakeProvider: BankProvider = {
    completeConnection: () => Promise.resolve({ accountsCreated: 0, bankConnectionKey: 0 }),
    getBalances: () => Promise.resolve([{ balanceAmount: { amount: '1000.00' }, balanceType: 'closingBooked' }]),
    getSessionStatus: () => Promise.resolve('active'),
    getTransactions: () => Promise.resolve({
      booked: [
        {
          bookingDate: '2026-07-01',
          creditDebitIndicator: 'debit',
          entryReference: 'fake-tx-1',
          remittanceInformationUnstructured: 'Coffee',
          transactionAmount: { amount: '-10.00', currency: 'EUR' },
        },
        {
          bookingDate: '2026-07-02',
          creditDebitIndicator: 'credit',
          entryReference: 'fake-tx-2',
          remittanceInformationUnstructured: 'Salary',
          transactionAmount: { amount: '2500.00', currency: 'EUR' },
        },
      ],
      pending: [],
    }),
    id: 'fake',
    institutionProvider: AccountFinancialInstitutionProvider.OTHER,
    listAccounts: () => Promise.resolve({
      accounts: [{ currency: 'EUR', externalId: 'fake-acc-1', iban: 'PT50000000000000000000001', institutionId: 'fake-bank', name: 'Fake checking', ownerName: 'Fake Owner' }],
      institutionId: 'fake-bank',
    }),
    listInstitutions: () => Promise.resolve([]),
    startConnection: () => Promise.resolve({ redirectUrl: 'https://bank.example/consent' }),
    transactionIdentity: { column: 'enableBankingTransactionId', prefix: 'enable_banking' },
  };

  it('creates the account and its transactions with no Enable Banking code in the path', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    const connection = new BankConnection();
    connection.provider = 'fake';
    connection.appuserKey = household.appuser;
    connection.tenantKey = household.tenant;
    connection.externalId = 'fake-session';
    connection.status = BankConnectionStatus.LINKED;
    connection.accessValidUntil = new Date('2027-01-01T00:00:00Z');
    em.persist(connection);
    await em.flush();

    const result = await runBankSyncPhases({
      accountService: accountInitialSyncAccountService,
      connection: {
        appuserId: household.appuser.appuserKey,
        bankConnectionKey: connection.bankConnectionKey,
        externalId: 'fake-session',
        provider: 'fake',
        status: BankConnectionStatus.LINKED,
        tenantId: household.tenant.tenantKey,
      },
      correlationId: 'fake-correlation',
      fetchWindowDays: 365,
      provider: fakeProvider,
      queueJobId: 'fake-job',
      transactionService: accountInitialSyncTransactionService,
    });

    expect(result.status).toBe('full_success');
    const account = await db.em().findOneOrFail(Account, { accountId: 'fake-acc-1' }, { populate: ['accountFinancialInstitutionKey'] });
    expect(account).toMatchObject({ accountName: 'Fake checking', balance: 1000 });
    expect(account.bankConnectionKey?.bankConnectionKey).toBe(connection.bankConnectionKey);
    expect(account.accountFinancialInstitutionKey?.provider).toBe(AccountFinancialInstitutionProvider.OTHER);

    const transactions = await db.em().find(Transaction, { accountKey: account }, { filters: false, orderBy: { transactionDate: 'ASC' } });
    expect(transactions).toHaveLength(2);
    expect(transactions.map((row) => ({ amount: row.settlementAmount, id: row.enableBankingTransactionId }))).toEqual([
      { amount: -10, id: 'fake-tx-1' },
      { amount: 2500, id: 'fake-tx-2' },
    ]);
  });
});
