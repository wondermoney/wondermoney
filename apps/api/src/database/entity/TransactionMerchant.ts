import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantOrGlobalCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: tenantOrGlobalCond, default: true, name: TENANT_FILTER })
@Index({
  expression:
    'CREATE UNIQUE INDEX transaction_merchant_tenant_key_normalized_name_active_uq ON transaction_merchant (tenant_key, normalized_name) WHERE deleted_at is null AND tenant_key is not null AND normalized_name is not null',
  name: 'transaction_merchant_tenant_key_normalized_name_active_uq',
})
export class TransactionMerchant extends Base {
  @Index({
    expression: 'CREATE INDEX transaction_merchant_name_trgm_idx ON transaction_merchant USING gin (name gin_trgm_ops)',
    name: 'transaction_merchant_name_trgm_idx',
  })
  @Property()
  name!: string;

  /**
   * An https image the household chose for this merchant. It wins over the instance's logo
   * template (`services/transaction/merchant-logo.ts`) and is loaded by each viewer's client.
   */
  @Property({ fieldName: 'logo_url', length: 2048, nullable: true })
  logoUrl?: null | string;

  @Property({ fieldName: 'normalized_name', nullable: true })
  normalizedName?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @PrimaryKey()
  transactionMerchantKey!: number;

  /** The merchant's https website. Its domain feeds `MERCHANT_LOGO_URL_TEMPLATE` when that is set. */
  @Property({ length: 500, nullable: true })
  website?: null | string;
}
