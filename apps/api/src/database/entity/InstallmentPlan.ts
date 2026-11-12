import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { installmentPlanTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { Installment } from './Installment';
import { Tenant } from './Tenant';

/**
 * A purchase paid in fixed monthly installments on a card ("3/12").
 *
 * The plan's future installments are **projections**, never transactions: its schedule lives in
 * {@link Installment} rows, and none of them changes a balance, net worth, a transaction list or a
 * budget. When the bank posts an installment, the posted transaction points back at the plan
 * (`Transaction.installmentPlanKey` + `installmentNumber`) and that schedule row reads as paid; the
 * posted row is the only thing that moves money. `services/installment/` holds the rules.
 *
 * `totalAmount` is a positive magnitude in the account's currency; the installments sum to it
 * exactly, with the rounding on the last one. Interest-bearing plans are out of scope.
 */
@Check({ expression: 'total_amount > 0', name: 'installment_plan_total_amount_check' })
@Check({ expression: 'installment_count >= 1', name: 'installment_plan_installment_count_check' })
@Entity({ tableName: 'installment_plan' })
@Filter({ args: false, cond: installmentPlanTenantCond, default: true, name: TENANT_FILTER })
@Index({ name: 'installment_plan_tenant_key_index', properties: ['tenantKey'] })
@Index({ name: 'installment_plan_account_key_index', properties: ['accountKey'] })
export class InstallmentPlan extends Base {
  @PrimaryKey()
  installmentPlanKey!: number;

  /** The card the purchase was made on. Its statement cycle dates each installment. */
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  /** The member who created the plan. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: null | Rel<Appuser>;

  @Property({ length: 255 })
  description!: string;

  @Property({ columnType: 'int' })
  installmentCount!: number;

  /** The day of the purchase: the first installment falls in the statement that contains it. */
  @Property({ columnType: 'date' })
  purchaseDate!: Date;

  @Property({ columnType: 'numeric(18, 4)' })
  totalAmount!: number;

  /** Optional category, for the client to show; budgets read the posted transactions' own categories. */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Category, fieldName: 'category_key', nullable: true })
  categoryKey?: null | Rel<Category>;

  @OneToMany({ cascade: [], entity: () => Installment, mappedBy: 'installmentPlanKey', orderBy: { installmentNumber: 'ASC' } })
  installments = new Collection<Installment>(this);
}
