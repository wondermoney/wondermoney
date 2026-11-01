import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Category } from '@entity/Category';
import { Seeder } from '@mikro-orm/seeder';

export class CategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxCategoryEntities = [];
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#fed7aa',
        icon: 'house',
        isSystemCategory: true,
        name: 'HOUSING',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#dcfce7',
        icon: 'zap',
        isSystemCategory: true,
        name: 'UTILITIES',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#99f6e4',
        icon: 'cooking-pot',
        isSystemCategory: true,
        name: 'FOOD',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#ddd6fe',
        icon: 'navigation',
        isSystemCategory: true,
        name: 'TRANSPORTATION',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#bbf7d0',
        icon: 'tree-palm',
        isSystemCategory: true,
        name: 'ENTERTAINMENT',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#d9f99d',
        icon: 'shield-question',
        isSystemCategory: true,
        name: 'OTHER',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#fde68a',
        icon: 'users',
        isSystemCategory: true,
        name: 'DEPENDENTS',
        textColor: '#111827',
      }),
    );
    ctxCategoryEntities.push(
      // @ts-expect-error - missing properties
      em.create(Category, {
        bgColor: '#fbcfe8',
        icon: 'heart-pulse',
        isSystemCategory: true,
        name: 'WELLNESS',
        textColor: '#111827',
      }),
    );

    const incomeCategory = new Category();
    incomeCategory.bgColor = '#bfdbfe';
    incomeCategory.icon = 'banknote';
    incomeCategory.isSystemCategory = true;
    incomeCategory.name = 'INCOME';
    incomeCategory.textColor = '#111827';
    ctxCategoryEntities.push(incomeCategory);

    ctx['categories'] = ctxCategoryEntities;
  }
}
