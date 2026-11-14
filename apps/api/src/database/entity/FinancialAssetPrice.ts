import { PrimaryKeyProp } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { FinancialAsset } from './FinancialAsset';

@Entity()
export class FinancialAssetPrice {
  @PrimaryKey({ columnType: 'timestamptz' })
  date!: Date;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAsset,
    fieldName: 'financial_asset_key',
    nullable: false,
    primary: true,
  })
  financialAssetKey?: Rel<FinancialAsset>;

  @Property({ columnType: 'numeric' })
  price!: number;

  [PrimaryKeyProp]?: [number, Date]; // this is needed for proper type checks in `FilterQuery`

  /**
   * The market-data provider that supplied the price (`eodhd`, `stooq`, `coingecko`; see
   * `services/market-data/registry.ts`). Null for prices stored before sources were recorded. A
   * household's manual price is a `FinancialAssetPriceOverride`, never a row here.
   */
  @Property({ length: 32, nullable: true })
  source?: null | string;

  @Property({ columnType: 'numeric' })
  volume!: number;
}
