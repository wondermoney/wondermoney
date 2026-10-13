import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Recurrency } from '@utils/budget';

import { Budget } from './Budget';

@Entity()
export class BudgetTemplateIncome {
  @Property({ columnType: 'numeric(18, 2)', default: 0 })
  amount!: number;

  @ManyToOne({ cascade: [], entity: () => Budget, fieldName: 'budget_key' })
  budgetKey: Rel<Budget>;

  @PrimaryKey()
  budgetTemplateIncomeKey!: number;

  @Property({ columnType: 'text', nullable: false })
  name!: string;

  @Enum()
  recurrency: Recurrency = Recurrency.MONTHLY;
}
