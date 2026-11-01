import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class FinancialTransactionType {
  @PrimaryKey()
  financialTransactionTypeKey!: number;

  @Property({ unique: true })
  name!: string;
}
