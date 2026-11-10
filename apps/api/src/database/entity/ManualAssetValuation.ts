import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { manualAssetValuationTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { ManualAsset } from './ManualAsset';
import { Tenant } from './Tenant';

/**
 * What a manual asset was worth on a day, in the asset's currency. The latest one on or before a
 * date is the asset's value on that date. Recording one never creates a transaction.
 */
@Entity()
@Filter({ args: false, cond: manualAssetValuationTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'manual_asset_valuation_asset_date_idx', properties: ['manualAssetKey', 'valuationDate'] })
export class ManualAssetValuation extends Base {
  @ManyToOne({ cascade: [], entity: () => ManualAsset, fieldName: 'manual_asset_key' })
  manualAssetKey!: Rel<ManualAsset>;

  @PrimaryKey()
  manualAssetValuationKey!: number;

  @Property({ columnType: 'text', nullable: true })
  note?: null | string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Property({ columnType: 'date' })
  valuationDate!: Date;

  @Property({ columnType: 'numeric(18, 4)' })
  value!: number;
}
