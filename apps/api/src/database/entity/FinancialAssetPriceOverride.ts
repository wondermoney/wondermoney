import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { FinancialAsset } from './FinancialAsset';
import { Tenant } from './Tenant';

/**
 * A household's own price for one security on one day, set by hand when the market feed is
 * wrong, late or missing for it.
 *
 * Market prices (`FinancialAssetPrice`) are shared by every household, so a correction lives
 * here instead and is seen only by its household. `services/portfolio/asset-price.service.ts`
 * puts the household's overrides and the feed's prices on one timeline: on a given day the
 * latest price on or before it counts, and an override wins on its own day. A newer market
 * price therefore replaces an older override as the current price.
 *
 * The price is in the asset's own currency. One live override per household, asset and day;
 * a deleted one frees the day.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({
  expression: 'CREATE UNIQUE INDEX financial_asset_price_override_tenant_asset_date_unique ON financial_asset_price_override (tenant_key, financial_asset_key, date) WHERE deleted_at IS NULL',
  name: 'financial_asset_price_override_tenant_asset_date_unique',
})
export class FinancialAssetPriceOverride extends Base {
  /** The member who last set it. Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: Rel<Appuser>;

  /** Always the asset's currency. */
  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  /** The day it is the price for, at 00:00 UTC (the same convention as `ExchangeRateOverride.date`). */
  @Property({ columnType: 'timestamptz' })
  date!: Date;

  @ManyToOne({ cascade: [], entity: () => FinancialAsset, fieldName: 'financial_asset_key' })
  financialAssetKey!: Rel<FinancialAsset>;

  @PrimaryKey()
  financialAssetPriceOverrideKey!: number;

  @Property({ columnType: 'varchar(500)', nullable: true })
  note?: null | string;

  /** Always positive. */
  @Property({ columnType: 'numeric' })
  price!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
