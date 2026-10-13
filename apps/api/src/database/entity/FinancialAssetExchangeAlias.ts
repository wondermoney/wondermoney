import { Collection, Entity, ManyToMany, PrimaryKey, Property, Unique } from '@mikro-orm/core';

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
