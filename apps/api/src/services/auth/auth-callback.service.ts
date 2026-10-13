import { type EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { BadRequestError, InternalServerError } from '@utils/errors';

export async function ensureAppuserTenantLink(em: EntityManager, appUser: Appuser, tenant: Tenant) {
  const existingLink = await em.findOne(AppuserTenant, {
    appuserKey: appUser,
    tenantKey: tenant,
  });

  if (!existingLink) {
    await em.getRepository(AppuserTenant).createAppuserTenant(appUser, tenant);
  }
}

export async function getOrCreateTenant(em: EntityManager, appUser: Appuser) {
  const existingTenant = await em.findOne(Tenant, { ownerAppuserKey: appUser });
  if (existingTenant) {
    return existingTenant;
  }

  const activeTenantStatus = await em.getRepository(TenantStatus).getActiveStatus();
  if (activeTenantStatus === null) {
    throw new InternalServerError("TenantStatus not found for 'active'");
  }

  return em.getRepository(Tenant).createTenant(appUser, activeTenantStatus);
}

export function isAppError(error: unknown): error is BadRequestError | InternalServerError {
  return error instanceof BadRequestError || error instanceof InternalServerError;
}
