import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Transaction } from '@entity/Transaction';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';

import { createInitialEnableBankingAccounts } from '../enable-banking-initial-accounts.service';

/*
 * Reconnecting a bank (a fresh consent after the old one expired, was about to, or was ended by the
 * bank) starts a new Enable Banking session, and the bank may give every account a new `uid`. The
 * user must keep the account rows they already have, with their transaction history, instead of
 * getting a second copy of each account.
 */
describe('reconnecting an Enable Banking bank', () => {
  const db = useTestDatabase();

  const BANK = { country: 'PT', name: 'Test Bank' };
  const IBAN = 'PT50000201231234567890154';
  const DAY = 24 * 60 * 60 * 1000;

  let sequence = 0;

  async function institution(em: EntityManager) {
    const id = buildEnableBankingInstitutionRecordId(BANK);
    const existing = await em.findOne(AccountFinancialInstitution, { id });
    if (existing) return existing;
    const created = em.create(AccountFinancialInstitution, { displayName: BANK.name, id, name: BANK.name, provider: AccountFinancialInstitutionProvider.ENABLE_BANKING }, { partial: true });
    await em.flush();
    return created;
  }

  async function connection(em: EntityManager, household: Household, input: { accessValidUntil: Date; status: EnableBankingConnectionStatus }) {
    sequence += 1;
    const credential = em.create(EnableBankingCredential, {
      applicationId: `app-${sequence}`,
      appuserKey: household.appuser,
      encryptionKeyVersion: 1,
      privateKeyAuthTag: 'tag',
      privateKeyCiphertext: 'ciphertext',
      privateKeyIv: 'iv',
      tenantKey: household.tenant,
    }, { partial: true });
    const created = em.create(EnableBankingConnection, {
      accessValidUntil: input.accessValidUntil,
      appuserKey: household.appuser,
      aspspCountry: BANK.country,
      aspspName: BANK.name,
      enableBankingCredentialKey: credential,
      sessionId: `session-${sequence}`,
      state: `state-${sequence}`,
      status: input.status,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    return created;
  }

  /** A household whose bank consent the bank ended early, with one synced account and its history. */
  async function householdWithEndedConsent() {
    const em = db.em();
    const household = await seedHousehold(em);
    const oldConnection = await connection(em, household, { accessValidUntil: new Date(Date.now() + 90 * DAY), status: EnableBankingConnectionStatus.EXPIRED });
    const account = em.create(Account, {
      accountFinancialInstitutionKey: await institution(em),
      accountId: 'old-uid',
      accountName: 'Checking',
      accountNumber: IBAN,
      accountOwnerAppuserKey: household.appuser,
      balance: 500,
      closed: false,
      currencyKey: household.currency,
      enableBankingConnectionKey: oldConnection,
      isPrivate: false,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    await addTransaction(em, household, { account, amount: -20, date: new Date('2026-06-01T12:00:00Z'), enableBankingTransactionId: 'tx-1', status: 'BOOKED' });
    await addTransaction(em, household, { account, amount: 900, date: new Date('2026-06-02T12:00:00Z'), enableBankingTransactionId: 'tx-2', status: 'BOOKED' });
    return { account, household, oldConnection };
  }

  async function reconnect(household: Household, sessionAccounts: unknown[]) {
    const em = db.em();
    const fresh = await connection(em, household, { accessValidUntil: new Date(Date.now() + 180 * DAY), status: EnableBankingConnectionStatus.LINKED });
    const result = await createInitialEnableBankingAccounts(em, fresh, sessionAccounts);
    return { newConnection: fresh, result };
  }

  async function accountsOf(household: Household) {
    return db.em().find(Account, { accountNumber: IBAN, accountOwnerAppuserKey: household.appuser, deletedAt: null }, { orderBy: { accountKey: 'asc' } });
  }

  it('keeps the same account row and its transaction history when the bank issues a new account uid', async () => {
    const { account, household, oldConnection } = await householdWithEndedConsent();

    const { newConnection, result } = await reconnect(household, [{ account_id: { iban: IBAN }, currency: 'EUR', name: 'Checking', uid: 'new-uid' }]);

    expect(result.accountsCreated).toBe(1);
    const accounts = await accountsOf(household);
    expect(accounts.map((row) => row.accountKey)).toEqual([account.accountKey]);
    expect(accounts[0]?.accountId).toBe('new-uid');
    expect(accounts[0]?.enableBankingConnectionKey?.enableBankingConnectionKey).toBe(newConnection.enableBankingConnectionKey);
    expect(await db.em().count(Transaction, { accountKey: account })).toBe(2);
    // Every account moved to the new connection, so the old one leaves the connections list.
    const retired = await db.em().findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: oldConnection.enableBankingConnectionKey });
    expect(retired.deletedAt).toBeInstanceOf(Date);
  });

  it('keeps the old connection while it still holds an account the new consent did not include', async () => {
    const { household, oldConnection } = await householdWithEndedConsent();
    const em = db.em();
    em.create(Account, {
      accountFinancialInstitutionKey: await institution(em),
      accountId: 'savings-uid',
      accountName: 'Savings',
      accountNumber: 'PT50000201239999999999999',
      accountOwnerAppuserKey: household.appuser,
      balance: 0,
      closed: false,
      currencyKey: household.currency,
      enableBankingConnectionKey: oldConnection,
      isPrivate: false,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();

    await reconnect(household, [{ account_id: { iban: IBAN }, currency: 'EUR', name: 'Checking', uid: 'new-uid' }]);

    const kept = await db.em().findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: oldConnection.enableBankingConnectionKey });
    expect(kept.deletedAt).toBeFalsy();
  });

  it('creates a separate account for another currency behind the same IBAN', async () => {
    const { account, household } = await householdWithEndedConsent();
    await currencyFor(db.em(), 'USD');

    await reconnect(household, [
      { account_id: { iban: IBAN }, currency: 'EUR', name: 'Checking', uid: 'new-eur' },
      { account_id: { iban: IBAN }, currency: 'USD', name: 'Checking USD', uid: 'new-usd' },
    ]);

    const accounts = await accountsOf(household);
    expect(accounts).toHaveLength(2);
    expect(accounts.find((row) => row.accountKey === account.accountKey)?.accountId).toBe('new-eur');
  });

  it('never takes over an account with the same IBAN that belongs to another household', async () => {
    const { account: neighboursAccount } = await householdWithEndedConsent();
    const em = db.em();
    const household = await seedHousehold(em);

    await reconnect(household, [{ account_id: { iban: IBAN }, currency: 'EUR', name: 'Checking', uid: 'my-uid' }]);

    const neighbours = await db.em().findOneOrFail(Account, { accountKey: neighboursAccount.accountKey });
    expect(neighbours.accountId).toBe('old-uid');
    expect(await accountsOf(household)).toHaveLength(1);
  });

  it('does not bring back an account the user removed', async () => {
    const { account, household } = await householdWithEndedConsent();
    const em = db.em();
    const removed = await em.findOneOrFail(Account, { accountKey: account.accountKey });
    removed.deletedAt = new Date();
    await em.flush();

    await reconnect(household, [{ account_id: { iban: IBAN }, currency: 'EUR', name: 'Checking', uid: 'new-uid' }]);

    const stillRemoved = await db.em().findOneOrFail(Account, { accountKey: account.accountKey });
    expect(stillRemoved.deletedAt).toBeInstanceOf(Date);
    expect((await accountsOf(household)).map((row) => row.accountKey)).not.toContain(account.accountKey);
  });
});
