import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

@Entity()
export class AccountType {
  @PrimaryKey()
  accountTypeKey!: number;

  @Property({ length: 255 })
  @Unique()
  description!: string;
}
