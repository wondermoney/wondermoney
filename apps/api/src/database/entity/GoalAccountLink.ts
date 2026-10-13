import { Entity, Filter, Index, ManyToOne, PrimaryKey } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Base } from './BaseEntity';
import { Goal } from './Goal';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({
  expression:
    'CREATE UNIQUE INDEX goal_account_link_goal_account_active_uq ON goal_account_link (goal_key, account_key) WHERE deleted_at IS NULL',
  name: 'goal_account_link_goal_account_active_uq',
})
@Index({ properties: ['goalKey', 'accountKey'] })
@Index({ properties: ['accountKey'] })
export class GoalAccountLink extends Base {
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @PrimaryKey()
  goalAccountLinkKey!: number;

  @ManyToOne({ cascade: [], entity: () => Goal, fieldName: 'goal_key' })
  goalKey!: Rel<Goal>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
