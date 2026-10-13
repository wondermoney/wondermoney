import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class FinancialAssetSector {
  @PrimaryKey()
  financialAssetSectorKey!: number;

  @Property({ unique: true })
  name!: string;
}
