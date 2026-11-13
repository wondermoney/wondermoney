import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { ExpenseGroup } from './ExpenseGroup';
import { ExpenseGroupMember } from './ExpenseGroupMember';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/** How the shares were entered, so the form opens the way it was filled in. The lines hold the amounts. */
export enum ExpenseGroupSplitMethod {
  AMOUNTS = 'amounts',
  EQUAL = 'equal',
  PERCENTAGES = 'percentages',
}

/**
 * A household transaction shared in an expense group, and who paid it.
 *
 * The shares are not here: each person's share is a line of the transaction's split
 * (`TransactionSplit` with `expenseGroupMemberKey`), so a shared cost is the same allocation of
 * one transaction as any split, and every total reads it through the category lines
 * (`services/transaction/category-lines.ts`). This row only adds what a split cannot say: the
 * group, and the member who paid (`paidByMemberKey`, a member of the household, since the money
 * left one of the household's accounts).
 *
 * One live row per transaction. It stops counting the moment its transaction has no live group
 * lines left (a later amount change that could not keep the split removes both).
 */
@Entity({ tableName: 'expense_group_expense' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['expenseGroupKey'] })
@Index({
  expression: 'CREATE UNIQUE INDEX expense_group_expense_transaction_live_unique ON expense_group_expense (transaction_key) WHERE deleted_at IS NULL',
  name: 'expense_group_expense_transaction_live_unique',
})
export class ExpenseGroupExpense extends Base {
  @PrimaryKey()
  expenseGroupExpenseKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => ExpenseGroup, fieldName: 'expense_group_key' })
  expenseGroupKey!: Rel<ExpenseGroup>;

  @ManyToOne({ cascade: [], entity: () => ExpenseGroupMember, fieldName: 'paid_by_member_key' })
  paidByMemberKey!: Rel<ExpenseGroupMember>;

  @Enum(() => ExpenseGroupSplitMethod)
  splitMethod!: ExpenseGroupSplitMethod;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
