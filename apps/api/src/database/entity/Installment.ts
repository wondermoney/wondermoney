import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { installmentTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { InstallmentPlan } from './InstallmentPlan';
import { Tenant } from './Tenant';

/**
 * One scheduled installment of an {@link InstallmentPlan}: a projection, not a transaction.
 *
 * The schedule is derived from the plan (`services/installment/installment-schedule.ts`) and
 * rewritten whole when the plan's amount, count or purchase date changes. Whether a row is paid is
 * not stored here: it is paid while a live transaction carries its plan and number
 * (`Transaction.installmentPlanKey` + `installmentNumber`), so deleting that transaction makes the
 * row upcoming again and nothing can say "paid" twice.
 *
 * `tenantKey` is denormalised so the global tenant filter can scope the row without a join.
 */
@Entity({ tableName: 'installment' })
@Filter({ args: false, cond: installmentTenantCond, default: true, name: TENANT_FILTER })
@Unique({ name: 'installment_plan_number_unique', properties: ['installmentPlanKey', 'installmentNumber'] })
export class Installment extends Base {
  @PrimaryKey()
  installmentKey!: number;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => InstallmentPlan, fieldName: 'installment_plan_key' })
  installmentPlanKey!: Rel<InstallmentPlan>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  /** 1-based position in the plan. */
  @Property({ columnType: 'int' })
  installmentNumber!: number;

  /** The scheduled amount, a positive magnitude in the account's currency. */
  @Property({ columnType: 'numeric(18, 4)' })
  amount!: number;

  /** The day this installment is expected on the card; it lies inside its statement. */
  @Property({ columnType: 'date' })
  scheduledDate!: Date;

  /** The close day of the statement it is charged in; null when the account has no card cycle. */
  @Property({ columnType: 'date', nullable: true })
  statementDate?: Date | null;

  /** That statement's due date; null when the account has no card cycle. */
  @Property({ columnType: 'date', nullable: true })
  dueDate?: Date | null;
}
