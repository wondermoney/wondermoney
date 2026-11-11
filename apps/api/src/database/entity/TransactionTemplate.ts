import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ownerAppuserScopedCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { Tenant } from './Tenant';
import { TransactionMerchant } from './TransactionMerchant';

/**
 * Which way the money moves in a template: `out` is spending (web's "out", mobile's
 * Expense), `in` is income (web's "in", mobile's Income). A template carries a direction
 * rather than a transaction type so it stays valid when the household's type list changes;
 * the add form picks a type of that direction when it pre-fills.
 */
export enum TransactionTemplateDirection {
  IN = 'in',
  OUT = 'out',
}

/**
 * A saved manual entry a member can reuse: the account, amount, direction, description,
 * merchant, category and notes of a recurring cash or offline transaction.
 *
 * Owner-scoped: only the member who created it sees and manages it, never their partner
 * (`ownerAppuserScopedCond`). A template may name an account only when that member can see
 * it, so it can never point at the other member's private account.
 *
 * Using a template never creates a transaction: the clients pre-fill the add form and the
 * person reviews it first.
 */
@Entity({ tableName: 'transaction_template' })
@Filter({ args: false, cond: ownerAppuserScopedCond, default: true, name: TENANT_FILTER })
@Index({ name: 'transaction_template_owner_position_idx', properties: ['tenantKey', 'ownerAppuserKey', 'position'] })
export class TransactionTemplate extends Base {
  @Property({ length: 120 })
  name!: string;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'owner_appuser_key' })
  ownerAppuserKey!: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionTemplateKey!: number;

  /** The account to pre-select; null leaves the form's own default. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  /** A positive magnitude; `direction` says which way it moves. Null leaves the amount blank. */
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  amount?: null | number;

  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Category, fieldName: 'category_key', nullable: true })
  categoryKey?: Rel<Category>;

  @Property({ length: 500, nullable: true })
  description?: null | string;

  @Enum({ items: () => TransactionTemplateDirection })
  direction!: TransactionTemplateDirection;

  @Property({ columnType: 'text', nullable: true })
  notes?: null | string;

  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => TransactionMerchant, fieldName: 'transaction_merchant_key', nullable: true })
  transactionMerchantKey?: Rel<TransactionMerchant>;

  /** Ascending order in the member's template list; a new template is appended. */
  @Property({ default: 0 })
  position = 0;
}
