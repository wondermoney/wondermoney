import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types.js';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Tenant } from './Tenant';

@Entity()
@Index({ name: 'loan_tenant_key_status_idx', properties: ['tenantKey', 'status'] })
@Index({ name: 'loan_tenant_key_owner_appuser_key_idx', properties: ['tenantKey', 'ownerAppuserKey'] })
export class Loan extends Base {
  @Property({ columnType: 'int', nullable: true })
  annualInterestRateBps?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  @Property({ default: true })
  includeInNetWorth = true;

  @PrimaryKey()
  loanKey!: number;

  @Property({ columnType: 'date', nullable: true })
  maturityDate?: Date;

  @Property({ length: 255 })
  name!: string;

  @Property({ columnType: 'text', nullable: true })
  notes?: string;

  @Property({ columnType: 'date' })
  openingBalanceDate!: Date;

  @Property({ columnType: 'numeric(18, 4)' })
  openingPrincipalBalance!: number;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  originalPrincipal?: number;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'owner_appuser_key' })
  ownerAppuserKey!: Rel<Appuser>;

  @Property({ columnType: 'int', nullable: true })
  paymentDayOfMonth?: number;

  @Enum(() => LoanPaymentFrequency)
  paymentFrequency!: LoanPaymentFrequency;

  @Property({ length: 255, nullable: true })
  providerName?: string;

  @Enum(() => LoanRateType)
  rateType!: LoanRateType;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  regularPaymentAmount?: number;

  @Enum(() => LoanStatus)
  @Index({ name: 'loan_status_idx' })
  status!: LoanStatus;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @Property({ columnType: 'int', nullable: true })
  termMonths?: number;

  @Enum(() => LoanType)
  type!: LoanType;
}
