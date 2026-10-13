import {
  Collection,
  Entity,
  EntityRepositoryType,
  Enum,
  Filter,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Recurrency } from '@utils/budget';

import { TENANT_FILTER, tenantOrGlobalCond } from '../filters/tenant-filter';
import { CategoryRepository } from '../repositories/CategoryRepository';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

@Entity({ repository: () => CategoryRepository })
@Filter({ args: false, cond: tenantOrGlobalCond, default: true, name: TENANT_FILTER })
export class Category extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'owner_appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @Property({ default: '#f3f3f3', length: 255 })
  bgColor: string;

  @PrimaryKey()
  categoryKey!: number;

  @OneToMany(() => Category, (category) => category.parentCategory)
  childCategory = new Collection<Category>(this);

  [EntityRepositoryType]: CategoryRepository;

  @Property({ length: 255, nullable: true })
  icon?: string;

  @Property({ default: false })
  isDefaultBudgetCategory = false;

  @Property({ default: false })
  isSystemCategory: boolean;

  @Property({ length: 255 })
  name: string;

  @ManyToOne(() => Category, { nullable: true })
  parentCategory?: Rel<Category>;

  /**
   * Household tenant that owns this category (RAD-343). Nullable on purpose: system
   * categories (`isSystemCategory`, no owner) are global and shared across all tenants,
   * so they carry no tenant. Only user-created categories are tenant-scoped.
   */
  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @Property({ default: '#030303', length: 255 })
  textColor: string;

  // Default amount spend by a household
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultHouseholdAmount = 0;

  // Default household multiplier, for each aditional person in the household the amount is multiplied by this value
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultHouseholdMultiplier = 0;

  // Default amount spend by an individual
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualAmount = 0;

  // Default individual multiplier, for each aditional person in the household the amount is multiplied by this value
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualMultiplier = 0;

  // Default amount spend by an individual adult
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualAdultAmount = 0;

  // Default individual adult multiplier, for each aditional person in the household the amount is multiplied by this value
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualAdultMultiplier = 0;

  // Default amount spend by an individual dependent
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualDependentAmount = 0;

  // Default individual dependent multiplier, for each aditional person in the household the amount is multiplied by this value
  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  defaultIndividualDependentMultiplier = 0;

  // Default recurrency for the category (the user can change the recurrency later in BudgetTemplateCategory)
  @Enum(() => Recurrency)
  recurrency: Recurrency = Recurrency.MONTHLY;
}
