import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { AssetClass } from './AssetClass';

@Entity()
export class FinancialAssetType {
  @ManyToOne({ cascade: [], entity: () => AssetClass, fieldName: 'asset_class_key', nullable: true })
  assetClassKey?: Rel<AssetClass>;

  @PrimaryKey()
  financialAssetTypeKey!: number;

  @Property({ unique: true })
  name!: string;
}
