import { Entity, EntityRepositoryType, PrimaryKey, Property, Unique } from '@mikro-orm/core';

import { CurrencyRepository } from '../repositories/CurrencyRepository';

@Entity({ repository: () => CurrencyRepository })
export class Currency {
  @Property({ length: 10 })
  @Unique()
  code!: string;

  @PrimaryKey()
  currencyKey!: number;

  @Property()
  decimalDigits = 2;

  @Property({ length: 255, nullable: true })
  description?: string;

  [EntityRepositoryType]: CurrencyRepository;

  @Property({ default: false })
  isActive = false;

  @Property({ length: 10 })
  num!: string;
}
