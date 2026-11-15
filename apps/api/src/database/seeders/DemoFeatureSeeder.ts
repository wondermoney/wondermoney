import type { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Tenant, TenantType } from '@entity/Tenant';

import { getSeedNow } from '../utils/seed';
import { upsertDemoFeatures } from './demo/demo-features';
import { demoPersona } from './demo/demo-fixtures';

export class DemoFeatureSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    const appuser = await em.findOneOrFail(
      Appuser,
      { accountType: AppuserAccountType.DEMO, emailAddress: demoPersona.email },
      { populate: ['currencyKey'] },
    );
    const tenant = await em.findOneOrFail(Tenant, { ownerAppuserKey: appuser, tenantType: TenantType.DEMO });
    await upsertDemoFeatures(em, appuser, tenant, getSeedNow());
    await em.flush();
  }
}
