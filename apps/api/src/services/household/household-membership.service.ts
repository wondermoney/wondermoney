import type { EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { Tenant } from '@entity/Tenant';
import { BadRequestError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';

function ownerKeyOf(tenant: Tenant): number {
  return (tenant.ownerAppuserKey as unknown as { appuserKey: number }).appuserKey;
}

/**
 * Revoke a departing member's bank connections: the household keeps
 * the member's historical accounts/transactions, but their live bank connections are
 * soft-deleted so the household stops pulling their bank feed — the scheduled refresh
 * only picks up connections with no `deletedAt`. Mirrors the manual unlink behaviour
 * (local soft-delete). Enable Banking connections are what actually sync; legacy
 * requisitions are revoked too so neither provider's rows linger.
 */
async function revokeRequisitionsFor(em: EntityManager, tenant: Tenant, targetAppuserKey: number, now: Date): Promise<void> {
  const owner = { appuserKey: { appuserKey: targetAppuserKey }, deletedAt: undefined, tenantKey: tenant };
  const requisitions = await em.find(NordigenRequisition, owner);
  const connections = await em.find(EnableBankingConnection, owner);
  for (const revoked of [...requisitions, ...connections]) {
    revoked.deletedAt = now;
  }
}

/**
 * Owner removes a member, or a member leaves (self). The owner cannot be removed
 * here (they anchor the household — dissolving it is account deletion).
 * The member's data stays; their bank connections are revoked.
 */
export async function leaveOrRemoveMember(em: EntityManager, tenant: Tenant, requester: Appuser, targetAppuserKey: number): Promise<void> {
  const ownerKey = ownerKeyOf(tenant);
  if (targetAppuserKey === ownerKey) {
    throw new BadRequestError('The household owner cannot be removed. Delete your account to dissolve the household.');
  }
  const isOwnerRequest = requester.appuserKey === ownerKey;
  const isSelf = requester.appuserKey === targetAppuserKey;
  if (!isOwnerRequest && !isSelf) {
    throw new ForbiddenError('Only the household owner can remove another member.', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
  }

  const membership = await em.findOne(AppuserTenant, {
    appuserKey: { appuserKey: targetAppuserKey },
    deletedAt: undefined,
    recordActive: true,
    tenantKey: tenant,
  });
  if (!membership) {
    throw new NotFoundError('Household member not found');
  }

  const now = new Date();
  membership.recordActive = false;
  membership.deletedAt = now;
  await revokeRequisitionsFor(em, tenant, targetAppuserKey, now);
  await em.persist(membership).flush();
}

/**
 * Owner account deletion: tear down the household — deactivate every
 * OTHER member of each tenant this user owns and revoke their bank connections.
 * The account-deletion service already handles the owner's own rows; this covers
 * the partner. Runs inside the deletion transaction (no flush here).
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
      await revokeRequisitionsFor(em, tenant, membership.appuserKey.appuserKey, now);
    }
  }
}
