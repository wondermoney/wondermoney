// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Tenant, TenantType } from '@entity/Tenant';
import { Seeder } from '@mikro-orm/seeder';

import { demoPersona } from './demo/demo-fixtures';

export class TenantSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    ctx._ADMIN_tenant = em.create(Tenant, {
      name: 'Admin',
      ownerAppuserKey: ctx._ADMIN_appuser,
      tentantStatusKey: 1,
    });
    ctx._DEMO_tenant = em.create(Tenant, {
      name: demoPersona.householdName,
      ownerAppuserKey: ctx._DEMO_appuser,
      tenantType: TenantType.DEMO,
      tentantStatusKey: 1,
    });
    ctx._EMPTY_tenant = em.create(Tenant, {
      name: 'Empty',
      ownerAppuserKey: ctx._EMPTY_appuser,
      tentantStatusKey: 1,
    });
  }
}
