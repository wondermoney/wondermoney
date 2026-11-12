import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Base } from './BaseEntity';
import { Loan } from './Loan';
import { Tenant } from './Tenant';

@Entity()
@Index({ name: 'loan_rate_period_tenant_key_effective_date_idx', properties: ['tenantKey', 'effectiveDate'] })
@Unique({ name: 'loan_rate_period_active_loan_effective_date_unique', properties: ['loanKey', 'effectiveDate'], where: 'deleted_at is null' })
export class LoanRatePeriod extends Base {
  @Property({ columnType: 'int' })
  annualInterestRateBps!: number;

  @Property({ columnType: 'date' })
  effectiveDate!: Date;

  @ManyToOne({ cascade: [], entity: () => Loan, fieldName: 'loan_key' })
  loanKey!: Rel<Loan>;

  @PrimaryKey()
  loanRatePeriodKey!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;
}
