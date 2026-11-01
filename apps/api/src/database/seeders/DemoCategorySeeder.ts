// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { Category } from '@entity/Category';
import { Recurrency } from '@utils/budget';

import { requireSeedDependency } from '../utils/seed';

/**
 * The demo user's own category and subcategories. Demo data, not reference data, so it runs from
 * `DatabaseSeeder` after the demo user exists, whether the system categories were seeded in the
 * same run or were already in the database. Appends to `ctx.subCategories`, which the transaction
 * and budget seeders read.
 */
export class DemoCategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const demoAppuser = requireSeedDependency(ctx._DEMO_appuser, '_DEMO_appuser');
    const systemSubCategories = requireSeedDependency(ctx.subCategories, 'subCategories');

    const demoCategory = em.create(Category, {
      appuserKey: demoAppuser,
      bgColor: '#fecdd3',
      icon: 'question',
      isSystemCategory: false,
      name: 'MyCustomCategory',
      textColor: '#111827',
    });
    const subCategory = (name: string, icon: string, recurrency: Recurrency) =>
      em.create(Category, {
        appuserKey: demoAppuser,
        bgColor: demoCategory.bgColor,
        icon,
        isSystemCategory: false,
        name,
        parentCategory: demoCategory,
        recurrency,
        textColor: demoCategory.textColor,
      });

    ctx._DEMO_category = demoCategory;
    ctx.subCategories = [
      ...systemSubCategories,
      subCategory('MySubCategory A', 'banknote', Recurrency.MONTHLY),
      subCategory('MySubCategory B', 'folder', Recurrency.MONTHLY),
      subCategory('MySubCategory C', 'folder', Recurrency.ANNUALLY),
    ];
  }
}
