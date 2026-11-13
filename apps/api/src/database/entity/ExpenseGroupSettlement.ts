import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { ExpenseGroup } from './ExpenseGroup';
import { ExpenseGroupMember } from './ExpenseGroupMember';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/**
 * One person paying another back in an expense group: `fromMemberKey` paid `toMemberKey`
 * `amount` in `currencyKey` on `settledOn`. It moves the two members' balances towards zero.
 *
 * When the money went through one of the household's accounts, the settlement links that
 * transaction (`transactionKey`), as a reimbursement link does: the transaction then stops
 * counting as income (money a friend paid back) or as spending (money the household paid back)
 * for the linked amount (`services/expense-group/expense-group-sql.ts`). Only a payment between
 * someone of the household and someone outside it can be linked; the transaction is settled in the
 * settlement's currency, moves money the right way, and is not also a reimbursement or a shared
 * expense. A deleted transaction leaves the settlement standing, unlinked.
 */
@Check({ expression: '"amount" > 0', name: 'expense_group_settlement_amount_positive_check' })
@Check({ expression: '"from_member_key" <> "to_member_key"', name: 'expense_group_settlement_distinct_members_check' })
@Entity({ tableName: 'expense_group_settlement' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['expenseGroupKey'] })
@Index({ properties: ['transactionKey'] })
// Totals read a household's linked settlements at once (`groupTakenOffAmountsSql`).
@Index({ properties: ['tenantKey'] })
export class ExpenseGroupSettlement extends Base {
  /** Positive, in `currencyKey`. */
  @Property({ columnType: 'numeric(18,4)' })
  amount!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => ExpenseGroup, fieldName: 'expense_group_key' })
  expenseGroupKey!: Rel<ExpenseGroup>;

  @PrimaryKey()
  expenseGroupSettlementKey!: number;

  @ManyToOne({ cascade: [], entity: () => ExpenseGroupMember, fieldName: 'from_member_key' })
  fromMemberKey!: Rel<ExpenseGroupMember>;

  @Property({ length: 500, nullable: true })
  notes?: null | string;

  /** The member who recorded it; null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'recorded_by_appuser_key', nullable: true })
  recordedByAppuserKey?: null | Rel<Appuser>;

  /** The day the money changed hands, `YYYY-MM-DD`. */
  @Property({ columnType: 'date' })
  settledOn!: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], entity: () => ExpenseGroupMember, fieldName: 'to_member_key' })
  toMemberKey!: Rel<ExpenseGroupMember>;

  /** The household transaction that moved the money, when there is one. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Transaction, fieldName: 'transaction_key', nullable: true })
  transactionKey?: null | Rel<Transaction>;
}
