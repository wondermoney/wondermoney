import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Tenant } from './Tenant';

/**
 * A household's own exchange rate for one currency pair on one day, set by hand for a pair the
 * rate feed does not cover or a day it got wrong.
 *
 * It is a dated rate like `ExchangeRate`, seen only by its household: the resolver
 * (`services/currency/exchange-rate.ts`) puts the household's overrides and the feed's rates on one
 * timeline and takes the latest on or before the date, the override winning on its own day. It
 * converts `fromCurrency` → `toCurrency` only, never the reverse.
 *
 * One live override per household, pair and day; a deleted one frees the day. Every change is
 * recorded in `ExchangeRateOverrideAuditLog` with the member who made it.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({
  expression: 'CREATE UNIQUE INDEX exchange_rate_override_tenant_pair_date_unique ON exchange_rate_override (tenant_key, from_currency_key, to_currency_key, date) WHERE deleted_at IS NULL',
  name: 'exchange_rate_override_tenant_pair_date_unique',
})
export class ExchangeRateOverride extends Base {
  /** The member who created it. Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: Rel<Appuser>;

  /** The day it is the rate for, at 00:00 UTC (the same convention as `ExchangeRate.date`). */
  @Property({ columnType: 'timestamptz' })
  date!: Date;

  @PrimaryKey()
  exchangeRateOverrideKey!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'from_currency_key' })
  fromCurrency!: Rel<Currency>;

  /** Units of `toCurrency` for one unit of `fromCurrency`. Always positive. */
  @Property({ columnType: 'numeric' })
  rate!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'to_currency_key' })
  toCurrency!: Rel<Currency>;
}
