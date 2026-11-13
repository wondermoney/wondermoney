import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});

import { currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import accountInitialSyncAccountService from '@service/account/account-initial-sync-account.service';
import accountInitialSyncTransactionService from '@service/account/account-initial-sync-transaction.service';
import { classifyBankSyncError, runBankSyncPhases } from '@service/bank-sync-run/bank-sync-run';
import { ACCESS_URL, accountSetV1, accountSetV2, at, fakeSimplefinServer, publicResolver } from '@service/simplefin/__tests__/fixtures';
import { encryptAccessUrl } from '@service/simplefin/simplefin-credential';

import { bankConnectionRef } from '../registry';
import { SimplefinProvider } from '../simplefin.provider';

/*
 * SimpleFIN end to end through the real account and transaction phases and the real database,
 * against a recorded (synthetic) account set served in memory. No request leaves the process.
 */
describe('SimpleFIN syncs through the provider interface', () => {
  const db = useTestDatabase();
  const NOW = new Date('2026-11-11T09:00:00Z');

  async function linkSimplefin(household: Household) {
    const em = db.em();
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    await currencyFor(em, 'USD');
    await currencyFor(em, 'CAD');
    const connection = em.create(BankConnection, { appuserKey: household.appuser, externalId: `simplefin:${household.tenant.tenantKey}`, provider: 'simplefin', status: BankConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    em.create(SimplefinConnection, { ...encryptAccessUrl(ACCESS_URL), appuserKey: household.appuser, bankConnectionKey: connection, serverHost: 'beta-bridge.simplefin.org', tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return connection;
  }

  async function sync(connection: BankConnection, provider: SimplefinProvider, fetchWindowDays = 365) {
    const row = await db.em().findOneOrFail(BankConnection, { bankConnectionKey: connection.bankConnectionKey });
    return runBankSyncPhases({
      accountService: accountInitialSyncAccountService,
      connection: bankConnectionRef(row),
      correlationId: `simplefin-${connection.bankConnectionKey}`,
      fetchWindowDays,
      provider,
      queueJobId: 'job',
      transactionService: accountInitialSyncTransactionService,
    });
  }

  const providerFor = (server: ReturnType<typeof fakeSimplefinServer>, now = NOW) => new SimplefinProvider({ fetch: server.fetch, now: () => now, resolver: publicResolver });

  async function storedRows(accountId: string) {
    const account = await db.em().findOneOrFail(Account, { accountId }, { filters: false });
    return db.em().find(Transaction, { accountKey: account }, { filters: false, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' }, populate: ['transactionStatusKey'] });
  }

  it('creates the accounts, balances and transactions from one request', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);
    const server = fakeSimplefinServer();

    const result = await sync(connection, providerFor(server));

    expect(result.status).toBe('full_success');
    expect(server.calls).toHaveLength(1);
    // The first sync reads the most the Bridge serves in one request: 89 days.
    const startDate = Number(new URL(server.calls[0]?.url ?? '').searchParams.get('start-date'));
    expect(NOW.getTime() / 1000 - startDate).toBe(89 * 24 * 60 * 60);

    const checking = await db.em().findOneOrFail(Account, { accountId: 'ACT-CHECKING-1' }, { filters: false, populate: ['accountFinancialInstitutionKey', 'currencyKey'] });
    expect(checking).toMatchObject({ accountName: 'Everyday Checking', balance: 1234.56 });
    expect(checking.currencyKey.code).toBe('USD');
    expect(checking.openingBalanceDate?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(checking.accountFinancialInstitutionKey).toMatchObject({ displayName: 'Example Bank', id: 'simplefin:examplebank.test', provider: AccountFinancialInstitutionProvider.SIMPLEFIN });
    expect(checking.bankConnectionKey?.bankConnectionKey).toBe(connection.bankConnectionKey);
    const card = await db.em().findOneOrFail(Account, { accountId: 'ACT-CARD-1' }, { filters: false });
    expect(card.balance).toBe(-310);

    const rows = await storedRows('ACT-CHECKING-1');
    expect(rows.map((row) => ({ amount: row.settlementAmount, id: row.nordigenInternalTransactionId, status: row.transactionStatusKey?.name }))).toEqual([
      { amount: -42.1, id: 'simplefin:TRN-1001', status: 'BOOKED' },
      { amount: 2500, id: 'simplefin:TRN-1002', status: 'BOOKED' },
      { amount: -15, id: 'simplefin:TRN-1003', status: 'PENDING' },
    ]);

    const detail = await db.em().findOneOrFail(SimplefinConnection, { bankConnectionKey: { bankConnectionKey: connection.bankConnectionKey } }, { filters: false });
    expect(detail).toMatchObject({ institutionId: 'simplefin:examplebank.test', institutionName: 'Example Bank' });
    const institutions = await providerFor(server).describeInstitutions(db.em(), [connection.bankConnectionKey]);
    expect(institutions.get(connection.bankConnectionKey)).toEqual({ id: 'simplefin:examplebank.test', name: 'Example Bank' });
  });

  it('promotes a pending row in place when it posts under the same id, and asks only for what is new', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);
    await sync(connection, providerFor(fakeSimplefinServer()));

    const posted = accountSetV1();
    const pendingRow = posted.accounts[0] as { transactions: { amount: string; id: string; pending?: boolean; posted: number }[] };
    const coffee = pendingRow.transactions.find((row) => row.id === 'TRN-1003');
    if (coffee) Object.assign(coffee, { amount: '-15.00', pending: false, posted: at('2026-11-11') });
    const later = fakeSimplefinServer({ accounts: () => posted });
    const laterNow = new Date('2026-11-12T09:00:00Z');

    const result = await sync(connection, providerFor(later, laterNow), 5);

    expect(result.status).toBe('full_success');
    const rows = await storedRows('ACT-CHECKING-1');
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.nordigenInternalTransactionId === 'simplefin:TRN-1003')?.transactionStatusKey?.name).toBe('BOOKED');
    // A refresh reads from a week before the last good sync, not the full 89 days again.
    const startDate = Number(new URL(later.calls[0]?.url ?? '').searchParams.get('start-date'));
    expect(laterNow.getTime() / 1000 - startDate).toBeLessThan(9 * 24 * 60 * 60);
  });

  it('promotes the pending row when the posted one arrives under a new id, without storing it twice', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);
    await sync(connection, providerFor(fakeSimplefinServer()));

    const posted = accountSetV1();
    const checking = posted.accounts[0] as { transactions: { amount: string; description: string; id: string; pending?: boolean; posted: number }[] };
    checking.transactions = checking.transactions.filter((row) => row.id !== 'TRN-1003');
    checking.transactions.push({ amount: '-15.00', description: 'Coffee House', id: 'TRN-1003-POSTED', posted: at('2026-11-11') });

    await sync(connection, providerFor(fakeSimplefinServer({ accounts: () => posted }), new Date('2026-11-12T09:00:00Z')), 5);

    const rows = await storedRows('ACT-CHECKING-1');
    expect(rows.map((row) => [row.nordigenInternalTransactionId, row.transactionStatusKey?.name])).toEqual([
      ['simplefin:TRN-1001', 'BOOKED'],
      ['simplefin:TRN-1002', 'BOOKED'],
      ['simplefin:TRN-1003-POSTED', 'BOOKED'],
    ]);
  });

  it('moves the connection to revoked on a 403 and fails the run as an ended consent', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);
    const provider = providerFor(fakeSimplefinServer({ accountsStatus: 403 }));

    const error = await sync(connection, provider).then(() => undefined, (rejection: unknown) => rejection);

    expect(classifyBankSyncError(error, { permanentErrorNames: [] })).toEqual({ code: 'consent_expired', isPermanent: true });
    const row = await db.em().findOneOrFail(BankConnection, { bankConnectionKey: connection.bankConnectionKey });
    expect(row.status).toBe(BankConnectionStatus.REVOKED);
    expect(await provider.getSessionStatus(bankConnectionRef(row))).toBe('ended');
  });

  it('records SimpleFIN\'s error list as the run\'s code, failing only the accounts it names', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);
    const set = accountSetV2({ errlist: [{ code: 'con.auth', conn_id: 'CON-B', msg: 'Example Trust needs you to sign in again' }] });
    set.accounts = set.accounts.filter((account) => account.id !== 'ACT-B2');

    const result = await sync(connection, providerFor(fakeSimplefinServer({ accounts: () => set })));

    expect(result).toMatchObject({ reportedErrorCode: 'institution_action_required', status: 'partial' });
    expect(await db.em().findOne(Account, { accountId: 'ACT-A1' }, { filters: false })).not.toBeNull();
    expect(await db.em().findOne(Account, { accountId: 'ACT-B1' }, { filters: false })).toBeNull();
  });

  it('leaves a custom-currency account out and says so', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkSimplefin(household);

    const result = await sync(connection, providerFor(fakeSimplefinServer({ accounts: () => accountSetV2() })));

    expect(result).toMatchObject({ reportedErrorCode: 'unsupported_currency', status: 'partial' });
    expect(await db.em().findOne(Account, { accountId: 'ACT-B2' }, { filters: false })).toBeNull();
    expect(await db.em().findOne(Account, { accountId: 'ACT-B1' }, { filters: false })).not.toBeNull();
  });
});
