import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * How many calls a household made to one AI feature on one UTC day, counted against that
 * feature's daily allowance (`AI_DAILY_LIMIT_<FEATURE>`, see `services/ai/ai-allowance.service.ts`).
 *
 * `usedCount` is incremented atomically before each model call; the unique (tenant_key, feature,
 * day) constraint is the conflict target that makes that upsert race-safe. Not tenant-filtered:
 * it is written by raw SQL keyed on the tenant directly.
 */
@Entity({ tableName: 'ai_usage_allowance' })
@Unique({ name: 'ai_usage_allowance_tenant_key_feature_day_unique', properties: ['tenantKey', 'feature', 'day'] })
export class AiUsageAllowance extends Base {
  @PrimaryKey()
  aiUsageAllowanceKey!: number;

  @Property({ columnType: 'date' })
  day!: string;

  @Property({ length: 32 })
  feature!: string;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Tenant, fieldName: 'tenant_key', updateRule: 'cascade' })
  tenantKey!: Rel<Tenant>;

  @Property({ columnType: 'int', default: 0 })
  usedCount = 0;
}
