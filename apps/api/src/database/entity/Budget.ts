import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { BudgetTemplateCategory } from './BudgetTemplateCategory';
import { BudgetTemplateIncome } from './BudgetTemplateIncome';
import { Currency } from './Currency';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
export class Budget extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  budgetKey!: number;

  @OneToMany(() => BudgetTemplateCategory, (BudgetTemplateCategory) => BudgetTemplateCategory.budgetKey)
  budgetTemplatesCategory = new Collection<BudgetTemplateCategory>(this);

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @Property({ nullable: true })
  description?: string;

  @OneToMany({ cascade: [], entity: () => BudgetTemplateIncome, mappedBy: 'budgetKey', nullable: true })
  incomes?: BudgetTemplateIncome[];

  @Property({ default: 'My Budget' })
  name!: string;

  @Property({ default: 1 })
  numAdults!: number;

  @Property({ default: 0 })
  numDependents!: number;

  // Household tenant that owns this budget. Budgets are shared household-wide.
  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
