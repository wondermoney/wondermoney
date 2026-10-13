import { Entity, ManyToOne, PrimaryKey, PrimaryKeyProp, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

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

  @Property({ columnType: 'numeric' })
  volume!: number;
}
