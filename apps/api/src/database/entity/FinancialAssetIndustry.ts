import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class FinancialAssetIndustry {
  @PrimaryKey()
  financialAssetIndustryKey!: number;

  @Property({ unique: true })
  name!: string;
}
