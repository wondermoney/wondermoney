import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { ExpenseGroupMember } from './ExpenseGroupMember';
import { Tenant } from './Tenant';

/**
 * A group of people who share costs: a trip, a flat, a dinner club. Its members may be people of
 * the household or people with no WonderMoney account (`ExpenseGroupMember`).
 *
 * A group adds no money and no rows to the books. A cost shared in a group is a household
 * transaction split across members: each person's share is a `TransactionSplit` line carrying
 * the member (`TransactionSplit.expenseGroupMemberKey`), and `ExpenseGroupExpense` says who paid.
 * What people pay each other back is an `ExpenseGroupSettlement`. Balances (who owes whom) are
 * computed from those, never stored (`services/expense-group/`).
 *
 * Household-wide, like tags: every member of the household sees and manages every group. Which of
 * a group's expenses a member sees follows the transaction's own privacy (an expense on another
 * member's private account stays out of their sight, and out of the balances they see).
 *
 * `currencyKey` is the group's default currency, for new settlements and for the order balances
 * are listed in; balances themselves are kept per currency.
 */
@Entity({ tableName: 'expense_group' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['tenantKey'] })
export class ExpenseGroup extends Base {
  /** An archived group is kept, with its balances, but no longer offered for new expenses. */
  @Property({ default: false })
  archived = false;

  /** The member who created the group. Null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: null | Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @PrimaryKey()
  expenseGroupKey!: number;

  @OneToMany({ cascade: [], entity: () => ExpenseGroupMember, mappedBy: 'expenseGroupKey', orderBy: { expenseGroupMemberKey: 'ASC', position: 'ASC' } })
  members = new Collection<ExpenseGroupMember>(this);

  @Property({ length: 100 })
  name!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
