import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { Transaction } from './Transaction';

export enum Source {
  DETERMINISTIC = 'deterministic',
  MANUAL = 'manual',
  OPENAI = 'openai',
  USER = 'user',
}

@Entity()
@Unique({ properties: ['appuserKey', 'transactionKey', 'categoryKey'] })
export class AppuserTransactionCategory extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  appuserTransactionCategoryKey!: number;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key' })
  categoryKey!: Rel<Category>;

  @Enum(() => Source)
  source!: Source;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
