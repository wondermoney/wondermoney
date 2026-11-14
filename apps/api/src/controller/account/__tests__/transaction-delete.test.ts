import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Tenant, TenantType } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import accountRoutes from '@route/account';

/*
 * Deleting transactions. A deleted row is soft-deleted: it leaves every list and total, and the
 * account's running balances are rebuilt without it in the same database transaction, so the
 * balance shown on each later row (and the account's own balance) is what it would have been had
 * the row never been entered. Rows the bank sent are never deleted, because the next sync would
 * send them again: one alone is a 409, and in a bulk request they are skipped and reported.
 */
describe('deleting transactions', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/account', accountRoutes);

  /** A manual row through the real create endpoint, so the stored chain is the one production writes. */
  async function enter(household: Household, amount: number, date: string, account: Account = household.account): Promise<number> {
    const response = await http.as(household.appuser).post(`/v1/account/${account.accountKey}/transaction`).send({
      settlementAmount: amount,
      settlementCurrencyId: household.currency.currencyKey,
      transactionDate: date,
      transactionMerchantName: `Shop ${date}`,
      transactionTypeId: (amount >= 0 ? household.types.income : household.types.cardPayment).transactionTypeKey,
    });
    expect(response.status).toBe(201);
    const row = await db.em().findOneOrFail(Transaction, { accountKey: account, transactionDate: new Date(date) }, { filters: false });
    return row.transactionKey;
  }

  async function balances(account: Account): Promise<{ account: number; rows: Record<number, null | number> }> {
    const em = db.em();
    const rows = await em.find(Transaction, { accountKey: account }, { filters: false, orderBy: { transactionDate: 'ASC', transactionKey: 'ASC' } });
    const stored = await em.findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
    return { account: Number(stored.balance), rows: Object.fromEntries(rows.filter((row) => row.deletedAt == null).map((row) => [row.transactionKey, row.balance ?? null])) };
  }

  /** Account at 1000 before its first row; four rows on four days. */
  async function ledger() {
    const owner = await seedHousehold(db.em());
    const first = await enter(owner, -100, '2026-03-01T12:00:00.000Z');
    const second = await enter(owner, -50, '2026-03-02T12:00:00.000Z');
    const third = await enter(owner, 200, '2026-03-03T12:00:00.000Z');
    const fourth = await enter(owner, -30, '2026-03-04T12:00:00.000Z');
    return { first, fourth, owner, second, third };
  }

  describe('balances', () => {
    it('starts from the chain the create endpoint writes', async () => {
      const { first, fourth, owner, second, third } = await ledger();

      expect(await balances(owner.account)).toEqual({ account: 1020, rows: { [first]: 900, [fourth]: 1020, [second]: 850, [third]: 1050 } });
    });

    it('rebuilds every later balance when a row in the middle of the chain is deleted, and leaves earlier rows alone', async () => {
      const { first, fourth, owner, second, third } = await ledger();

      const response = await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);

      expect(response.status).toBe(204);
      expect(await balances(owner.account)).toEqual({ account: 1070, rows: { [first]: 900, [fourth]: 1070, [third]: 1100 } });
    });

    it('keeps the opening balance when the oldest row is deleted', async () => {
      const { first, fourth, owner, second, third } = await ledger();

      await http.as(owner.appuser).delete(`/v1/account/transaction/${first}`);

      expect(await balances(owner.account)).toEqual({ account: 1120, rows: { [fourth]: 1120, [second]: 950, [third]: 1150 } });
    });

    it('rebuilds the chain once for several rows deleted together, adjacent or not', async () => {
      const { first, fourth, owner, second, third } = await ledger();

      const response = await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [fourth, second] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deletedTransactionIds: [second, fourth], skipped: [] });
      expect(await balances(owner.account)).toEqual({ account: 1100, rows: { [first]: 900, [third]: 1100 } });
    });

    it('brings the account back to its opening balance when every row is deleted', async () => {
      const { first, fourth, owner, second, third } = await ledger();

      await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [first, second, third, fourth] });

      expect(await balances(owner.account)).toEqual({ account: 1000, rows: {} });
    });

    it('places a row entered after a deletion on the chain without the deleted row', async () => {
      const { fourth, owner } = await ledger();
      await http.as(owner.appuser).delete(`/v1/account/transaction/${fourth}`);

      const fifth = await enter(owner, -20, '2026-03-05T12:00:00.000Z');

      expect((await balances(owner.account)).rows[fifth]).toBe(1030);
      expect((await balances(owner.account)).account).toBe(1030);
    });

    it('rebuilds each account on its own when the rows are on two accounts', async () => {
      const { first, owner, second } = await ledger();
      const savings = await addAccount(db.em(), owner, { balance: 500 });
      const deposit = await enter(owner, 100, '2026-03-02T12:00:00.000Z', savings);
      const later = await enter(owner, 10, '2026-03-03T12:00:00.000Z', savings);

      await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [second, deposit] });

      expect((await balances(savings)).rows).toEqual({ [later]: 510 });
      expect((await balances(savings)).account).toBe(510);
      expect((await balances(owner.account)).rows[first]).toBe(900);
      expect((await balances(owner.account)).account).toBe(1070);
    });
  });

  describe('what a deleted row leaves behind', () => {
    it('drops the row from the transaction list and its total', async () => {
      const { owner, second } = await ledger();

      await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);

      const list = await http.as(owner.appuser).get('/v1/account/transaction?fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z');
      expect((list.body.transactions as { transactionKey: number }[]).map((row) => row.transactionKey)).not.toContain(second);
      expect(list.body.total).toBe(3);
    });

    it('keeps the row in the database, soft-deleted, with a soft_deleted entry in its history', async () => {
      const { owner, second } = await ledger();

      await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);

      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: second }, { filters: false });
      expect(stored.deletedAt).toBeInstanceOf(Date);
      const entries = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.SOFT_DELETED }, { filters: false });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorAppuserKey: { appuserKey: owner.appuser.appuserKey }, transactionKey: { transactionKey: second } });
      expect(entries[0]?.changes).toMatchObject({ balance: { from: 850, to: null }, settlementAmount: { from: -50, to: null } });
    });

    it('writes one soft_deleted entry per deleted row in a bulk request', async () => {
      const { first, owner, third } = await ledger();

      await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [first, third] });

      const entries = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.SOFT_DELETED }, { filters: false });
      expect(entries.map((entry) => entry.transactionKey.transactionKey).sort((a, b) => a - b)).toEqual([first, third]);
    });

    it('answers 404 for a row that is already deleted', async () => {
      const { owner, second } = await ledger();
      await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);

      const again = await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);

      expect(again.status).toBe(404);
    });
  });

  describe('bank-synced rows', () => {
    it('refuses to delete a row the bank sent, with a hint to hide it, and changes nothing', async () => {
      const owner = await seedHousehold(db.em());
      const synced = await addTransaction(db.em(), owner, { amount: -40, appuserCurrencyBalance: 960, date: new Date('2026-03-01T12:00:00Z'), enableBankingTransactionId: 'eb-1', status: 'BOOKED' });

      const response = await http.as(owner.appuser).delete(`/v1/account/transaction/${synced.transactionKey}`);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'transaction_bank_synced' });
      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: synced.transactionKey }, { filters: false });
      expect(stored.deletedAt).toBeNull();
      expect(await db.em().count(TransactionAuditLog, { eventType: TransactionAuditEventType.SOFT_DELETED }, { filters: false })).toBe(0);
    });

    it('deletes an imported statement row, whose file id sits in the legacy provider column, on an account with no bank link', async () => {
      const owner = await seedHousehold(db.em());
      const imported = await addTransaction(db.em(), owner, { amount: -10, appuserCurrencyBalance: 990, date: new Date('2026-03-01T12:00:00Z'), status: 'BOOKED' });
      await db.em().nativeUpdate(Transaction, { transactionKey: imported.transactionKey }, { nordigenInternalTransactionId: 'statement-row-1' });

      const response = await http.as(owner.appuser).delete(`/v1/account/transaction/${imported.transactionKey}`);

      expect(response.status).toBe(204);
    });

    it('treats a legacy provider id on a bank-linked account as bank-synced', async () => {
      const owner = await seedHousehold(db.em());
      const em = db.em();
      const credential = em.create(EnableBankingCredential, { applicationId: 'app-1', appuserKey: owner.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: owner.tenant }, { partial: true });
      const connection = em.create(EnableBankingConnection, { appuserKey: owner.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: 'session-1', state: 'state-1', status: EnableBankingConnectionStatus.LINKED, tenantKey: owner.tenant }, { partial: true });
      await em.flush();
      await em.nativeUpdate(Account, { accountKey: owner.account.accountKey }, { enableBankingConnectionKey: connection });
      const legacy = await addTransaction(db.em(), owner, { amount: -10, date: new Date('2026-03-01T12:00:00Z'), status: 'BOOKED' });
      await db.em().nativeUpdate(Transaction, { transactionKey: legacy.transactionKey }, { nordigenInternalTransactionId: 'gocardless-1' });

      const response = await http.as(owner.appuser).delete(`/v1/account/transaction/${legacy.transactionKey}`);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'transaction_bank_synced' });
    });

    it('deletes the manual rows of a mixed request and reports the synced ones it skipped', async () => {
      const { owner, second, third } = await ledger();
      const synced = await addTransaction(db.em(), owner, { amount: -5, date: new Date('2026-02-01T12:00:00Z'), enableBankingTransactionId: 'eb-2', status: 'BOOKED' });

      const response = await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [second, synced.transactionKey, third] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deletedTransactionIds: [second, third], skipped: [{ reason: 'bank_synced', transactionIds: [synced.transactionKey] }] });
      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: synced.transactionKey }, { filters: false });
      expect(stored.deletedAt).toBeNull();
    });

    it('refuses a bulk request in which every row is bank-synced', async () => {
      const owner = await seedHousehold(db.em());
      const one = await addTransaction(db.em(), owner, { amount: -5, date: new Date('2026-02-01T12:00:00Z'), enableBankingTransactionId: 'eb-3', status: 'BOOKED' });
      const two = await addTransaction(db.em(), owner, { amount: -6, date: new Date('2026-02-02T12:00:00Z'), enableBankingTransactionId: 'eb-4', status: 'BOOKED' });

      const response = await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [one.transactionKey, two.transactionKey] });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'transaction_bank_synced' });
    });

    it('marks each listed row as bank-synced or not, so a client can say which will be skipped', async () => {
      const owner = await seedHousehold(db.em());
      const manual = await enter(owner, -10, '2026-03-01T12:00:00.000Z');
      const synced = await addTransaction(db.em(), owner, { amount: -5, date: new Date('2026-03-02T12:00:00Z'), enableBankingTransactionId: 'eb-5', status: 'BOOKED' });

      const list = await http.as(owner.appuser).get('/v1/account/transaction?fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z');

      const rows = list.body.transactions as { bankSynced: boolean; transactionKey: number }[];
      expect(rows.find((row) => row.transactionKey === manual)?.bankSynced).toBe(false);
      expect(rows.find((row) => row.transactionKey === synced.transactionKey)?.bankSynced).toBe(true);
    });
  });

  describe('who may delete', () => {
    it('lets the partner delete a row on a shared account', async () => {
      const { owner, second } = await ledger();
      const partner = await addPartner(db.em(), owner);

      const response = await http.as(partner).delete(`/v1/account/transaction/${second}`);

      expect(response.status).toBe(204);
    });

    it('does not find the other member\'s private-account row, nor another household\'s, by id', async () => {
      const owner = await seedHousehold(db.em());
      const partner = await addPartner(db.em(), owner);
      const privateAccount = await addAccount(db.em(), owner, { balance: 300, isPrivate: true });
      const secret = await enter(owner, -10, '2026-03-01T12:00:00.000Z', privateAccount);
      const neighbour = await seedHousehold(db.em());
      const theirs = await enter(neighbour, -10, '2026-03-01T12:00:00.000Z');

      const asPartner = await http.as(partner).delete(`/v1/account/transaction/${secret}`);
      const asPartnerBulk = await http.as(partner).delete('/v1/account/transaction').send({ transactionIds: [secret] });
      const asOwner = await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [theirs] });

      expect([asPartner.status, asPartnerBulk.status, asOwner.status]).toEqual([404, 404, 404]);
      const untouched = await db.em().find(Transaction, { transactionKey: { $in: [secret, theirs] } }, { filters: false });
      expect(untouched.map((row) => row.deletedAt)).toEqual([null, null]);
      expect((await balances(privateAccount)).account).toBe(290);
    });

    it('keeps the demo household read-only', async () => {
      const { owner, second } = await ledger();
      await db.em().nativeUpdate(Tenant, { tenantKey: owner.tenant.tenantKey }, { tenantType: TenantType.DEMO });

      const single = await http.as(owner.appuser).delete(`/v1/account/transaction/${second}`);
      const bulk = await http.as(owner.appuser).delete('/v1/account/transaction').send({ transactionIds: [second] });

      expect([single.status, bulk.status]).toEqual([403, 403]);
      const stored = await db.em().findOneOrFail(Transaction, { transactionKey: second }, { filters: false });
      expect(stored.deletedAt).toBeNull();
    });
  });
});
