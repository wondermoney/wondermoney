import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { ExpenseGroup } from './ExpenseGroup';
import { Tenant } from './Tenant';

/**
 * A person in an expense group: someone of the household (`appuserKey` set) or someone with no
 * WonderMoney account at all (only a name, and an optional email the household keeps for itself;
 * nothing is ever sent to it).
 *
 * Which kind a member is decides the household's totals: a share (`TransactionSplit` line) of a
 * member of the household is the household's own spending and counts in its category, while a
 * share of anyone else is money the household is owed, so it counts nowhere
 * (`services/transaction/category-lines.ts`). That is why `appuserKey` is fixed when the member is
 * added. "You" in a group is the member whose `appuserKey` is the viewer, worked out per request.
 *
 * The app adds a household member to a group once (checked under the group's lock). A restore may
 * link several to the restoring member, since every member of an export becomes them, so the
 * database does not insist on it.
 *
 * A member with shares, payments or settlements cannot be removed (their balance would vanish).
 */
@Entity({ tableName: 'expense_group_member' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['expenseGroupKey'] })
export class ExpenseGroupMember extends Base {
  /** The household member this person is; null for someone outside the household. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: null | Rel<Appuser>;

  @Property({ length: 254, nullable: true })
  email?: null | string;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => ExpenseGroup, fieldName: 'expense_group_key' })
  expenseGroupKey!: Rel<ExpenseGroup>;

  @PrimaryKey()
  expenseGroupMemberKey!: number;

  @Property({ length: 100 })
  name!: string;

  /** The member's place in the group's list, from 0. */
  @Property({ default: 0 })
  position = 0;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
