import type { EntityManager, Rel } from '@mikro-orm/core';

import { Category } from '@entity/Category';
import type { Tenant } from '@entity/Tenant';

/**
 * The live category with this key that a member of `tenant` may put on a transaction: one of the
 * household's own categories (shared by every member, whoever created it) or a global
 * system category. Soft-deleted categories are never assignable.
 */
export function findAssignableCategory(em: EntityManager, tenant: number | Rel<Tenant>, categoryKey: number): Promise<Category | null> {
  const tenantKey = typeof tenant === 'number' ? { tenantKey: tenant } : tenant;
  return em.findOne(Category, {
    $or: [
      { isSystemCategory: false, tenantKey },
      { isSystemCategory: true, tenantKey: null },
    ],
    categoryKey,
    deletedAt: undefined,
  });
}
