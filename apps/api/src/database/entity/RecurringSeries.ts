import {
  Collection,
  Entity,
  Enum,
  Filter,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { RecurringAmountType, RecurringCadence, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

import { recurringSeriesTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { Currency } from './Currency';
import { RecurringOccurrence } from './RecurringOccurrence';
import { Tenant } from './Tenant';

@Entity({ tableName: 'recurring_series' })
@Filter({ args: false, cond: recurringSeriesTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'recurring_series_tenant_status_next_expected_at_index', properties: ['tenantKey', 'status', 'nextExpectedAt'] })
@Index({ name: 'recurring_series_tenant_normalized_merchant_key_index', properties: ['tenantKey', 'normalizedMerchantKey'] })
export class RecurringSeries extends Base {
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  @Enum(() => RecurringAmountType)
  amountType: RecurringAmountType = RecurringAmountType.fixed;

  @Index({ name: 'recurring_series_appuser_key_index' })
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  averageAmount?: number;

  @Enum(() => RecurringCadence)
  cadence: RecurringCadence = RecurringCadence.monthly;

  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  cadenceConfidence = 0;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key', nullable: true })
  categoryKey?: Rel<Category>;

  @Property({ columnType: 'numeric(18, 4)', default: 0 })
  confidenceScore = 0;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: true })
  currencyKey?: Rel<Currency>;

  @Property({ default: 1 })
  detectionVersion = 1;

  @Property({ length: 255 })
  displayName!: string;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  expectedAmount?: number;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  expectedAmountMax?: number;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  expectedAmountMin?: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  firstSeenAt?: Date;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  lastAmount?: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastSeenAt?: Date;

  @Property({ length: 255, nullable: true })
  merchantDisplayName?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  nextExpectedAt?: Date;

  @Property({ length: 255 })
  normalizedMerchantKey!: string;

  @Property({ default: 0 })
  occurrenceCount = 0;

  @OneToMany({ cascade: [], entity: () => RecurringOccurrence, mappedBy: 'recurringSeriesKey' })
  occurrences = new Collection<RecurringOccurrence>(this);

  @PrimaryKey()
  recurringSeriesKey!: number;

  @Enum(() => RecurringSeriesSource)
  source: RecurringSeriesSource = RecurringSeriesSource.detected;

  @Enum(() => RecurringSeriesStatus)
  status: RecurringSeriesStatus = RecurringSeriesStatus.candidate;

  @Index({ name: 'recurring_series_tenant_key_index' })
  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey: Rel<Tenant>;

  @Enum(() => RecurringSeriesType)
  type: RecurringSeriesType = RecurringSeriesType.subscription;
}
