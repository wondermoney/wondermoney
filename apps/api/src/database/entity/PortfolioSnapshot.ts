import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Portfolio } from './Portfolio';

@Entity({ tableName: 'portfolio_snapshot' })
@Index({ properties: ['portfolioKey', 'snapshotDate'] })
@Unique({ properties: ['portfolioKey', 'snapshotDate'] })
export class PortfolioSnapshot extends Base {
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  appuserCurrencyCostBasis?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'appuser_currency_key', nullable: true })
  appuserCurrencyKey?: Rel<Currency>;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  appuserCurrencyTotalValue?: number;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  costBasis?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Currency;

  @ManyToOne({ cascade: [], entity: () => Portfolio, fieldName: 'portfolio_key' })
  portfolioKey!: Portfolio;

  @PrimaryKey()
  portfolioSnapshotKey!: number;

  @Property({ columnType: 'date' })
  snapshotDate!: Date;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  totalValue?: number;
}
