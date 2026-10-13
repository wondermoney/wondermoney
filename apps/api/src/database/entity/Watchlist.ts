import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';

// A user's Financial Markets watchlist: one row per (appuser, symbol). Personal to
// the appuser but tenant-scoped for consistency with the rest of the domain. Hard
// deleted on removal so re-adding a symbol is trivial and the unique constraint
// stays simple (no soft-deleted rows to collide with).
@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['tenantKey', 'appuserKey'] })
@Unique({ properties: ['appuserKey', 'symbol'] })
export class Watchlist extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ length: 20 })
  symbol!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  watchlistKey!: number;
}
