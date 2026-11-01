import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { FinancialAssetCompany } from './FinancialAssetCompany';
import { FinancialAssetExchange } from './FinancialAssetExchange';
import { FinancialAssetType } from './FinancialAssetType';

@Entity()
@Index({
  expression: 'CREATE INDEX idx_financial_asset_symbol ON financial_asset (symbol)',
  name: 'idx_financial_asset_symbol',
})
export class FinancialAsset extends Base {
  @Property({ nullable: true })
  cik?: string;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: true })
  currencyKey?: Rel<Currency>;

  @Property({ nullable: true })
  cusip?: string;

  @Property({ columnType: 'numeric', nullable: true })
  environmentScore?: number;

  @Property({ columnType: 'numeric', nullable: true })
  esgScore?: number;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAssetCompany,
    fieldName: 'financial_asset_company_key',
    nullable: true,
  })
  financialAssetCompanyKey?: Rel<FinancialAssetCompany>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAssetExchange,
    fieldName: 'financial_asset_exchange_key',
    nullable: true,
  })
  financialAssetExchangeKey?: Rel<FinancialAssetExchange>;

  @PrimaryKey()
  financialAssetKey!: number;

  @ManyToOne({ cascade: [], entity: () => FinancialAssetType, fieldName: 'financial_asset_type_key' })
  financialAssetTypeKey?: Rel<FinancialAssetType>;

  @Property({ columnType: 'numeric', nullable: true })
  governanceScore?: number;

  @Property()
  isActivelyTrading = true;

  @Property({ nullable: true })
  isin?: string;

  @Property({ nullable: true })
  logoUrl?: string;

  @Property()
  name?: string;

  @Property({ columnType: 'numeric', nullable: true })
  socialScore?: number;

  @Property({ unique: true })
  symbol!: string;
}
