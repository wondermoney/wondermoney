import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { LIVE_SPLIT_FILTER, liveSplitCond, TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Category } from './Category';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

/**
 * One line of a split transaction: part of its amount, in its own category.
 *
 * A split is an allocation of one `Transaction`, never extra transaction rows, so the balance
 * chain, bank dedup and every count of transactions are untouched by it. The invariant, kept by
 * `services/transaction/transaction-split.service.ts`: a split has at least two lines, each with
 * the transaction's sign, and their amounts sum exactly to the transaction's effective settlement
 * amount (`editedSettlementAmount` when set, else `settlementAmount`).
 *
 * `amount` is in the settlement (account) currency. A line's amount in the user's currency is not
 * stored: it is derived from the transaction's `appuserSettlementAmount` pro rata by these
 * amounts (`category-lines.ts`), so it always sums to the parent and follows every re-conversion,
 * and a line has no converted amount exactly when its transaction has none.
 *
 * Scoped to the household, and read through the transaction's own tenant filter (MikroORM joins
 * the relation and applies it), so a line on the other member's private account is invisible,
 * like the transaction. Removed lines are soft-deleted and hidden by a default filter,
 * so a populated `Transaction.splits` holds the live lines only.
 */
@Entity({ tableName: 'transaction_split' })
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Filter({ cond: liveSplitCond, default: true, name: LIVE_SPLIT_FILTER })
@Index({ properties: ['transactionKey'] })
export class TransactionSplit extends Base {
  @Property({ columnType: 'numeric(18,4)' })
  amount!: number;

  /** Null for an "uncategorized" line. */
  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key', nullable: true })
  categoryKey?: null | Rel<Category>;

  @Property({ length: 500, nullable: true })
  notes?: null | string;

  /** The line's place in the list the user entered, from 0. */
  @Property()
  position!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;

  @PrimaryKey()
  transactionSplitKey!: number;
}
