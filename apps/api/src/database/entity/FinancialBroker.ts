import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class FinancialBroker {
  @Property()
  displayName!: string;

  @PrimaryKey()
  financialBrokerKey!: number;

  @Property({ unique: true })
  name!: string;
}
