// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Seeder } from '@mikro-orm/seeder';

import { demoPersona } from './demo/demo-fixtures';
import { createUser } from '../utils/better-auth-user';
import { getSeedNow, requireSeedDependency, seedPassword } from '../utils/seed';

export class AppuserSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const seedNow = getSeedNow();
    const eurCurrency = requireSeedDependency(
      ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
      'EUR currency',
    );

    // Each seeded Appuser needs a real better-auth credential user (not just a placeholder
    // externalUserId) so it can actually sign in via better-auth email/password.
    const adminAuthUser = await createUser({ email: 'admin@wonder.money', name: 'Admin', password: seedPassword('ADMIN') });
    const demoAuthUser = await createUser({ email: demoPersona.email, name: `${demoPersona.firstName} ${demoPersona.lastName}`, password: seedPassword('DEMO') });
    const emptyAuthUser = await createUser({ email: 'empty@wonder.money', name: 'Empty', password: seedPassword('EMPTY') });

    ctx._ADMIN_appuser = em.create(Appuser, {
      currencyKey: eurCurrency,
      emailAddress: 'admin@wonder.money',
      emailAuthenticated: seedNow,
      externalUserId: adminAuthUser.id,
      firstName: 'Admin',
      accountType: AppuserAccountType.ADMIN,
      onboarding: [1, 2, 3, 4, 5],
    });
    ctx._DEMO_appuser = em.create(Appuser, {
      currencyKey: eurCurrency,
      emailAddress: demoPersona.email,
      emailAuthenticated: seedNow,
      externalUserId: demoAuthUser.id,
      firstName: demoPersona.firstName,
      accountType: AppuserAccountType.DEMO,
      lastName: demoPersona.lastName,
      onboarding: [1, 2, 3, 4, 5],
    });
    ctx._EMPTY_appuser = em.create(Appuser, {
      currencyKey: eurCurrency,
      emailAddress: 'empty@wonder.money',
      emailAuthenticated: seedNow,
      externalUserId: emptyAuthUser.id,
      firstName: 'Empty',
      accountType: AppuserAccountType.REGULAR,
      onboarding: [],
    });
  }
}
