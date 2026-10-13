import { Entity, Enum, Filter, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Goal } from './Goal';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

export enum GoalTransactionFundingType {
  FUNDED_EXPENSE = 'funded_expense',
}

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['transactionKey'] })
@Index({ properties: ['goalKey', 'reversedAt'] })
export class GoalTransactionFunding extends Base {
  @Property({ columnType: 'numeric(18, 4)' })
  amount!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @Enum(() => GoalTransactionFundingType)
  fundingType: GoalTransactionFundingType = GoalTransactionFundingType.FUNDED_EXPENSE;

  @ManyToOne({ cascade: [], entity: () => Goal, fieldName: 'goal_key' })
  goalKey!: Rel<Goal>;

  @PrimaryKey()
  goalTransactionFundingKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  reversedAt?: Date;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
