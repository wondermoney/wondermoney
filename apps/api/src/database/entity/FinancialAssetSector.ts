import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class FinancialAssetSector {
  @PrimaryKey()
  financialAssetSectorKey!: number;

  @Property({ unique: true })
  name!: string;
}
