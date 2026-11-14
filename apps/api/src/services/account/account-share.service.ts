import type { EntityManager } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { AccountShare, AccountShareAccess } from '@entity/AccountShare';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';

import { accountAccessOf, type AccountActor, resolveAccountAccess } from './account-access';

/**
 * Who an account is shared with: read by any member who sees the account, changed by its owner or
 * the household owner (`GET` / `PUT /v1/account/:accountId/shares`). The rule for what a share
 * allows is in `account-access.ts`.
 */
export interface AccountShareMemberDto {
  /** What the member can do with the account now. */
  access: 'hidden' | 'owner' | 'read' | 'write';
  appuserKey: number;
  firstName: null | string;
  isAccountOwner: boolean;
  lastName: null | string;
  role: HouseholdRole;
  /** The stored share, if any (it counts only while the account is private). */
  share: null | ShareAccess;
}

export interface AccountSharesDto {
  accountKey: number;
  /** Whether the caller may change the sharing. */
  canManage: boolean;
  isPrivate: boolean;
  /** Every active member of the household, the account's owner first. */
  members: AccountShareMemberDto[];
}

export interface AccountSharesInput {
  isPrivate: boolean;
  shares: readonly { access: ShareAccess; appuserKey: number }[];
}

export type ShareAccess = 'read' | 'write';

const ownerKeyOf = (account: Account) => account.accountOwnerAppuserKey?.appuserKey ?? null;

/** The account owner or the household owner may change who an account is shared with; a viewer never. */
export function canManageShares(account: Pick<Account, 'accountOwnerAppuserKey'>, actor: Pick<AccountActor, 'appuserKey' | 'householdRole'>): boolean {
  if (actor.householdRole === HouseholdRole.VIEWER) return false;
  return account.accountOwnerAppuserKey?.appuserKey === actor.appuserKey || actor.householdRole === HouseholdRole.OWNER;
}

/** The account, when the actor may see it (404 otherwise, as everywhere for a hidden account). */
async function visibleAccount(em: EntityManager, accountKey: number, actor: AccountActor): Promise<Account> {
  if ((await accountAccessOf(em, accountKey, actor)) === null) throw new NotFoundError(`Account not found: ${accountKey}`);
  return em.findOneOrFail(Account, { accountKey, deletedAt: null, tenantKey: getRef(em, Tenant, actor.tenantKey) }, { filters: false });
}

const shareAccessOf = (access: AccountShareAccess): ShareAccess => (access === AccountShareAccess.WRITE ? 'write' : 'read');

export async function getAccountShares(em: EntityManager, accountKey: number, actor: AccountActor): Promise<AccountSharesDto> {
  return describe(em, await visibleAccount(em, accountKey, actor), actor);
}

async function describe(em: EntityManager, account: Account, actor: AccountActor): Promise<AccountSharesDto> {
  const [memberships, shares] = await Promise.all([
    em.find(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: getRef(em, Tenant, actor.tenantKey) }, { filters: false, orderBy: { appuserTenantKey: 'asc' }, populate: ['appuserKey'] }),
    em.find(AccountShare, { accountKey: getRef(em, Account, account.accountKey), deletedAt: null }, { filters: false }),
  ]);
  const shareOf = new Map(shares.map((share) => [share.appuserKey.appuserKey, share.access]));
  const owner = ownerKeyOf(account);
  const members = memberships.map((membership): AccountShareMemberDto => {
    const appuserKey = membership.appuserKey.appuserKey;
    const stored = shareOf.get(appuserKey) ?? null;
    const access = resolveAccountAccess({ isPrivate: account.isPrivate, ownerAppuserKey: owner, share: stored }, { appuserKey, householdRole: membership.role });
    return {
      access: access ?? 'hidden',
      appuserKey,
      firstName: membership.appuserKey.firstName ?? null,
      isAccountOwner: appuserKey === owner,
      lastName: membership.appuserKey.lastName ?? null,
      role: membership.role,
      share: stored ? shareAccessOf(stored) : null,
    };
  });
  members.sort((a, b) => Number(b.isAccountOwner) - Number(a.isAccountOwner));
  return { accountKey: account.accountKey, canManage: canManageShares(account, actor), isPrivate: account.isPrivate, members };
}

/**
 * Replace who the account is shared with. Shared with the household (`isPrivate: false`): no
 * shares, everyone can edit. Private: its owner and the members listed. Each member listed must be
 * an active member other than the account's owner.
 */
export async function setAccountShares(em: EntityManager, accountKey: number, actor: AccountActor, input: AccountSharesInput): Promise<AccountSharesDto> {
  if (!input.isPrivate && input.shares.length > 0) throw new BadRequestError('A shared account takes no shares', ERROR_CODE.ACCOUNT_SHARE_INVALID);
  return em.transactional(async (tx) => {
    const account = await visibleAccount(tx, accountKey, actor);
    if (!canManageShares(account, actor)) {
      throw new ForbiddenError('Only the account owner or the household owner can change who sees this account.', ERROR_CODE.ACCOUNT_SHARE_MANAGER_REQUIRED);
    }
    const owner = ownerKeyOf(account);
    const members = await tx.find(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: getRef(tx, Tenant, actor.tenantKey) }, { filters: false });
    const memberKeys = new Set(members.map((membership) => membership.appuserKey.appuserKey));
    for (const share of input.shares) {
      if (share.appuserKey === owner) throw new BadRequestError('The account owner always has access', ERROR_CODE.ACCOUNT_SHARE_INVALID);
      if (!memberKeys.has(share.appuserKey)) throw new BadRequestError('Shares are only for members of this household', ERROR_CODE.ACCOUNT_SHARE_INVALID);
    }

    account.isPrivate = input.isPrivate;
    const wanted = new Map(input.shares.map((share) => [share.appuserKey, share.access === 'write' ? AccountShareAccess.WRITE : AccountShareAccess.READ]));
    const existing = await tx.find(AccountShare, { accountKey: getRef(tx, Account, account.accountKey) }, { filters: false });
    for (const share of existing) {
      const access = wanted.get(share.appuserKey.appuserKey);
      if (access === undefined) tx.remove(share);
      else {
        share.access = access;
        share.deletedAt = undefined;
        wanted.delete(share.appuserKey.appuserKey);
      }
    }
    for (const [appuserKey, access] of wanted) {
      tx.create(AccountShare, { access, accountKey: account, appuserKey: getRef(tx, Appuser, appuserKey), tenantKey: getRef(tx, Tenant, actor.tenantKey) }, { partial: true });
    }
    await tx.flush();
    // Described as it now stands, even when the caller (a household owner) just hid it from themselves.
    return describe(tx, account, actor);
  });
}

/**
 * The old privacy switch (`PATCH /v1/account/:accountId { isPrivate }`), kept for older app builds:
 * private with no shares (owner only), or shared with the household. Same permission as the shares.
 */
export async function setAccountPrivacy(em: EntityManager, account: Account, actor: AccountActor, isPrivate: boolean): Promise<void> {
  if (account.isPrivate === isPrivate) return;
  if (!canManageShares(account, actor)) {
    throw new ForbiddenError('Only the account owner or the household owner can change who sees this account.', ERROR_CODE.ACCOUNT_OWNER_REQUIRED);
  }
  account.isPrivate = isPrivate;
  // Shares count only while the account is private; going shared drops them, so they never come back unseen.
  if (!isPrivate) await em.nativeDelete(AccountShare, { accountKey: getRef(em, Account, account.accountKey) }, { filters: false });
}
