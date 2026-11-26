import type { EntityManager } from '@mikro-orm/postgresql';
import { Seeder } from '@mikro-orm/seeder';

import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Tenant, TenantType } from '@entity/Tenant';

import { getSeedNow } from '../utils/seed';
import { DemoDataRefreshService } from '@service/demo-data/demo-data-refresh.service';
import { upsertDemoHouseholdCore } from '@service/demo-data/demo-household-core';
import { demoPersona } from './demo/demo-fixtures';

export class DemoFeatureSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    const appuser = await em.findOneOrFail(
      Appuser,
      { accountType: AppuserAccountType.DEMO, emailAddress: demoPersona.email },
      { populate: ['currencyKey'] },
    );
    const tenant = await em.findOneOrFail(Tenant, { ownerAppuserKey: appuser, tenantType: TenantType.DEMO });
    await upsertDemoHouseholdCore(em, appuser, tenant);
    await em.flush();
    await new DemoDataRefreshService({ em }).refresh({ asOfDate: getSeedNow() });
  }
}
