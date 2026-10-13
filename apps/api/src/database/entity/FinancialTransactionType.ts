import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class FinancialTransactionType {
  @PrimaryKey()
  financialTransactionTypeKey!: number;

  @Property({ unique: true })
  name!: string;
}
