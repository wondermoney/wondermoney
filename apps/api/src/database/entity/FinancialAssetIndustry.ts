import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class FinancialAssetIndustry {
  @PrimaryKey()
  financialAssetIndustryKey!: number;

  @Property({ unique: true })
  name!: string;
}
