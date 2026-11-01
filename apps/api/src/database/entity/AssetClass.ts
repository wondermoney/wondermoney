import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class AssetClass {
  @PrimaryKey()
  assetClassKey!: number;

  @Property({ unique: true })
  name!: string;

  @Property()
  sortOrder!: number;
}
