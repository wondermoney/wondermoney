import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Currency } from './Currency';

@Entity()
@Unique({ properties: ['fromCurrency', 'toCurrency', 'date'] })
export class ExchangeRate {
  @Property({ columnType: 'timestamptz' })
  date: Date;

  @PrimaryKey()
  exchangeRateKey!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'from_currency_key', nullable: false })
  fromCurrency: Rel<Currency>;

  @Property({ columnType: 'numeric' })
  rate: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'to_currency_key', nullable: false })
  toCurrency: Rel<Currency>;
}
