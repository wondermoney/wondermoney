import type { EntityManager } from '@mikro-orm/core';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';

export async function getDemoTenant(em: EntityManager, demoAppuser: Appuser): Promise<Tenant> {
  const demoLinks = await em.find(
    AppuserTenant,
    { appuserKey: demoAppuser, deletedAt: null, recordActive: true },
    { populate: ['tenantKey', 'tenantKey.ownerAppuserKey'] },
  );
  if (demoLinks.length > 1) {
    throw new Error(`Expected a single active demo appuser-tenant link, found ${demoLinks.length}.`);
  }

  const demoLink = demoLinks[0];
  if (demoLink) {
    const tenant = demoLink.tenantKey;
    if (tenant.ownerAppuserKey.appuserKey !== demoAppuser.appuserKey) {
      throw new Error('Resolved demo tenant is not owned by the demo appuser.');
    }

    return tenant;
  }

  const ownedTenants = await em.find(Tenant, { ownerAppuserKey: demoAppuser });
  if (ownedTenants.length > 1) {
    throw new Error(`Expected a single tenant owned by the demo appuser, found ${ownedTenants.length}.`);
  }

  const ownerTenant = ownedTenants[0];
  if (ownerTenant) {
    return ownerTenant;
  }

  const legacyDemoTenants = await em.find(Tenant, { name: 'Demo', ownerAppuserKey: demoAppuser });
  if (legacyDemoTenants.length !== 1) {
    throw new Error(
      `Expected a single legacy demo tenant owned by the demo appuser, found ${legacyDemoTenants.length}.`,
    );
  }

  const [legacyDemoTenant] = legacyDemoTenants;
  if (!legacyDemoTenant) {
    throw new Error('Expected a single legacy demo tenant owned by the demo appuser.');
  }

  return legacyDemoTenant;
}
