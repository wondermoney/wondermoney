import { describe, expect, it } from 'vitest';

import { addAccount, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';

import { backfillBankConnections } from '../bank-connection-backfill.service';

/*
 * Existing Enable Banking connections move onto the provider-agnostic `bank_connection` table on
 * start-up. The move is transactional and idempotent: each Enable Banking row gets one generic
 * row, every account still pointing only at the legacy column is stamped, and a second run is a
 * no-op.
 */
describe('bank connection backfill', () => {
  const db = useTestDatabase();

  async function seedEnableBankingConnection() {
    const em = db.em();
    const household = await seedHousehold(em);
    const credential = em.create(EnableBankingCredential, {
      applicationId: `app-${household.appuser.appuserKey}`,
      appuserKey: household.appuser,
      encryptionKeyVersion: 1,
      privateKeyAuthTag: 'tag',
      privateKeyCiphertext: 'cipher',
      privateKeyIv: 'iv',
      tenantKey: household.tenant,
    }, { partial: true });
    const connection = em.create(EnableBankingConnection, {
      accessValidUntil: new Date('2027-01-01T00:00:00Z'),
      appuserKey: household.appuser,
      aspspCountry: 'PT',
      aspspName: 'Bank',
      enableBankingCredentialKey: credential,
      sessionId: 'session-1',
      state: 'state-1',
      status: EnableBankingConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household, { name: 'Legacy bank account' });
    account.enableBankingConnectionKey = connection;
    await em.flush();
    return { account, connection, household };
  }

  it('creates one BankConnection per Enable Banking row and stamps its accounts', async () => {
    const { account, connection } = await seedEnableBankingConnection();

    const result = await backfillBankConnections(db.em());

    expect(result).toEqual({ accountsStamped: 1, connectionsCreated: 1 });
    const bankConnection = await db.em().findOneOrFail(BankConnection, { externalId: 'session-1', provider: 'enable_banking' });
    expect(bankConnection).toMatchObject({
      accessValidUntil: new Date('2027-01-01T00:00:00Z'),
      provider: 'enable_banking',
      status: 'linked',
    });
    const storedConnection = await db.em().findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: connection.enableBankingConnectionKey });
    expect(storedConnection.bankConnectionKey?.bankConnectionKey).toBe(bankConnection.bankConnectionKey);
    const storedAccount = await db.em().findOneOrFail(Account, { accountKey: account.accountKey });
    expect(storedAccount.bankConnectionKey?.bankConnectionKey).toBe(bankConnection.bankConnectionKey);
  });

  it('is idempotent: a second run creates nothing and stamps nothing', async () => {
    await seedEnableBankingConnection();

    const first = await backfillBankConnections(db.em());
    const second = await backfillBankConnections(db.em());

    expect(first).toEqual({ accountsStamped: 1, connectionsCreated: 1 });
    expect(second).toEqual({ accountsStamped: 0, connectionsCreated: 0 });
    expect(await db.em().count(BankConnection, {})).toBe(1);
  });

  it('never overwrites an account already stamped with a generic connection', async () => {
    const { account, connection } = await seedEnableBankingConnection();
    const other = new BankConnection();
    other.provider = 'other';
    other.appuserKey = connection.appuserKey;
    other.status = BankConnectionStatus.LINKED;
    const em = db.em();
    em.persist(other);
    await em.flush();
    account.bankConnectionKey = other;
    await em.flush();

    const result = await backfillBankConnections(db.em());

    expect(result.accountsStamped).toBe(0);
    const storedAccount = await db.em().findOneOrFail(Account, { accountKey: account.accountKey });
    expect(storedAccount.bankConnectionKey?.bankConnectionKey).toBe(other.bankConnectionKey);
  });
});
