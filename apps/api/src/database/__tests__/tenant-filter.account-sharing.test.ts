import { describe, expect, it } from 'vitest';

import { addAccount, addPartner, addShare, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { HouseholdRole } from '@entity/AppuserTenant';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Transaction } from '@entity/Transaction';
import { accountAccessOf, assertAccountWritable, resolveAccountAccess } from '@service/account/account-access';
import { ERROR_CODE } from '@utils/errors';

import { setTenantContext } from '../filters/tenant-filter';

/*
 * Who sees an account, and who changes it, for every combination of the account's private flag,
 * the member's share on it and the member's household role. The account belongs to the household
 * owner; the member asking is someone else. The tenant filter (accounts, transactions, recurring
 * series, installment plans) and the write rule must agree.
 */
type Expected = 'hidden' | 'read' | 'write';
type Share = 'none' | 'read' | 'write';

const ROLES = [HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER] as const;
const SHARES: readonly Share[] = ['none', 'read', 'write'];

function expected(isPrivate: boolean, share: Share, role: HouseholdRole): Expected {
  const base: Expected = !isPrivate ? 'write' : share === 'none' ? 'hidden' : share;
  return base !== 'hidden' && role === HouseholdRole.VIEWER ? 'read' : base;
}

const CASES = [false, true].flatMap((isPrivate) => SHARES.flatMap((share) => ROLES.map((role) => ({ expected: expected(isPrivate, share, role), isPrivate, role, share }))));

describe('account sharing: who sees and who changes an account', () => {
  const db = useTestDatabase();

  async function setUp(isPrivate: boolean, share: Share, role: HouseholdRole) {
    const em = db.em();
    const household = await seedHousehold(em);
    const member = await addPartner(em, household, { role });
    const account = await addAccount(em, household, { isPrivate, name: 'Joint savings' });
    if (share !== 'none') await addShare(em, household, account, member, share);
    await addTransaction(em, household, { account, amount: -42, date: new Date(), status: 'BOOKED' });
    em.create(RecurringSeries, { accountKey: account, displayName: 'Gym', normalizedMerchantKey: 'gym', tenantKey: household.tenant }, { partial: true });
    em.create(InstallmentPlan, { accountKey: account, description: 'Laptop', installmentCount: 3, purchaseDate: new Date(), tenantKey: household.tenant, totalAmount: 900 }, { partial: true });
    await em.flush();
    return { account, household, member };
  }

  it.each(CASES)('private=$isPrivate, share=$share, $role: $expected', async ({ expected: want, isPrivate, role, share }) => {
    const { account, household, member } = await setUp(isPrivate, share, role);
    const em = db.em();
    setTenantContext(em, { appuserKey: member.appuserKey, tenantKey: household.tenant.tenantKey });

    const visible = want !== 'hidden';
    await expect(em.count(Account, { accountKey: account.accountKey })).resolves.toBe(visible ? 1 : 0);
    await expect(em.count(Transaction, { accountKey: { accountKey: account.accountKey } })).resolves.toBe(visible ? 1 : 0);
    await expect(em.count(RecurringSeries, { accountKey: { accountKey: account.accountKey } })).resolves.toBe(visible ? 1 : 0);
    await expect(em.count(InstallmentPlan, { accountKey: { accountKey: account.accountKey } })).resolves.toBe(visible ? 1 : 0);

    const actor = { appuserKey: member.appuserKey, householdRole: role, tenantKey: household.tenant.tenantKey };
    await expect(accountAccessOf(em, account.accountKey, actor)).resolves.toBe(visible ? want : null);
    const refusal = await assertAccountWritable(em, account.accountKey, actor).then(() => null, (error: unknown) => ({ code: (error as { code?: string }).code, status: (error as { status?: number }).status }));
    const expectedRefusal = { hidden: { code: ERROR_CODE.NOT_FOUND, status: 404 }, read: { code: ERROR_CODE.ACCOUNT_READ_ONLY, status: 403 }, write: null }[want];
    expect(refusal).toEqual(expectedRefusal);
  });

  it('keeps today\'s behaviour with no shares: a shared account for everyone, a private one for its owner', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const member = await addPartner(em, household);
    const mine = await addAccount(em, household, { isPrivate: true, name: 'Mine', owner: member });
    const theirs = await addAccount(em, household, { isPrivate: true, name: 'Theirs' });

    setTenantContext(em, { appuserKey: member.appuserKey, tenantKey: household.tenant.tenantKey });
    const seen = (await em.find(Account, {})).map((row) => row.accountKey).sort((a, b) => a - b);
    expect(seen).toEqual([household.account.accountKey, mine.accountKey].sort((a, b) => a - b));
    expect(seen).not.toContain(theirs.accountKey);
  });

  it('gives the owner of the account owner access, and a viewer who owns one read access', () => {
    expect(resolveAccountAccess({ isPrivate: true, ownerAppuserKey: 5, share: null }, { appuserKey: 5, householdRole: HouseholdRole.MEMBER })).toBe('owner');
    expect(resolveAccountAccess({ isPrivate: true, ownerAppuserKey: 5, share: null }, { appuserKey: 5, householdRole: HouseholdRole.VIEWER })).toBe('read');
  });

  it('does not let the household owner see a member\'s private account they were not shared', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const member = await addPartner(em, household);
    const hidden = await addAccount(em, household, { isPrivate: true, owner: member });

    setTenantContext(em, { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });
    await expect(em.count(Account, { accountKey: hidden.accountKey })).resolves.toBe(0);
  });

  it('never shows another household\'s account, even with a share row pointing at it', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const neighbour = await seedHousehold(em);
    const account = await addAccount(em, household, { isPrivate: true });
    await addShare(em, household, account, neighbour.appuser, 'write');

    setTenantContext(em, { appuserKey: neighbour.appuser.appuserKey, tenantKey: neighbour.tenant.tenantKey });
    await expect(em.count(Account, { accountKey: account.accountKey })).resolves.toBe(0);
    await expect(accountAccessOf(em, account.accountKey, { appuserKey: neighbour.appuser.appuserKey, tenantKey: neighbour.tenant.tenantKey })).resolves.toBeNull();
  });
});
