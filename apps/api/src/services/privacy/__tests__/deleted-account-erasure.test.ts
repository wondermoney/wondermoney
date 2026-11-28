import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { AccountOwnership } from '@entity/AccountOwnership';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { EnableBankingCredential, EnableBankingCredentialStatus } from '@entity/EnableBankingCredential';
import { SentEmail } from '@entity/SentEmail';
import { Transaction } from '@entity/Transaction';
import { TransactionAttachment } from '@entity/TransactionAttachment';
import { TransactionOCRImport, TransactionOCRImportStatus } from '@entity/TransactionOCRImport';
import { deleteWonderMoneyAccount } from '@service/account/account-deletion.service';

import { eraseDeletedAccounts } from '../deleted-account-erasure';
import type { RetentionStorage } from '../retention-storage';

/*
 * Thirty days after an owner deletes their account, the household it dissolved is erased: every
 * row of it, in every table, and the files stored for it, with the anonymised account record. A
 * household that still has members is never touched, and a deleted member of one keeps only the
 * placeholder record its rows point at.
 */
describe('erasing what an account deletion left, 30 days on', () => {
  const db = useTestDatabase({ schema: 'migrations' });
  const now = new Date('2026-11-28T04:20:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  function storage(options: { fail?: boolean } = {}) {
    const deleted: string[] = [];
    const store: RetentionStorage & { deleted: string[] } = {
      deleted,
      deleteObject: (bucket, key) => (options.fail ? Promise.reject(new Error('store unavailable')) : Promise.resolve(void deleted.push(`${bucket}/${key}`))),
      filesBucket: () => 'files',
      isEnabled: () => true,
    };
    return store;
  }

  async function deleteAccount(member: Appuser, at: Date) {
    // Loaded by the manager the deletion's transaction forks from, as the request's own user is.
    const appuser = await DI.em.findOneOrFail(Appuser, { appuserKey: member.appuserKey }, { filters: false });
    await deleteWonderMoneyAccount(appuser, { adminEmail: vi.fn(), authAdmin: { deleteUser: vi.fn() }, now: at, sentry: { captureException: vi.fn() } });
  }

  /** A household with the kinds of rows a real one has: categories, merchants, transfers, shares, files. */
  async function furnish(household: Household, label: string) {
    const em = db.em();
    const partner = await addPartner(em, household);
    const category = await addCategory(em, household, `Groceries ${label}`);
    const merchant = await addMerchant(em, household, `Shop ${label}`);
    const spend = await addTransaction(em, household, { amount: -42, category, date: daysAgo(60), merchant, status: 'BOOKED' });
    const out = await addTransaction(em, household, { amount: -100, date: daysAgo(50), status: 'BOOKED' });
    const into = await addTransaction(em, household, { amount: 100, date: daysAgo(50), status: 'BOOKED' });
    const linked = db.em();
    const [a, b] = await Promise.all([linked.findOneOrFail(Transaction, { transactionKey: out.transactionKey }, { filters: false }), linked.findOneOrFail(Transaction, { transactionKey: into.transactionKey }, { filters: false })]);
    a.transferCounterpartKey = b;
    b.transferCounterpartKey = a;
    linked.create(AccountOwnership, { accountKey: household.account, appuserKey: household.appuser, basisPoints: 5000, tenantKey: household.tenant }, { partial: true });
    linked.create(AccountOwnership, { accountKey: household.account, appuserKey: partner, basisPoints: 5000, tenantKey: household.tenant }, { partial: true });
    linked.create(AppuserTransactionCategory, { appuserKey: partner, categoryKey: category, source: Source.USER, transactionKey: into }, { partial: true });
    linked.create(TransactionAttachment, { contentType: 'image/png', fileName: 'receipt.png', sizeBytes: 10, storageKey: `attachments/${label}.png`, tenantKey: household.tenant, transactionKey: spend, uploadedByAppuserKey: household.appuser }, { partial: true });
    linked.create(TransactionOCRImport, { appuserKey: household.appuser, fileKey: `wmocr/${label}.png`, fileUrl: `https://files.example.test/files/wmocr/${label}.png`, status: TransactionOCRImportStatus.SUCCESS, tenantKey: household.tenant, tokensSpent: 10, transactionKey: spend }, { partial: true });
    linked.create(SentEmail, { appuser: household.appuser, emailType: `wi:w:2026-W${label.length}`, sentAt: daysAgo(70), status: 'sent' }, { partial: true });
    await linked.flush();
    return { category, merchant, partner, transactions: [spend, out, into] };
  }

  const query = (sql: string, params: unknown[] = []) => db.em().getConnection().execute<Record<string, unknown>[]>(sql, params);

  /** Every row, in every table with a household key, that belongs to `tenantKey`. */
  async function householdRows(tenantKey: number) {
    const tables = await query(`select table_name as name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_key' order by 1`);
    const out: Record<string, string> = {};
    for (const { name } of tables) {
      const [row] = await query(`select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from public."${String(name)}" t where t.tenant_key = ?`, [tenantKey]);
      if (Number(row?.['n']) > 0) out[String(name)] = `${String(row?.['n'])}:${String(row?.['h'])}`;
    }
    const [tenant] = await query('select md5(t::text) as h from public.tenant t where tenant_key = ?', [tenantKey]);
    if (tenant) out['tenant'] = String(tenant['h']);
    return out;
  }

  const transactionsLeft = async (keys: number[]) => (await query(`select transaction_key from "transaction" where transaction_key in (${keys.map(() => '?').join(', ')})`, keys)).length;
  const appuserExists = async (key: number) => (await query('select 1 from appuser where appuser_key = ?', [key])).length > 0;

  it('erases a household its owner dissolved 31 days ago, with its files and the owner record, and leaves every other household alone', async () => {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    const recent = await seedHousehold(db.em());
    const our = await furnish(ours, 'ours');
    await furnish(theirs, 'theirs');
    await furnish(recent, 'recent');
    await deleteAccount(ours.appuser, daysAgo(31));
    await deleteAccount(recent.appuser, daysAgo(29));
    const theirsBefore = await householdRows(theirs.tenant.tenantKey);
    const recentBefore = await householdRows(recent.tenant.tenantKey);

    const files = storage();
    const result = await eraseDeletedAccounts({ em: db.em(), now, storage: files });

    expect(result).toMatchObject({ accounts: 1, failed: 0, households: 1, keptAccounts: 0 });
    expect(await householdRows(ours.tenant.tenantKey)).toEqual({});
    // Transactions point at their household `on delete set null`: they are erased, not orphaned.
    expect(await transactionsLeft(our.transactions.map((row) => row.transactionKey))).toBe(0);
    expect(await query('select 1 from category where category_key = ?', [our.category.categoryKey])).toHaveLength(0);
    expect(await query('select 1 from transaction_merchant where transaction_merchant_key = ?', [our.merchant.transactionMerchantKey])).toHaveLength(0);
    expect(await query('select 1 from sent_email where appuser_appuser_key = ?', [ours.appuser.appuserKey])).toHaveLength(0);
    expect(await appuserExists(ours.appuser.appuserKey)).toBe(false);
    // The member of the dissolved household is a person of their own: only their place in it goes.
    expect(await appuserExists(our.partner.appuserKey)).toBe(true);
    expect(files.deleted.sort()).toEqual(['files/attachments/ours.png', 'files/wmocr/ours.png']);

    expect(await householdRows(theirs.tenant.tenantKey)).toEqual(theirsBefore);
    // Deleted 29 days ago: not yet.
    expect(await householdRows(recent.tenant.tenantKey)).toEqual(recentBefore);
    expect(await appuserExists(recent.appuser.appuserKey)).toBe(true);

    expect(await eraseDeletedAccounts({ em: db.em(), now, storage: storage() })).toMatchObject({ accounts: 0, households: 0 });
  });

  it('keeps a deleted member of a household that goes on as a bare placeholder, and the household as it was', async () => {
    const household = await seedHousehold(db.em());
    await furnish(household, 'shared');
    const member = await addPartner(db.em(), household);
    await addTransaction(db.em(), household, { amount: -5, appuser: member, date: daysAgo(40), status: 'BOOKED' });
    const em = db.em();
    const record = await em.findOneOrFail(Appuser, { appuserKey: member.appuserKey });
    record.preferences = { dashboardLayout: ['net-worth'] };
    record.onboardingCompletedAt = daysAgo(90);
    await em.flush();
    await deleteAccount(member, daysAgo(31));
    const before = await householdRows(household.tenant.tenantKey);

    const result = await eraseDeletedAccounts({ em: db.em(), now, storage: storage() });

    expect(result).toMatchObject({ accounts: 0, households: 0, keptAccounts: 1 });
    expect(await householdRows(household.tenant.tenantKey)).toEqual(before);
    const kept = await db.em().findOneOrFail(Appuser, { appuserKey: member.appuserKey }, { filters: false });
    expect(kept).toMatchObject({ emailAddress: `deleted+${member.appuserKey}@deleted.invalid`, firstName: 'Deleted', lastName: 'User', preferences: {} });
    expect(kept.onboardingCompletedAt ?? null).toBeNull();
  });

  it("keeps a former member's own Enable Banking key, which follows them, and erases the owner's", async () => {
    const household = await seedHousehold(db.em());
    const { partner } = await furnish(household, 'keys');
    const em = db.em();
    const key = (appuser: Appuser) => em.create(EnableBankingCredential, { applicationId: `app-${appuser.appuserKey}`, appuserKey: appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', status: EnableBankingCredentialStatus.ACTIVE, tenantKey: household.tenant }, { partial: true });
    const partnerKey = key(partner);
    const ownerKey = key(household.appuser);
    await em.flush();
    await deleteAccount(household.appuser, daysAgo(31));

    expect(await eraseDeletedAccounts({ em: db.em(), now, storage: storage() })).toMatchObject({ accounts: 1, households: 1 });
    expect(await query('select tenant_key from enable_banking_credential where enable_banking_credential_key = ?', [partnerKey.enableBankingCredentialKey])).toEqual([{ tenant_key: null }]);
    expect(await query('select 1 from enable_banking_credential where enable_banking_credential_key = ?', [ownerKey.enableBankingCredentialKey])).toHaveLength(0);
  });

  it('leaves a dissolved household alone once someone is an active member of it again', async () => {
    const household = await seedHousehold(db.em());
    const { partner } = await furnish(household, 'rejoined');
    await deleteAccount(household.appuser, daysAgo(31));
    const em = db.em();
    const membership = await em.findOneOrFail(AppuserTenant, { appuserKey: partner, tenantKey: household.tenant }, { filters: false });
    membership.recordActive = true;
    membership.deletedAt = undefined;
    await em.flush();
    const before = await householdRows(household.tenant.tenantKey);

    const result = await eraseDeletedAccounts({ em: db.em(), now, storage: storage() });

    expect(result).toMatchObject({ households: 0, keptHouseholds: 1 });
    expect(await householdRows(household.tenant.tenantKey)).toEqual(before);
    expect(await appuserExists(household.appuser.appuserKey)).toBe(true);
  });

  it('erases nothing of a household when another household has a row pointing into it', async () => {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    const { merchant } = await furnish(ours, 'linked');
    // A cross-household reference no code should create: erasing would change their transaction.
    await addTransaction(db.em(), theirs, { amount: -1, date: daysAgo(40), merchant, status: 'BOOKED' });
    await deleteAccount(ours.appuser, daysAgo(31));
    const oursBefore = await householdRows(ours.tenant.tenantKey);
    const theirsBefore = await householdRows(theirs.tenant.tenantKey);
    const warn = vi.fn();

    const result = await eraseDeletedAccounts({ em: db.em(), logger: { info: vi.fn(), warn }, now, storage: storage() });

    expect(result).toMatchObject({ accounts: 0, failed: 1, households: 0 });
    expect(await householdRows(ours.tenant.tenantKey)).toEqual(oursBefore);
    expect(await householdRows(theirs.tenant.tenantKey)).toEqual(theirsBefore);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: ours.appuser.appuserKey, refused: true }), expect.any(String));
  });

  it('erases nothing while the file store refuses, and everything on the run after', async () => {
    const household = await seedHousehold(db.em());
    await furnish(household, 'stored');
    await deleteAccount(household.appuser, daysAgo(31));
    const before = await householdRows(household.tenant.tenantKey);

    expect(await eraseDeletedAccounts({ em: db.em(), now, storage: storage({ fail: true }) })).toMatchObject({ failed: 1, households: 0 });
    expect(await householdRows(household.tenant.tenantKey)).toEqual(before);

    expect(await eraseDeletedAccounts({ em: db.em(), now, storage: storage() })).toMatchObject({ accounts: 1, failed: 0, households: 1 });
    expect(await householdRows(household.tenant.tenantKey)).toEqual({});
  });

  it('works through a bounded number of people per run', async () => {
    const households: Household[] = [];
    for (let index = 0; index < 3; index += 1) households.push(await seedHousehold(db.em()));
    for (const household of households) await deleteAccount(household.appuser, daysAgo(40));

    expect(await eraseDeletedAccounts({ em: db.em(), maxAccounts: 2, now, storage: storage() })).toMatchObject({ accounts: 2, more: true });
    expect(await eraseDeletedAccounts({ em: db.em(), maxAccounts: 2, now, storage: storage() })).toMatchObject({ accounts: 1, more: false });
    for (const household of households) expect(await appuserExists(household.appuser.appuserKey)).toBe(false);
  });
});
