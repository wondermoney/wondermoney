import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { FinancialAsset } from './FinancialAsset';

export const FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES = {
  SPLIT: 'SPLIT',
} as const;

export type FinancialAssetStockAdjustmentType = keyof typeof FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES;

@Entity()
@Index({ name: 'financial_asset_stock_adjustment_asset_date_idx', properties: ['financialAssetKey', 'date'] })
@Index({
  expression:
    'CREATE UNIQUE INDEX financial_asset_stock_adjustment_split_unique_idx ON financial_asset_stock_adjustment (financial_asset_key, date, numerator, denominator) WHERE deleted_at IS NULL AND adjustment_type = \'SPLIT\' AND numerator IS NOT NULL AND denominator IS NOT NULL',
  name: 'financial_asset_stock_adjustment_split_unique_idx',
})
export class FinancialAssetStockAdjustment extends Base {
  @Property({ default: FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES.SPLIT })
  adjustmentType: FinancialAssetStockAdjustmentType = FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES.SPLIT;

  @Property()
  date!: Date;

  @Property({ columnType: 'numeric', nullable: true })
  denominator?: number;

  @Property({ columnType: 'numeric', nullable: true })
  dividend?: number;

  @Property({ columnType: 'numeric', nullable: true })
  factor?: number;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key', nullable: false })
  financialAssetKey!: Rel<FinancialAsset>;

  @PrimaryKey()
  financialAssetStockAdjustmentKey!: number;

  @Property({ unique: true })
  name!: string;

  @Property({ columnType: 'numeric', nullable: true })
  numerator?: number;

  @Property({ nullable: true })
  source?: string;

  @Property({ nullable: true })
  sourceLabel?: string;

  @Property({ columnType: 'numeric', nullable: true })
  splitRatio?: number;
}
