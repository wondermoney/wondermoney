import type { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { Category } from '@entity/Category';

const PARENT = { bgColor: '#a7f3d0', icon: 'piggy-bank', name: 'INVESTMENTS_AND_SAVINGS', textColor: '#111827' };
const CHILDREN = [
  { icon: 'trending-up', name: 'INVESTMENTS' },
  { icon: 'piggy-bank', name: 'SAVINGS' },
];

/**
 * The "Investments and savings" system category and its children: money moved to a broker, a
 * pension or a savings pot, which is not spending (`countsAsSpending` off). System categories are
 * global, so one row serves every household.
 *
 * Reference data, but unlike the rest of `ReferenceDataSeeder` it must also reach databases seeded
 * before it existed, so it is idempotent: it adds whichever of these rows is missing and changes
 * nothing else. `migrate.ts` runs it on every start. A household's own category with the same name
 * is not touched, and no transaction is recategorized.
 */
export async function ensureInvestmentsAndSavingsCategory(em: EntityManager): Promise<void> {
  const system = { isSystemCategory: true, tenantKey: null };
  const options = { filters: false } as const;
  let parent = await em.findOne(Category, { ...system, deletedAt: null, name: PARENT.name, parentCategory: null }, options);
  if (!parent) {
    parent = em.create(Category, { ...PARENT, countsAsSpending: false, isSystemCategory: true }, { partial: true });
    em.persist(parent);
  }
  for (const child of CHILDREN) {
    const existing = parent.categoryKey === undefined
      ? null
      : await em.findOne(Category, { ...system, deletedAt: null, name: child.name, parentCategory: parent }, options);
    if (existing) continue;
    em.persist(em.create(Category, { ...child, bgColor: PARENT.bgColor, countsAsSpending: false, isSystemCategory: true, parentCategory: parent, textColor: PARENT.textColor }, { partial: true }));
  }
  await em.flush();
}

export class InvestmentsAndSavingsCategorySeeder extends Seeder {
  run(em: EntityManager): Promise<void> {
    return ensureInvestmentsAndSavingsCategory(em);
  }
}
