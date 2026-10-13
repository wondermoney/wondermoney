// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { EntityManager } from '@mikro-orm/core';

import { TenantStatus } from '@entity/TenantStatus';
import { Seeder } from '@mikro-orm/seeder';

export class TenantStatusSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    em.create(TenantStatus, { description: 'Active' });
    em.create(TenantStatus, { description: 'Inactive' });
  }
}
