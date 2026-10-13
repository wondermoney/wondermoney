// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { AppuserTenant } from '@entity/AppuserTenant';
import { Seeder } from '@mikro-orm/seeder';

export class AppuserTenantSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    em.create(AppuserTenant, {
      appuserKey: ctx._ADMIN_appuser,
      tenantKey: ctx._ADMIN_tenant,
    });
    em.create(AppuserTenant, {
      appuserKey: ctx._DEMO_appuser,
      tenantKey: ctx._DEMO_tenant,
    });
    em.create(AppuserTenant, {
      appuserKey: ctx._EMPTY_appuser,
      tenantKey: ctx._EMPTY_tenant,
    });
  }
}
