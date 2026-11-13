import type { EntityManager } from '@mikro-orm/core';
import { Big } from 'big.js';

import { Account } from '@entity/Account';
import { AccountOwnership } from '@entity/AccountOwnership';
import { AccountShare } from '@entity/AccountShare';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';
import { accountAccessOf, type AccountActor, resolveAccountAccess } from '@service/account/account-access';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';
import { Money } from '@utils/money';

import { accountAttributionOf, type Attribution, type AttributionAccount, displayNameOf, matchesMemberFilter, type MemberFilter } from './member-attribution';

/**
 * Ownership shares: who owns what part of an account, for per-member net worth only
 * (wondermoney/wondermoney#97). Spending reports, budgets and the transaction list keep following
 * member attribution (`member-attribution.ts`): the owner, the joint switch and "Spent by".
 *
 * The rule, for one account's net worth:
 *
 * - **No shares**: #96's attribution stands. The account is wholly its owner's, or Shared when it
 *   is joint or its owner has left the household.
 * - **Shares** (`AccountOwnership`, basis points adding up to 10000): the account's value splits
 *   between those members by their shares, whether or not it is joint. A member who has left the
 *   household keeps their row, but while they are not an active member their share counts as
 *   Shared, as everything of theirs does under #96; it is theirs again if they rejoin. So a split
 *   account adds to Shared only through former members.
 * - The split is exact: the value, in the viewer's currency, is divided by largest remainder
 *   (`Money.allocate`), so every member's part plus Shared adds up to the account's value to the
 *   last unit, and the members' figures plus Shared add up to the household's net worth.
 * - A liability account (negative balance) splits the same way. A loan on the Loans page is not an
 *   account: it stays its owner's.
 * - Ownership is never visibility. A viewer's figures count only the accounts they see
 *   (`account-access.ts`); an account hidden from them adds nothing to anyone's figure for them,
 *   whatever share it gives them.
 *
 * Changing shares (`PUT /v1/account/:accountId/ownership`) is for the account's owner or the
 * household owner, among the accounts they see; a viewer never. Every member named must be an active
 * member of the household who can see the account.
 */
export const WHOLE_SHARE = 10_000;

/** One member's stored share of an account, in basis points. */
export interface OwnershipShare {
  appuserKey: number;
  basisPoints: number;
}

/** What one account's net worth splits into: a member (appuser key) or Shared (null), each with its basis points. */
export type OwnershipParts = ReadonlyMap<Attribution, number>;

/** The parts of an account's net worth, by the rule above. */
export function ownershipPartsOf(account: AttributionAccount, shares: readonly OwnershipShare[], activeMembers: ReadonlySet<number>): OwnershipParts {
  const parts = new Map<Attribution, number>();
  for (const share of shares) {
    if (share.basisPoints <= 0) continue;
    const holder = activeMembers.has(share.appuserKey) ? share.appuserKey : null;
    parts.set(holder, (parts.get(holder) ?? 0) + share.basisPoints);
  }
  if (parts.size === 0) parts.set(accountAttributionOf(account, activeMembers), WHOLE_SHARE);
  return parts;
}

/** The basis points of an account a member filter keeps; the whole account with no filter. */
export function basisPointsMatching(parts: OwnershipParts, filter: MemberFilter | undefined): number {
  if (!filter) return WHOLE_SHARE;
  let kept = 0;
  for (const [holder, basisPoints] of parts) if (matchesMemberFilter(holder, filter)) kept += basisPoints;
  return kept;
}

/**
 * The part of an account's value a member filter keeps. The value is split between every holder in
 * one fixed order (members by key, Shared last), so a member's part is the same whichever filter
 * asks, and the parts of all holders add up to `value` exactly.
 */
export function memberPartOf(value: Money, parts: OwnershipParts, filter: MemberFilter | undefined): Money {
  if (!filter) return value;
  const holders = [...parts.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b));
  const allocated = Money.allocate(value, holders.map(([, basisPoints]) => basisPoints));
  return Money.sum(allocated.filter((_, index) => matchesMemberFilter(holders[index]?.[0] ?? null, filter)), value.currency);
}

/** Each account's stored shares, by account key; an account with none is absent. Accounts of `tenantKey` only. */
export async function loadAccountOwnership(em: EntityManager, tenantKey: number, accountKeys: readonly number[]): Promise<Map<number, OwnershipShare[]>> {
  const byAccount = new Map<number, OwnershipShare[]>();
  const keys = [...new Set(accountKeys)];
  if (keys.length === 0) return byAccount;
  const rows = await em.find(
    AccountOwnership,
    { accountKey: { $in: keys.map((key) => getRef(em, Account, key)) }, deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) },
    { filters: false, orderBy: { accountOwnershipKey: 'asc' } },
  );
  for (const row of rows) {
    const accountKey = row.accountKey.accountKey;
    byAccount.set(accountKey, [...(byAccount.get(accountKey) ?? []), { appuserKey: row.appuserKey.appuserKey, basisPoints: row.basisPoints }]);
  }
  return byAccount;
}

// --- reading and changing one account's shares ---

export interface AccountOwnershipDto {
  accountKey: number;
  /** Whether the caller may change the shares. */
  canManage: boolean;
  /** A joint account with no shares is Shared in net worth; shares replace that, for net worth only. */
  isJoint: boolean;
  /** False when the account has no shares: it is its owner's, or Shared when joint. */
  isSplit: boolean;
  /**
   * The active members who can see the account, or hold a share of it, the account's owner first.
   * Shares held by people who have left are not listed: they count as Shared ({@link formerMembersPercent}).
   */
  members: AccountOwnershipMemberDto[];
  /** The part held by people no longer in the household, which counts as Shared; 0 when none. */
  formerMembersPercent: number;
}

export interface AccountOwnershipMemberDto {
  appuserKey: number;
  /** Whether the member can see the account now. Only those who can may be given a share. */
  canSee: boolean;
  displayName: string;
  firstName: null | string;
  isAccountOwner: boolean;
  lastName: null | string;
  /** The member's share, 0 to 100 with up to two decimals; 0 when they hold none. */
  percent: number;
  role: HouseholdRole;
}

export interface OwnershipInput {
  appuserKey: number;
  percent: number;
}

/** The account owner or the household owner may change an account's shares; a viewer never. */
export function canManageOwnership(account: Pick<Account, 'accountOwnerAppuserKey'>, actor: Pick<AccountActor, 'appuserKey' | 'householdRole'>): boolean {
  if (actor.householdRole === HouseholdRole.VIEWER) return false;
  return account.accountOwnerAppuserKey?.appuserKey === actor.appuserKey || actor.householdRole === HouseholdRole.OWNER;
}

/** A percent with at most two decimals, as basis points; null when it has more or is out of range. */
export function basisPointsOfPercent(percent: number): null | number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  const basisPoints = new Big(percent).times(100);
  return basisPoints.round(0).eq(basisPoints) ? basisPoints.toNumber() : null;
}

const percentOf = (basisPoints: number) => new Big(basisPoints).div(100).toNumber();

/** The account, when the actor may see it (404 otherwise, as everywhere for a hidden account). */
interface Audience {
  /** Active members, with whether each can see the account. */
  members: { canSee: boolean; membership: AppuserTenant }[];
}

export async function getAccountOwnership(em: EntityManager, accountKey: number, actor: AccountActor): Promise<AccountOwnershipDto> {
  return describe(em, await visibleAccount(em, accountKey, actor), actor);
}

async function audienceOf(em: EntityManager, account: Account, tenantKey: number): Promise<Audience> {
  const [memberships, shares] = await Promise.all([
    em.find(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: getRef(em, Tenant, tenantKey) }, { filters: false, orderBy: { appuserTenantKey: 'asc' }, populate: ['appuserKey'] }),
    em.find(AccountShare, { accountKey: getRef(em, Account, account.accountKey), deletedAt: null }, { filters: false }),
  ]);
  const shareOf = new Map(shares.map((share) => [share.appuserKey.appuserKey, share.access]));
  const ownerAppuserKey = account.accountOwnerAppuserKey?.appuserKey ?? null;
  return {
    members: memberships.map((membership) => {
      const appuserKey = membership.appuserKey.appuserKey;
      const access = resolveAccountAccess({ isPrivate: account.isPrivate, ownerAppuserKey, share: shareOf.get(appuserKey) ?? null }, { appuserKey, householdRole: membership.role });
      return { canSee: access !== null, membership };
    }),
  };
}

async function describe(em: EntityManager, account: Account, actor: AccountActor): Promise<AccountOwnershipDto> {
  const [audience, stored] = await Promise.all([audienceOf(em, account, actor.tenantKey), loadAccountOwnership(em, actor.tenantKey, [account.accountKey])]);
  const shares = stored.get(account.accountKey) ?? [];
  const shareOf = new Map(shares.map((share) => [share.appuserKey, share.basisPoints]));
  const owner = account.accountOwnerAppuserKey?.appuserKey ?? null;
  const active = new Set(audience.members.map(({ membership }) => membership.appuserKey.appuserKey));
  const members = audience.members
    .filter(({ canSee, membership }) => canSee || shareOf.has(membership.appuserKey.appuserKey))
    .map(({ canSee, membership }): AccountOwnershipMemberDto => {
      const appuser = membership.appuserKey;
      return {
        appuserKey: appuser.appuserKey,
        canSee,
        displayName: displayNameOf(appuser),
        firstName: appuser.firstName ?? null,
        isAccountOwner: appuser.appuserKey === owner,
        lastName: appuser.lastName ?? null,
        percent: percentOf(shareOf.get(appuser.appuserKey) ?? 0),
        role: membership.role,
      };
    });
  members.sort((a, b) => Number(b.isAccountOwner) - Number(a.isAccountOwner));
  const formerMembers = shares.filter((share) => !active.has(share.appuserKey)).reduce((total, share) => total + share.basisPoints, 0);
  return {
    accountKey: account.accountKey,
    canManage: canManageOwnership(account, actor),
    formerMembersPercent: percentOf(formerMembers),
    isJoint: account.isJoint,
    isSplit: shares.length > 0,
    members,
  };
}

async function visibleAccount(em: EntityManager, accountKey: number, actor: AccountActor): Promise<Account> {
  if ((await accountAccessOf(em, accountKey, actor)) === null) throw new NotFoundError(`Account not found: ${accountKey}`);
  return em.findOneOrFail(Account, { accountKey, deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey) }, { filters: false });
}

/**
 * Replace an account's shares. An empty list removes them: the account is its owner's again, or
 * Shared when joint. Otherwise the percentages, each with at most two decimals, add up to exactly
 * 100, and each member named is an active member of the household who can see the account. A member
 * at 0% holds nothing and is not stored.
 */
export async function setAccountOwnership(em: EntityManager, accountKey: number, actor: AccountActor, input: readonly OwnershipInput[]): Promise<AccountOwnershipDto> {
  const wanted = new Map<number, number>();
  for (const { appuserKey, percent } of input) {
    const basisPoints = basisPointsOfPercent(percent);
    if (basisPoints === null) throw new BadRequestError('A share is a percentage from 0 to 100 with at most two decimals', ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID);
    if (wanted.has(appuserKey)) throw new BadRequestError('Each member may appear only once', ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID);
    wanted.set(appuserKey, basisPoints);
  }
  const total = [...wanted.values()].reduce((sum, basisPoints) => sum + basisPoints, 0);
  if (input.length > 0 && total !== WHOLE_SHARE) throw new BadRequestError('The shares must add up to 100%', ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID);

  return em.transactional(async (tx) => {
    const account = await visibleAccount(tx, accountKey, actor);
    if (!canManageOwnership(account, actor)) {
      throw new ForbiddenError('Only the account owner or the household owner can change who owns this account.', ERROR_CODE.ACCOUNT_OWNERSHIP_MANAGER_REQUIRED);
    }
    const audience = await audienceOf(tx, account, actor.tenantKey);
    const seeing = new Set(audience.members.filter(({ canSee }) => canSee).map(({ membership }) => membership.appuserKey.appuserKey));
    for (const appuserKey of wanted.keys()) {
      if (!seeing.has(appuserKey)) throw new BadRequestError('Shares are only for members of this household who can see the account', ERROR_CODE.ACCOUNT_OWNERSHIP_INVALID);
    }

    // Replaced as a whole; the deferred check judges the account's total at commit.
    await tx.nativeDelete(AccountOwnership, { accountKey: getRef(tx, Account, account.accountKey) }, { filters: false });
    for (const [appuserKey, basisPoints] of wanted) {
      if (basisPoints === 0) continue;
      tx.create(AccountOwnership, { accountKey: account, appuserKey: getRef(tx, Appuser, appuserKey), basisPoints, tenantKey: getRef(tx, Tenant, actor.tenantKey) }, { partial: true });
    }
    await tx.flush();
    return describe(tx, account, actor);
  });
}
