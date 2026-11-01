import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Category } from './Category';
import { Currency } from './Currency';
import { Goal } from './Goal';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

export enum GoalActivityType {
  ARCHIVED = 'archived',
  ASSIGNED = 'assigned',
  COMPLETED = 'completed',
  GOAL_CREATED = 'goal_created',
  GOAL_UPDATED = 'goal_updated',
  MANUAL_ADJUSTMENT = 'manual_adjustment',
  MOVED_IN = 'moved_in',
  MOVED_OUT = 'moved_out',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  SPENT_FROM_GOAL = 'spent_from_goal',
  TRANSACTION_FUNDING_REVERSED = 'transaction_funding_reversed',
}

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['goalKey', 'occurredAt'] })
@Index({ properties: ['tenantKey', 'occurredAt'] })
export class GoalActivity extends Base {
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  amount?: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Category, fieldName: 'category_key', nullable: true })
  categoryKey?: Rel<Category>;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'created_by_appuser_key', nullable: true })
  createdByAppuserKey?: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key', nullable: true })
  currencyKey?: Rel<Currency>;

  @Property({ nullable: true })
  destinationKey?: number;

  @Property({ nullable: true })
  destinationType?: string;

  @PrimaryKey()
  goalActivityKey!: number;

  @ManyToOne({ cascade: [], entity: () => Goal, fieldName: 'goal_key' })
  goalKey!: Rel<Goal>;

  @Property({ nullable: true })
  note?: string;

  @Property({ columnType: 'timestamptz', onCreate: () => new Date() })
  occurredAt = new Date();

  @Property({ nullable: true })
  sourceKey?: number;

  @Property({ nullable: true })
  sourceType?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key', nullable: true })
  transactionKey?: Rel<Transaction>;

  /**
   * Read-time flag, not a column: set by the activity feed on a `spent_from_goal` entry whose
   * transaction has since expired while the goal still funds it. See
   * `GoalService.getGoalActivity`.
   */
  @Property({ persist: false })
  transactionExpired?: boolean;

  @Enum(() => GoalActivityType)
  type!: GoalActivityType;
}
