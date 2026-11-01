import { Collection } from '@mikro-orm/core';
import { Entity, ManyToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { FinancialAssetExchange } from './FinancialAssetExchange';

@Entity()
export class FinancialAssetExchangeAlias {
  @ManyToMany(() => FinancialAssetExchange, (fae) => fae.aliases)
  exchanges = new Collection<FinancialAssetExchange>(this);

  @PrimaryKey()
  financialAssetExchangeAliasKey!: number;

  @Property()
  @Unique()
  name!: string;
}
