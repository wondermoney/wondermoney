import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ManualAssetKind } from '@service/manual-asset/manual-asset-types.js';

import { manualAssetTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Tenant } from './Tenant';

/**
 * Something the household owns that has no market feed: a home, a car, a valuable. Its worth is
 * whatever its valuations (`ManualAssetValuation`) say, never a balance moved by transactions.
 *
 * It belongs to the household; a private one is visible only to its owner, like a private account.
 */
@Entity()
@Filter({ args: false, cond: manualAssetTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'manual_asset_tenant_key_owner_appuser_key_idx', properties: ['tenantKey', 'ownerAppuserKey'] })
export class ManualAsset extends Base {
  /** Set when the asset is archived (sold, written off). It stops counting from that day; earlier history keeps it. */
  @Property({ columnType: 'timestamptz', nullable: true })
  archivedAt?: Date | null;

  /** The currency every valuation and the purchase price are in. */
  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  /** Optional growth rule: percent a year the value compounds by after its latest valuation. Negative depreciates. */
  @Property({ columnType: 'numeric(9, 4)', nullable: true })
  growthAnnualRatePercent?: null | number;

  /** The growth rule leaves the value flat until this day. */
  @Property({ columnType: 'date', nullable: true })
  growthStartDate?: Date | null;

  @Property({ default: false })
  isPrivate = false;

  @Enum(() => ManualAssetKind)
  kind!: ManualAssetKind;

  @PrimaryKey()
  manualAssetKey!: number;

  @Property({ length: 255 })
  name!: string;

  @Property({ columnType: 'text', nullable: true })
  notes?: null | string;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'owner_appuser_key' })
  ownerAppuserKey!: Rel<Appuser>;

  @Property({ columnType: 'date', nullable: true })
  purchaseDate?: Date | null;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  purchasePrice?: null | number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
