import { type EntityManager, LockMode } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { BankConnection } from '@entity/BankConnection';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { PushDevice } from '@entity/PushDevice';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import { Tenant } from '@entity/Tenant';
import { endAllAuthSessions } from '@service/auth/better-auth';
import { wipeAccessUrl } from '@service/simplefin/simplefin-credential';
import { BadRequestError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import { householdCan } from './household-permissions';

export interface HouseholdMemberView {
  appuserKey: number;
  emailAddress: string;
  firstName?: string;
  role: HouseholdRole;
}

export interface RemoveMemberDeps {
  /** Ends every session of the removed person (better-auth by default). */
  endSessions?: (externalUserId: string) => Promise<void>;
}

export function findActiveMembership(em: EntityManager, tenant: number | Tenant, appuserKey: number): Promise<AppuserTenant | null> {
  return em.findOne(
    AppuserTenant,
    { appuserKey: { appuserKey }, deletedAt: null, recordActive: true, tenantKey: typeof tenant === 'number' ? { tenantKey: tenant } : tenant },
    { populate: ['appuserKey'] },
  );
}

export function ownerKeyOf(tenant: Tenant): number {
  return (tenant.ownerAppuserKey as unknown as { appuserKey: number }).appuserKey;
}

export function toMemberView(membership: AppuserTenant): HouseholdMemberView {
  return {
    appuserKey: membership.appuserKey.appuserKey,
    emailAddress: membership.appuserKey.emailAddress,
    firstName: membership.appuserKey.firstName,
    role: membership.role,
  };
}

/** The tenant row, locked until the transaction ends: every membership change of one household queues here. */
export async function lockTenant(tx: EntityManager, tenantKey: number): Promise<Tenant> {
  return tx.findOneOrFail(Tenant, { tenantKey }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
}

/**
 * Revoke a departing member's bank connections: the household keeps
 * the member's historical accounts/transactions, but their live bank connections are
 * soft-deleted so the household stops pulling their bank feed — the scheduled refresh
 * only picks up connections with no `deletedAt`. Mirrors the manual unlink behaviour
 * (local soft-delete). Enable Banking connections are what actually sync; legacy
 * requisitions are revoked too so neither provider's rows linger. A connection belongs to the
 * member who made it, so the household's other connections are untouched.
 */
export async function revokeBankConnectionsOf(em: EntityManager, tenant: Tenant, targetAppuserKey: number, now: Date): Promise<void> {
  const owner = { appuserKey: { appuserKey: targetAppuserKey }, deletedAt: null, tenantKey: tenant };
  const requisitions = await em.find(NordigenRequisition, owner, { filters: false });
  const connections = await em.find(EnableBankingConnection, owner, { filters: false });
  const bankConnections = await em.find(BankConnection, owner, { filters: false });
  // The member's SimpleFIN access is their own credential: destroyed, not just unlinked.
  const simplefinConnections = await em.find(SimplefinConnection, owner, { filters: false });
  for (const connection of simplefinConnections) wipeAccessUrl(connection);
  for (const revoked of [...requisitions, ...connections, ...bankConnections, ...simplefinConnections]) {
    revoked.deletedAt = now;
  }
}

/**
 * A manager removes a member below them, or a member leaves (self). The owner cannot be removed
 * or leave (they anchor the household — dissolving it is account deletion). The member's data
 * stays; their bank connections are revoked. A removed person — not one who leaves, whose own
 * client signs out — is also signed out everywhere and their phones stop getting this household's
 * notifications.
 */
export async function leaveOrRemoveMember(
  em: EntityManager,
  tenant: Tenant,
  requester: Appuser,
  requesterRole: HouseholdRole | undefined,
  targetAppuserKey: number,
  deps: RemoveMemberDeps = {},
): Promise<void> {
  const isSelf = requester.appuserKey === targetAppuserKey;
  const removed = await em.transactional(async (tx) => {
    const locked = await lockTenant(tx, tenant.tenantKey);
    if (targetAppuserKey === ownerKeyOf(locked)) {
      throw new BadRequestError('The household owner cannot be removed. Transfer ownership first, or delete your account to dissolve the household.');
    }
    const membership = await findActiveMembership(tx, locked, targetAppuserKey);
    if (!isSelf && !householdCan(requesterRole, { kind: 'removeMember', role: membership?.role ?? HouseholdRole.ADMIN })) {
      throw new ForbiddenError('You can only remove people whose role is below yours.', ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
    }
    if (!membership) throw new NotFoundError('Household member not found');

    const now = new Date();
    membership.recordActive = false;
    membership.deletedAt = now;
    await revokeBankConnectionsOf(tx, locked, targetAppuserKey, now);
    if (!isSelf) await tx.nativeDelete(PushDevice, { appuserKey: { appuserKey: targetAppuserKey } });
    await tx.flush();
    return membership.appuserKey;
  });

  if (!isSelf && removed.externalUserId) {
    const endSessions = deps.endSessions ?? endAllAuthSessions;
    try {
      await endSessions(removed.externalUserId);
    } catch (error) {
      // The membership is already gone, so every request they make is refused; only the sign-out is late.
      logger.error({ appuserKey: removed.appuserKey, error }, 'Could not end the sessions of a removed household member');
    }
  }
}

/**
 * Change another member's role. A manager changes only roles below their own, to a role below
 * their own; nobody changes their own role, and `owner` moves only by transfer.
 */
export async function changeMemberRole(
  em: EntityManager,
  tenant: Tenant,
  actor: Appuser,
  actorRole: HouseholdRole | undefined,
  targetAppuserKey: number,
  role: HouseholdRole,
): Promise<HouseholdMemberView> {
  if (actor.appuserKey === targetAppuserKey) {
    throw new ForbiddenError("You can't change your own role.", ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
  }
  return em.transactional(async (tx) => {
    const locked = await lockTenant(tx, tenant.tenantKey);
    const membership = await findActiveMembership(tx, locked, targetAppuserKey);
    if (!householdCan(actorRole, { from: membership?.role ?? HouseholdRole.OWNER, kind: 'changeRole', to: role })) {
      throw new ForbiddenError('You can only change the roles of people below you, to a role below yours.', ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED);
    }
    if (!membership) throw new NotFoundError('Household member not found');
    membership.role = role;
    await tx.flush();
    return toMemberView(membership);
  });
}

/**
 * The owner hands the household to another member: `Tenant.ownerAppuserKey` and both roles change
 * in one transaction, so the household always has exactly one owner. The old owner stays as admin.
 */
export async function transferOwnership(em: EntityManager, tenant: Tenant, actor: Appuser, targetAppuserKey: number): Promise<void> {
  if (actor.appuserKey === targetAppuserKey) {
    throw new BadRequestError('You already own this household.');
  }
  await em.transactional(async (tx) => {
    const locked = await lockTenant(tx, tenant.tenantKey);
    const current = await findActiveMembership(tx, locked, actor.appuserKey);
    if (ownerKeyOf(locked) !== actor.appuserKey || current?.role !== HouseholdRole.OWNER) {
      throw new ForbiddenError('Only the household owner can transfer ownership.', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
    }
    const next = await findActiveMembership(tx, locked, targetAppuserKey);
    if (!next) throw new NotFoundError('Household member not found');

    locked.ownerAppuserKey = next.appuserKey;
    current.role = HouseholdRole.ADMIN;
    next.role = HouseholdRole.OWNER;
    await tx.flush();
  });
}

/**
 * Owner account deletion: tear down the household — deactivate every
 * OTHER member of each tenant this user owns and revoke their bank connections.
 * The deleted user's own memberships and bank connections, in every household, are the
 * account-deletion service's (`deleteWonderMoneyAccount`). Runs inside the deletion
 * transaction (no flush here).
 */
export async function tearDownHouseholdOnOwnerDeletion(em: EntityManager, ownerAppuserKey: number, now: Date): Promise<void> {
  const ownedTenants = await em.find(Tenant, { ownerAppuserKey: { appuserKey: ownerAppuserKey } });
  for (const tenant of ownedTenants) {
    const otherMemberships = await em.find(
      AppuserTenant,
      { appuserKey: { appuserKey: { $ne: ownerAppuserKey } }, deletedAt: undefined, recordActive: true, tenantKey: tenant },
      { populate: ['appuserKey'] },
    );
    for (const membership of otherMemberships) {
      membership.recordActive = false;
      membership.deletedAt = now;
      await revokeBankConnectionsOf(em, tenant, membership.appuserKey.appuserKey, now);
    }
  }
}
