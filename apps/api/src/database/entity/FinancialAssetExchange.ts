import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToMany, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Currency } from './Currency';
import { FinancialAssetExchangeAlias } from './FinancialAssetExchangeAlias';

@Entity()
export class FinancialAssetExchange {
  @Property({ unique: true })
  acronym!: string;

  @ManyToMany({
    fixedOrder: true,
    inverseJoinColumn: 'financial_asset_exchange_alias_key',
    joinColumn: 'financial_asset_exchange_key',
    pivotTable: 'financial_asset_exchange_aliases',
  })
  aliases = new Collection<FinancialAssetExchangeAlias>(this);

  @Property({ nullable: true })
  country?: string;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: true })
  currencyKey?: Rel<Currency>;

  @PrimaryKey()
  financialAssetExchangeKey!: number;

  @Property({ fieldName: 'logo_url', nullable: true })
  logoUrl?: string;

  @Property({ unique: true })
  name!: string;
}
