import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { TransactionMerchant } from './TransactionMerchant';

export enum Source {
  MANUAL = 'manual',
  OPENAI = 'openai',
  USER = 'user',
}

@Entity()
@Unique({ properties: ['appuserKey', 'transactionMerchantKey', 'categoryKey'] })
export class AppuserMerchantCategory extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  appuserMerchantCategoryKey!: number;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key' })
  categoryKey!: Rel<Category>;

  @Enum(() => Source)
  source!: Source;

  @ManyToOne({ cascade: [], entity: () => TransactionMerchant, fieldName: 'transaction_merchant_key' })
  transactionMerchantKey!: Rel<TransactionMerchant>;
}
