import { Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

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
@Unique({ properties: ['transactionMerchantKey', 'categoryKey', 'source', 'appuserKey'] })
export class TransactionCategoryStats extends Base {
  // Per-user scoping (RAD-342 G4): a tenant is a household of up to two members and each member's
  // merchant→category votes must stay their own. Nullable because rows written before G4 predate the
  // dimension; the backfill attributes those to the tenant owner. New writes always set it.
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key' })
  categoryKey!: Rel<Category>;

  @Property({ columnType: 'int', default: 0 })
  count!: number;

  @Property({ default: false })
  default!: boolean;

  @Enum(() => Source)
  source!: Source;

  @PrimaryKey()
  transactionCategoryStatsKey!: number;

  @ManyToOne({ cascade: [], entity: () => TransactionMerchant, fieldName: 'transaction_merchant_key' })
  transactionMerchantKey!: Rel<TransactionMerchant>;
}
