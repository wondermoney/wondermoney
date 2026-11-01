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

  @Property({ fieldName: 'normalized_name', nullable: true })
  normalizedName?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @PrimaryKey()
  transactionMerchantKey!: number;
}
