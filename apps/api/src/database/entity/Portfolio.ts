import { Collection, LoadStrategy } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { FinancialTransaction } from './FinancialTransaction';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
export class Portfolio extends Base {
  @Property({ default: 'SPY', length: 20, nullable: true })
  benchmarkSymbol?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  closedAt?: Date;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @Property({ length: 500, nullable: true })
  description?: string;

  @Property({ default: false })
  excluded = false;

  @Property({ default: false })
  favored = false;

  @Property({ length: 255 })
  name!: string;

  @PrimaryKey()
  portfolioKey!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'portfolio_owner_appuser_key' })
  portfolioOwnerAppuserKey!: Rel<Appuser>;

  @Property({ columnType: 'timestamptz', nullable: true })
  refreshedAt?: Date;

  @Property({ columnType: 'jsonb', nullable: true })
  targetAllocation?: Record<string, number>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @OneToMany({
    cascade: [],
    entity: () => FinancialTransaction,
    mappedBy: 'portfolioKey',
    nullable: true,
    strategy: LoadStrategy.JOINED,
  })
  transactions = new Collection<FinancialTransaction>(this);
}
