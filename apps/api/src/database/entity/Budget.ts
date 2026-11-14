import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { budgetTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { BudgetTemplateCategory } from './BudgetTemplateCategory';
import { BudgetTemplateIncome } from './BudgetTemplateIncome';
import { Currency } from './Currency';
import { Tenant } from './Tenant';

@Check({ expression: `"period_start_day" between 1 and 28`, name: 'budget_period_start_day_check' })
@Entity()
@Filter({ args: false, cond: budgetTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'budget_tenant_key_owner_appuser_key_idx', properties: ['tenantKey', 'ownerAppuserKey'] })
export class Budget extends Base {
  /** The member who created the budget. Who may see it is `ownerAppuserKey`, not this. */
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

  /**
   * The member a personal budget belongs to; null for a household budget, which the whole household
   * shares. A personal budget is visible to its owner alone: the rest of the household, its owner and
   * admins included, never sees it. The tenant filter (`budgetTenantCond`) hides it from ORM reads,
   * and every raw query over budgets states the same rule. Set when the budget is created (to its
   * creator) and never changed. `no action` on delete: a member's removal must never turn their
   * personal budget into a household one.
   */
  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Appuser, fieldName: 'owner_appuser_key', nullable: true })
  ownerAppuserKey?: null | Rel<Appuser>;

  /**
   * The day of the month a budget month starts on, 1 to 28 (every month has it). With 1 a budget
   * month is its calendar month; with 25, month "2026-11" runs from 25 October to 24 November.
   * Every budget surface reads a month's days from `budgetPeriodRange` (`services/budget/budget-period.ts`).
   */
  @Property({ default: 1 })
  periodStartDay = 1;

  /** Rollover carries an overspend into the next month as well as a surplus. False drops overspend. */
  @Property({ default: true })
  rolloverCarriesOverspend = true;

  // Household tenant the budget belongs to. A household budget is shared with every member of it.
  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
