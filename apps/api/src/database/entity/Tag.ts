import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

/**
 * A household-wide label for transactions ("Lisbon trip", "Work expenses"), cutting across
 * categories. Both members see and manage every tag of the household; which tagged
 * transactions a member sees is decided by the transaction's own tenant filter (a tag on the
 * other member's private account stays invisible through `TransactionTag`).
 *
 * Names are unique per household ignoring case, among live rows only, so a deleted tag's name
 * can be used again.
 */
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({
  expression: 'CREATE UNIQUE INDEX tag_tenant_key_lower_name_unique ON tag (tenant_key, lower(name)) WHERE deleted_at IS NULL',
  name: 'tag_tenant_key_lower_name_unique',
})
export class Tag extends Base {
  @Property({ length: 7 })
  color!: string;

  /** The member who created the tag. Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: Rel<Appuser>;

  @Property({ length: 64 })
  name!: string;

  @PrimaryKey()
  tagKey!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
