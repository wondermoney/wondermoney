import { Collection, Entity, Enum, Index, ManyToMany, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Recurrency } from '@utils/budget';

import { Account } from './Account';
import { Budget } from './Budget';
import { Category } from './Category';

@Entity()
@Index({ properties: ['budgetKey', 'year', 'month'] }) // Index for budget queries by year/month
@Unique({ properties: ['budgetKey', 'categoryKey', 'year', 'month'] })
export class BudgetTemplateCategory {
  @ManyToMany({
    entity: () => Account,
    owner: true,
  })
  accounts = new Collection<Account>(this);

  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  amountBudgeted?: number;

  @Index()
  @ManyToOne({ cascade: [], entity: () => Budget, fieldName: 'budget_key' })
  budgetKey: Rel<Budget>;

  @PrimaryKey()
  budgetTemplateCategoryKey!: number;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key' })
  categoryKey: Rel<Category>;

  @Index()
  @Property()
  month!: number;

  @Enum(() => Recurrency)
  recurrency?: Recurrency = Recurrency.MONTHLY;

  @Index()
  @Property()
  year!: number;
}
