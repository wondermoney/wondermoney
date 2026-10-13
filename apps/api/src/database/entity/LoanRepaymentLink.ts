import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { LoanAllocationSource } from '@service/loan/loan-types.js';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Loan } from './Loan';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

@Entity()
@Index({ name: 'loan_repayment_link_tenant_key_payment_date_idx', properties: ['tenantKey', 'paymentDate'] })
@Index({ name: 'loan_repayment_link_loan_key_payment_date_idx', properties: ['loanKey', 'paymentDate'] })
@Unique({ name: 'loan_repayment_link_loan_key_transaction_key_unique', properties: ['loanKey', 'transactionKey'] })
export class LoanRepaymentLink extends Base {
  @Enum(() => LoanAllocationSource)
  allocationSource!: LoanAllocationSource;

  @Property({ columnType: 'numeric(18, 4)' })
  feeAmount!: number;

  @Property({ columnType: 'numeric(18, 4)' })
  interestAmount!: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'linked_by_appuser_key' })
  linkedByAppuserKey!: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Loan, fieldName: 'loan_key' })
  loanKey!: Rel<Loan>;

  @PrimaryKey()
  loanRepaymentLinkKey!: number;

  @Property({ default: false })
  needsReview = false;

  @Property({ columnType: 'text', nullable: true })
  notes?: string;

  @Property({ columnType: 'date' })
  paymentDate!: Date;

  @Property({ columnType: 'numeric(18, 4)' })
  principalAmount!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Property({ columnType: 'numeric(18, 4)' })
  totalPaymentAmount!: number;

  @Index({ name: 'loan_repayment_link_transaction_idx' })
  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
