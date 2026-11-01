import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { FinancialAssetIndustry } from './FinancialAssetIndustry';
import { FinancialAssetSector } from './FinancialAssetSector';

@Entity()
export class FinancialAssetCompany {
  @Property({ columnType: 'text', nullable: true })
  description?: string;

  @PrimaryKey()
  financialAssetCompanyKey!: number;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAssetIndustry,
    fieldName: 'financial_asset_industry_key',
    nullable: true,
  })
  financialAssetIndustryKey?: Rel<FinancialAssetIndustry>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAssetSector,
    fieldName: 'financial_asset_sector_key',
    nullable: true,
  })
  financialAssetSectorKey?: Rel<FinancialAssetSector>;

  @Property({ unique: true })
  name!: string;
}
