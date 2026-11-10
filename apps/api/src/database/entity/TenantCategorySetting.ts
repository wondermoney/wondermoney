import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Category } from './Category';
import { Tenant } from './Tenant';

/**
 * A household's own setting for a category it does not own. A system category is one global row
 * shared by every household, so a household's choice for it ("counts as spending") is kept here
 * instead of on the row. One row per household and category; see
 * `services/transaction/category-spending.ts` for how it combines with the category's own flag.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Unique({ name: 'tenant_category_setting_tenant_category_unique', properties: ['tenantKey', 'categoryKey'] })
export class TenantCategorySetting extends Base {
  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key' })
  categoryKey!: Rel<Category>;

  /** Overrides `Category.countsAsSpending` for this household. */
  @Property()
  countsAsSpending!: boolean;

  @PrimaryKey()
  tenantCategorySettingKey!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
