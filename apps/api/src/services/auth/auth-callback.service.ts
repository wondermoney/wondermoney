import { type EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { BadRequestError, InternalServerError } from '@utils/errors';

export function isAppError(error: unknown): error is BadRequestError | InternalServerError {
  return error instanceof BadRequestError || error instanceof InternalServerError;
}

/**
 * The household a signing-in user belongs to, created on first sign-in.
 *
 * 1. An active membership wins: someone who joined another household by invite stays there,
 *    and signing in never gives them a second, empty household of their own.
 * 2. Otherwise the household they own, with their owner membership restored: someone who left
 *    or was removed from another household goes back to their own (empty) one.
 * 3. Otherwise a new household they own.
 */
export async function provisionHomeTenant(em: EntityManager, appUser: Appuser): Promise<Tenant> {
  const active = await em.findOne(
    AppuserTenant,
    { appuserKey: appUser, deletedAt: null, recordActive: true, tenantKey: { deletedAt: null, recordActive: true } },
    { orderBy: { appuserTenantKey: 'ASC' }, populate: ['tenantKey'] },
  );
  if (active) return active.tenantKey;

  const owned = await em.findOne(Tenant, { deletedAt: null, ownerAppuserKey: appUser, recordActive: true }, { orderBy: { tenantKey: 'ASC' } });
  const tenant = owned ?? await createTenant(em, appUser);
  const link = await em.findOne(AppuserTenant, { appuserKey: appUser, tenantKey: tenant }, { orderBy: { appuserTenantKey: 'DESC' } });
  if (link) {
    link.recordActive = true;
    link.deletedAt = undefined;
    link.role = HouseholdRole.OWNER;
    await em.flush();
  } else {
    await em.getRepository(AppuserTenant).createAppuserTenant(appUser, tenant);
  }
  return tenant;
}

async function createTenant(em: EntityManager, appUser: Appuser): Promise<Tenant> {
  const activeTenantStatus = await em.getRepository(TenantStatus).getActiveStatus();
  if (activeTenantStatus === null) {
    throw new InternalServerError("TenantStatus not found for 'active'");
  }
  return em.getRepository(Tenant).createTenant(appUser, activeTenantStatus);
}
