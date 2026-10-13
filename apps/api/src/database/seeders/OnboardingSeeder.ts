// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { EntityManager } from '@mikro-orm/core';

import { Onboarding } from '@entity/Onboarding';
import { Seeder } from '@mikro-orm/seeder';

export class OnboardingSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    em.create(Onboarding, { description: 'Dashboard', step: 1 });
    em.create(Onboarding, { description: 'Accounts', step: 2 });
    em.create(Onboarding, { description: 'Accounts Transactions', step: 3 });
    em.create(Onboarding, { description: 'Budget - Monthly', step: 4 });
    em.create(Onboarding, { description: 'Budget - Yearly', step: 5 });
  }
}
