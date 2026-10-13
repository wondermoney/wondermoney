import { Collection, Entity, Enum, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { GoalAccountLink } from './GoalAccountLink';
import { GoalActivity } from './GoalActivity';
import { GoalTransactionFunding } from './GoalTransactionFunding';
import { Loan } from './Loan';
import { Tenant } from './Tenant';

export enum GoalStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  COMPLETED = 'completed',
  PAUSED = 'paused',
}

export enum GoalType {
  DEBT_PAYDOWN = 'debt_paydown',
  SAVE_UP = 'save_up',
}

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['tenantKey', 'appuserKey', 'status', 'deletedAt'] })
@Index({ properties: ['tenantKey', 'priority'] })
export class Goal extends Base {
  @OneToMany({ cascade: [], entity: () => GoalAccountLink, mappedBy: 'goalKey' })
  accountLinks = new Collection<GoalAccountLink>(this);

  @OneToMany({ cascade: [], entity: () => GoalActivity, mappedBy: 'goalKey' })
  activities = new Collection<GoalActivity>(this);

  // Debt paydown: annual interest rate in basis points (matches Loan). 19.99% => 1999.
  @Property({ columnType: 'int', nullable: true })
  annualInterestRateBps?: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ columnType: 'timestamptz', nullable: true })
  archivedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  // Debt paydown: optional association to an existing loan facility (prefill/link only).
  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @ManyToOne({ cascade: [], entity: () => Loan, fieldName: 'loan_key', nullable: true })
  loanKey?: Rel<Loan>;

  // Debt paydown: outstanding debt balance to eliminate (user-entered snapshot).
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  currentBalance?: number;

  @Property({ length: 500, nullable: true })
  description?: string;

  // Debt paydown: extra monthly payment on top of the minimum.
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  extraPayment?: number;

  @PrimaryKey()
  goalKey!: number;

  @Property({ length: 255, nullable: true })
  icon?: string;

  // Debt paydown: minimum required monthly payment.
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  minimumPayment?: number;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  monthlyContributionTarget?: number;

  @Property({ length: 255 })
  name!: string;

  @Property({ default: 0 })
  priority!: number;

  @Enum(() => GoalStatus)
  status: GoalStatus = GoalStatus.ACTIVE;

  @Property({ columnType: 'numeric(18, 4)' })
  targetAmount!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  targetDate?: Date;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @OneToMany({ cascade: [], entity: () => GoalTransactionFunding, mappedBy: 'goalKey' })
  transactionFundings = new Collection<GoalTransactionFunding>(this);

  @Enum(() => GoalType)
  type: GoalType = GoalType.SAVE_UP;
}
