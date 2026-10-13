import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { LoanAdjustmentType } from '@service/loan/loan-types.js';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Loan } from './Loan';
import { Tenant } from './Tenant';

@Entity()
@Index({ name: 'loan_adjustment_tenant_key_effective_date_idx', properties: ['tenantKey', 'effectiveDate'] })
@Index({ name: 'loan_adjustment_loan_key_effective_date_idx', properties: ['loanKey', 'effectiveDate'] })
export class LoanAdjustment extends Base {
  @Property({ columnType: 'numeric(18, 4)' })
  amount!: number;

  @Index({ name: 'loan_adjustment_created_by_idx' })
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'created_by_appuser_key' })
  createdByAppuserKey!: Rel<Appuser>;

  @Property({ columnType: 'date' })
  effectiveDate!: Date;

  @PrimaryKey()
  loanAdjustmentKey!: number;

  @ManyToOne({ cascade: [], entity: () => Loan, fieldName: 'loan_key' })
  loanKey!: Rel<Loan>;

  @Property({ columnType: 'text', nullable: true })
  reason?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Enum(() => LoanAdjustmentType)
  type!: LoanAdjustmentType;
}
