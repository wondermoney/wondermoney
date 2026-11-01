import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { accountTenantCond, TENANT_FILTER } from '../filters/tenant-filter';

import { AccountFinancialInstitution } from './AccountFinancialInstitution';
import { AccountType } from './AccountType';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { EnableBankingConnection } from './EnableBankingConnection';
import { NordigenRequisition } from './NordigenRequisition';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: accountTenantCond, default: true, name: TENANT_FILTER })
@Index({ properties: ['accountOwnerAppuserKey', 'deletedAt'] }) // Index for user account queries
@Unique({ properties: ['accountId', 'accountOwnerAppuserKey'] })
export class Account extends Base {
  @PrimaryKey()
  accountKey!: number;

  @Property({ length: 255, nullable: true })
  accountNumber?: string;

  @Index()
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'account_owner_appuser_key' })
  accountOwnerAppuserKey?: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  // The account currency
  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'currency_key' })
  currencyKey!: Rel<Currency>;

  // The account balance in the account currency
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  balance?: number;

  // The account balance in the appuser currency
  @ManyToOne({
    cascade: [],
    entity: () => AccountFinancialInstitution,
    fieldName: 'account_financial_institution_key',
    nullable: true,
  })
  accountFinancialInstitutionKey?: Rel<AccountFinancialInstitution>;

  @Property({ length: 255, nullable: true })
  accountId?: string;

  @Property({ length: 255, nullable: true })
  accountName?: string;

  @ManyToOne({ cascade: [], entity: () => AccountType, fieldName: 'account_type_key', nullable: true })
  accountTypeKey?: Rel<AccountType>;

  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  appuserCurrencyBalance?: number;

  @Property({ default: false })
  closed = false;

  @Property({ length: 255, nullable: true })
  holderName?: string;

  /**
   * Per-account privacy within a household. Accounts are shared with the
   * household by default; when `true`, the account and its transactions are visible
   * only to the owner and hidden from other members everywhere (lists + aggregates).
   */
  @Property({ default: false })
  isPrivate = false;

  // Enable Banking connection. `nordigenRequisitionKey` stays alongside it for accounts linked
  // through the legacy provider.
  @ManyToOne({ cascade: [], entity: () => EnableBankingConnection, fieldName: 'enable_banking_connection_key', nullable: true })
  enableBankingConnectionKey?: Rel<EnableBankingConnection>;

  @ManyToOne({ cascade: [], entity: () => NordigenRequisition, fieldName: 'nordigen_requisition_key', nullable: true })
  nordigenRequisitionKey?: Rel<NordigenRequisition>;

  @Property({ columnType: 'timestamptz', nullable: true })
  refreshedAt?: Date;

  /**
   * Last time the account's *transactions* were successfully synced.
   * Distinct from `refreshedAt` (account-level sync): a transaction refresh that creates no
   * new accounts would not advance `refreshedAt`, so staleness is derived from this instead.
   */
  @Property({ columnType: 'timestamptz', nullable: true })
  transactionsRefreshedAt?: Date;
}
