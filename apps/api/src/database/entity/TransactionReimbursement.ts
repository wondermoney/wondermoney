import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/**
 * A refund or a repayment (money in) linked to the expense it offsets (money out), for `amount`.
 *
 * The link moves no money and creates no row: account balances are untouched. What it changes is
 * what counts as spending and income (`services/transaction/category-lines.ts`): the expense's
 * category lines are reduced by the linked amount, pro rata across a split, and the reimbursement
 * stops counting as income by the same amount.
 *
 * Many-to-many: one reimbursement may cover several expenses and one expense may have several
 * reimbursements. `amount` is positive and in the expense's settlement currency; in v1 both sides
 * must be settled in the same currency, so it is the reimbursement's currency too
 * (`services/transaction/transaction-reimbursement.service.ts` holds every rule: the linked total
 * never exceeds either side, same household, the same members can see both sides).
 *
 * Soft-deleted when unlinked or when either transaction is deleted; one live link per pair.
 */
@Check({ expression: '"amount" > 0', name: 'transaction_reimbursement_amount_positive_check' })
@Check({ expression: '"expense_transaction_key" <> "reimbursement_transaction_key"', name: 'transaction_reimbursement_distinct_sides_check' })
@Entity({ tableName: 'transaction_reimbursement' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'transaction_reimbursement_expense_transaction_key_index', properties: ['expenseTransactionKey'] })
@Index({ name: 'transaction_reimbursement_reimbursement_transaction_key_index', properties: ['reimbursementTransactionKey'] })
// Totals read a household's links at once (`reimbursedAmountsSql`).
@Index({ name: 'transaction_reimbursement_tenant_key_index', properties: ['tenantKey'] })
@Index({
  expression: 'CREATE UNIQUE INDEX transaction_reimbursement_pair_live_unique ON transaction_reimbursement (expense_transaction_key, reimbursement_transaction_key) WHERE deleted_at IS NULL',
  name: 'transaction_reimbursement_pair_live_unique',
})
export class TransactionReimbursement extends Base {
  /** Positive, in the expense's settlement currency. */
  @Property({ columnType: 'numeric(18,4)' })
  amount!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'expense_transaction_key' })
  expenseTransactionKey!: Rel<Transaction>;

  /** The member who made the link; null once that user is gone. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'linked_by_appuser_key', nullable: true })
  linkedByAppuserKey?: null | Rel<Appuser>;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'reimbursement_transaction_key' })
  reimbursementTransactionKey!: Rel<Transaction>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionReimbursementKey!: number;
}
