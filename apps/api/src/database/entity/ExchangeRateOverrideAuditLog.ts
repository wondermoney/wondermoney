import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { ExchangeRateOverride } from './ExchangeRateOverride';
import { Tenant } from './Tenant';

export enum ExchangeRateOverrideAuditAction {
  CREATED = 'created',
  DELETED = 'deleted',
  UPDATED = 'updated',
}

/**
 * Append-only trail of changes to a household's exchange-rate overrides: one row per create,
 * update or delete, with the member who made it. Written in the same database transaction as the
 * change; never updated or deleted through the app.
 */
@Entity({ tableName: 'exchange_rate_override_audit_log' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'exchange_rate_override_audit_log_override_created_idx', properties: ['exchangeRateOverrideKey', 'createdAt'] })
export class ExchangeRateOverrideAuditLog extends Base {
  @Enum(() => ExchangeRateOverrideAuditAction)
  action!: ExchangeRateOverrideAuditAction;

  /** The member who made the change. Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'actor_appuser_key', nullable: true })
  actorAppuserKey?: Rel<Appuser>;

  /** `{ field: { from, to } }` for `date` and `rate`; `from` is null on a create, `to` on a delete. */
  @Property({ columnType: 'jsonb' })
  changes!: Record<string, { from: unknown; to: unknown }>;

  @PrimaryKey()
  exchangeRateOverrideAuditLogKey!: number;

  @ManyToOne({ cascade: [], entity: () => ExchangeRateOverride, fieldName: 'exchange_rate_override_key' })
  exchangeRateOverrideKey!: Rel<ExchangeRateOverride>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
