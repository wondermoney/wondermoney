import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity()
export class TransactionStatus {
  @Property({ unique: true })
  name!: string;

  @PrimaryKey()
  transactionStatusKey!: number;
}
