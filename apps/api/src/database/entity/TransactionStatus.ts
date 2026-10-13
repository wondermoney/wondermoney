import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class TransactionStatus {
  @Property({ unique: true })
  name!: string;

  @PrimaryKey()
  transactionStatusKey!: number;
}
