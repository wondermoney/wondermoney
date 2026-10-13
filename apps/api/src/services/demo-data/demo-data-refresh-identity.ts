import type { EntityManager } from '@mikro-orm/core';

import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Tenant, TenantType } from '@entity/Tenant';

export type DemoRefreshIdentityMissingReason =
  | 'missing-demo-appuser'
  | 'missing-demo-appuser-tenant-link'
  | 'missing-demo-tenant';

export type DemoRefreshIdentityResolution =
  | { appuser: Appuser; appuserTenant: AppuserTenant; status: 'found'; tenant: Tenant }
  | { reason: DemoRefreshIdentityMissingReason; status: 'missing' };

export async function resolveDemoRefreshIdentity(
  em: EntityManager,
): Promise<DemoRefreshIdentityResolution> {
  const appusers = await em.find(Appuser, {
    accountType: AppuserAccountType.DEMO,
    deletedAt: null,
    emailAddress: demoPersona.email,
    recordActive: true,
  });

  if (appusers.length === 0) return { reason: 'missing-demo-appuser', status: 'missing' };
  if (appusers.length !== 1) throw new Error(`Expected exactly one demo appuser, found ${appusers.length}`);
  const appuser = appusers[0];
  if (!appuser) throw new Error('Expected exactly one demo appuser, found 0');

  const tenants = await em.find(Tenant, {
    deletedAt: null,
    name: demoPersona.householdName,
    recordActive: true,
    tenantType: TenantType.DEMO,
  });

  if (tenants.length === 0) return { reason: 'missing-demo-tenant', status: 'missing' };
  if (tenants.length !== 1) throw new Error(`Expected exactly one demo tenant, found ${tenants.length}`);
  const tenant = tenants[0];
  if (!tenant) throw new Error('Expected exactly one demo tenant, found 0');

  const tenantOwner = (tenant as { ownerAppuserKey?: null | number | undefined | { appuserKey?: number } })
    .ownerAppuserKey;
  const tenantOwnerKey = typeof tenantOwner === 'object' && tenantOwner ? tenantOwner.appuserKey : tenantOwner;
  if (tenantOwnerKey === null || tenantOwnerKey === undefined) {
    throw new Error('Demo tenant owner is missing');
  }
  if (tenantOwnerKey !== appuser.appuserKey) {
    throw new Error('Demo tenant owner does not match demo appuser');
  }

  const links = await em.find(AppuserTenant, {
    appuserKey: appuser,
    deletedAt: null,
    recordActive: true,
    tenantKey: tenant,
  });

  if (links.length === 0) return { reason: 'missing-demo-appuser-tenant-link', status: 'missing' };
  if (links.length !== 1) throw new Error(`Expected exactly one demo appuser-tenant link, found ${links.length}`);
  const appuserTenant = links[0];
  if (!appuserTenant) throw new Error('Expected exactly one demo appuser-tenant link, found 0');

  return { appuser, appuserTenant, status: 'found', tenant };
}
