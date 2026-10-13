import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * Per-tenant, per-day reservation counter for the DeepSeek transaction-enrichment pipeline (RAD-414).
 *
 * One row per (tenant, UTC calendar day). `reservedCount` is incremented atomically before every
 * model call via `reserveTransactionEnrichmentBudget`; the unique (tenant_key, day) constraint is
 * the conflict target that makes that upsert race-safe. Not tenant-filtered on purpose: the worker
 * runs without a tenant context (system bypass) and reserves against the row directly.
 */
@Entity({ tableName: 'transaction_enrichment_budget' })
@Unique({ name: 'transaction_enrichment_budget_tenant_key_day_unique', properties: ['tenantKey', 'day'] })
export class TransactionEnrichmentBudget extends Base {
  @Property({ columnType: 'date' })
  day!: string;

  @Property({ columnType: 'numeric(18, 8)', default: 0 })
  estimatedCostUsd = 0;

  @Property({ columnType: 'int', default: 0 })
  reservedCount = 0;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionEnrichmentBudgetKey!: number;
}
