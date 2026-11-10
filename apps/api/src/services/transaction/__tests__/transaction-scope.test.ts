import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { sqlQuery } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { TenantCategorySetting } from '@entity/TenantCategorySetting';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { type TransactionScope, transactionScopeExpression, transactionScopeSql, transactionScopeWhere } from '@service/transaction/transaction-scope';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';

/*
 * The shared scope decides which rows every total and list counts. Each case seeds rows named by
 * what they are and asserts which names a scope selects, through all three renderings (MikroORM
 * with its filters off, hand-written SQL, Kysely), which must agree.
 */
describe('transaction scope', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');

  let household: Household;
  let otherHousehold: Household;
  let partner: Appuser;
  let names: Map<number, string>;

  async function named(name: string, transaction: Promise<Transaction>): Promise<Transaction> {
    const row = await transaction;
    names.set(row.transactionKey, name);
    return row;
  }

  async function patch(em: EntityManager, transaction: Transaction, values: Partial<Transaction>) {
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    Object.assign(stored, values);
    await em.flush();
  }

  /** The names a scope selects, the same through every rendering. */
  async function selected(scope: Partial<TransactionScope> & Pick<TransactionScope, 'viewerAppuserKey'>): Promise<string[]> {
    const full: TransactionScope = { includeHidden: true, includeNonSpending: true, includeTransfers: true, statuses: 'not-expired', tenantKey: household.tenant.tenantKey, ...scope };
    const em = db.em();
    const viaOrm = (await em.find(Transaction, transactionScopeWhere(full), { filters: false })).map((row) => row.transactionKey);
    const condition = transactionScopeSql('t', full);
    const viaSql = (await em.getConnection().execute<{ transaction_key: number }[]>(`select t.transaction_key from "transaction" t where ${condition.sql}`, condition.params)).map((row) => row.transaction_key);
    const viaKysely = (await sqlQuery(em).selectFrom('transaction').select('transaction.transaction_key').where(transactionScopeExpression('transaction', full)).execute()).map((row) => row.transaction_key);
    const toNames = (keys: unknown[]) => keys.map((key) => names.get(Number(key)) ?? `unnamed ${String(key)}`).sort();
    expect(toNames(viaSql)).toEqual(toNames(viaOrm));
    expect(toNames(viaKysely)).toEqual(toNames(viaOrm));
    return toNames(viaOrm);
  }

  const asOwner = () => ({ viewerAppuserKey: household.appuser.appuserKey });
  const asPartner = () => ({ viewerAppuserKey: partner.appuserKey });

  beforeEach(async () => {
    names = new Map();
    const em = db.em();
    household = await seedHousehold(em);
    partner = await addPartner(em, household);
    const ownerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Owner private' });
    const partnerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
    const deletedAccount = await addAccount(em, household, { name: 'Deleted' });
    otherHousehold = await seedHousehold(em);

    await named('shared', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'BOOKED' }));
    await named('owner private', addTransaction(em, household, { account: ownerPrivate, amount: -10, date: JULY_10, status: 'BOOKED' }));
    await named('partner private', addTransaction(em, household, { account: partnerPrivate, amount: -10, appuser: partner, date: JULY_10, status: 'BOOKED' }));
    await named('on deleted account', addTransaction(em, household, { account: deletedAccount, amount: -10, date: JULY_10, status: 'BOOKED' }));
    deletedAccount.deletedAt = new Date();
    const deleted = await named('deleted', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'BOOKED' }));
    await patch(em, deleted, { deletedAt: new Date() });
    const accountless = await named('no account', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'BOOKED' }));
    await patch(em, accountless, { accountKey: undefined });
    await named('other household', addTransaction(em, otherHousehold, { amount: -10, date: JULY_10, status: 'BOOKED' }));
    await em.flush();
  });

  describe('always', () => {
    it('keeps to the household and its viewer\'s visible, live accounts', async () => {
      expect(await selected(asOwner())).toEqual(['owner private', 'shared']);
      expect(await selected(asPartner())).toEqual(['partner private', 'shared']);
    });

    it('selects the given household\'s rows only', async () => {
      expect(await selected({ tenantKey: otherHousehold.tenant.tenantKey, viewerAppuserKey: otherHousehold.appuser.appuserKey })).toEqual(['other household']);
    });

    it('narrows to the given accounts, and an empty list is no narrowing', async () => {
      expect(await selected({ ...asOwner(), accountKeys: [household.account.accountKey] })).toEqual(['shared']);
      expect(await selected({ ...asOwner(), accountKeys: [] })).toEqual(['owner private', 'shared']);
    });
  });

  it('selects statuses: booked, booked or pending, or anything but expired', async () => {
    const em = db.em();
    await named('pending', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'PENDING' }));
    await named('expired', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'EXPIRED' }));
    await named('no status', addTransaction(em, household, { amount: -10, date: JULY_10, status: null }));

    expect(await selected({ ...asOwner(), statuses: ['BOOKED'] })).toEqual(['owner private', 'shared']);
    expect(await selected({ ...asOwner(), statuses: ['BOOKED', 'PENDING'] })).toEqual(['owner private', 'pending', 'shared']);
    expect(await selected({ ...asOwner(), statuses: 'not-expired' })).toEqual(['no status', 'owner private', 'pending', 'shared']);
  });

  it('leaves out hidden rows unless asked', async () => {
    await named('hidden', addTransaction(db.em(), household, { amount: -10, date: JULY_10, hidden: true, status: 'BOOKED' }));

    expect(await selected({ ...asOwner(), includeHidden: false })).toEqual(['owner private', 'shared']);
    expect(await selected({ ...asOwner(), includeHidden: true })).toEqual(['hidden', 'owner private', 'shared']);
  });

  it('leaves out transfers unless asked, and a row with no type is not one', async () => {
    const em = db.em();
    const transferOut = em.create(TransactionType, { displayName: 'Transfer out', name: 'TRANSFER_OUT' }, { partial: true });
    await em.flush();
    await named('transfer', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'BOOKED', type: transferOut }));
    const untyped = await named('no type', addTransaction(em, household, { amount: -10, date: JULY_10, status: 'BOOKED' }));
    await patch(em, untyped, { transactionTypeKey: undefined });

    expect(await selected({ ...asOwner(), includeTransfers: false })).toEqual(['no type', 'owner private', 'shared']);
    expect(await selected({ ...asOwner(), includeTransfers: true })).toEqual(['no type', 'owner private', 'shared', 'transfer']);
  });

  it('leaves out rows with no line that counts as spending, keeping a split with one', async () => {
    const em = db.em();
    const investments = await addCategory(em, household, 'Investments');
    investments.countsAsSpending = false;
    const broker = await addCategory(em, household, 'Broker', investments);
    const groceries = await addCategory(em, household, 'Groceries');
    const optedOut = await addCategory(em, household, 'Opted out');
    em.create(TenantCategorySetting, { categoryKey: optedOut, countsAsSpending: false, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    await named('investments', addTransaction(em, household, { amount: -10, category: investments, date: JULY_10, status: 'BOOKED' }));
    await named('under investments', addTransaction(em, household, { amount: -10, category: broker, date: JULY_10, status: 'BOOKED' }));
    await named('household opted out', addTransaction(em, household, { amount: -10, category: optedOut, date: JULY_10, status: 'BOOKED' }));
    await named('groceries', addTransaction(em, household, { amount: -10, category: groceries, date: JULY_10, status: 'BOOKED' }));
    const actor = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    const partly = await named('split, partly spending', addTransaction(em, household, { amount: -10, category: investments, date: JULY_10, status: 'BOOKED' }));
    await setTransactionSplits(db.em(), actor, partly.transactionKey, [{ amount: -4, categoryKey: investments.categoryKey }, { amount: -6, categoryKey: null }]);
    const none = await named('split, no spending', addTransaction(em, household, { amount: -10, category: groceries, date: JULY_10, status: 'BOOKED' }));
    await setTransactionSplits(db.em(), actor, none.transactionKey, [{ amount: -4, categoryKey: investments.categoryKey }, { amount: -6, categoryKey: broker.categoryKey }]);

    expect(await selected({ ...asOwner(), includeNonSpending: false })).toEqual(['groceries', 'owner private', 'shared', 'split, partly spending']);
    expect(await selected({ ...asOwner(), includeNonSpending: true })).toHaveLength(8);
  });

  it('selects money in or out, a row with no converted amount by its own sign', async () => {
    const em = db.em();
    await named('income', addTransaction(em, household, { amount: 50, date: JULY_10, status: 'BOOKED' }));
    const unconverted = await named('unconverted refund', addTransaction(em, household, { amount: 5, date: JULY_10, status: 'BOOKED' }));
    await patch(em, unconverted, { appuserSettlementAmount: undefined });

    expect(await selected({ ...asOwner(), direction: 'in' })).toEqual(['income', 'unconverted refund']);
    expect(await selected({ ...asOwner(), direction: 'out' })).toEqual(['owner private', 'shared']);
  });

  it('selects open accounts, merchants and member currencies when asked', async () => {
    const em = db.em();
    const closed = await addAccount(em, household, { name: 'Closed' });
    closed.closed = true;
    await em.flush();
    const shop = await addMerchant(em, household, 'Shop');
    const usd = await currencyFor(em, 'USD');
    await named('closed account', addTransaction(em, household, { account: closed, amount: -10, date: JULY_10, status: 'BOOKED' }));
    await named('at the shop', addTransaction(em, household, { amount: -10, date: JULY_10, merchant: shop, status: 'BOOKED' }));
    await named('in dollars', addTransaction(em, household, { amount: -10, currency: usd, date: JULY_10, status: 'BOOKED' }));

    expect(await selected({ ...asOwner(), openAccountsOnly: true })).not.toContain('closed account');
    expect(await selected({ ...asOwner(), openAccountsOnly: false })).toContain('closed account');
    expect(await selected({ ...asOwner(), merchantKeys: [shop.transactionMerchantKey] })).toEqual(['at the shop']);
    expect(await selected({ ...asOwner(), memberCurrencyCode: 'USD' })).toEqual(['in dollars']);
  });

  it('counts a bank booking on its own date for a viewer west of UTC', async () => {
    const em = db.em();
    await named('booked 1 August', addTransaction(em, household, { amount: -10, date: new Date('2026-08-01T00:00:00Z'), status: 'BOOKED' }));
    await named('booked 1 July', addTransaction(em, household, { amount: -10, date: new Date('2026-07-01T00:00:00Z'), status: 'BOOKED' }));
    await named('23:30 on 31 July', addTransaction(em, household, { amount: -10, date: new Date('2026-08-01T03:30:00Z'), status: 'BOOKED' }));
    const july = { from: new Date('2026-07-01T04:00:00Z'), timeZone: 'America/New_York', to: new Date('2026-08-01T03:59:59.999Z') };

    expect(await selected({ ...asOwner(), dateRange: july })).toEqual(['23:30 on 31 July', 'booked 1 July', 'owner private', 'shared']);
  });
});
