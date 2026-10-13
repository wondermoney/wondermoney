import { Collection, Entity, Enum, Filter, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { HIDDEN_FILTER, hiddenTransactionCond, TENANT_FILTER, transactionTenantCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { AppuserTransactionCategory } from './AppuserTransactionCategory';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Tenant } from './Tenant';
import { TransactionMerchant } from './TransactionMerchant';
import { TransactionStatus } from './TransactionStatus';
import { TransactionType } from './TransactionType';

export enum CategorizationConfidence {
  HIGH = 'high',
  LOW = 'low',
  MEDIUM = 'medium',
  NONE = 'none',
}

@Entity()
@Filter({ args: false, cond: transactionTenantCond, default: true, name: TENANT_FILTER })
@Filter({ cond: hiddenTransactionCond, default: true, name: HIDDEN_FILTER })
@Index({ properties: ['appuserKey', 'transactionDate'] }) // Composite index for user transaction queries
@Index({ properties: ['accountKey', 'transactionDate'] }) // Composite index for account transaction queries
@Unique({ properties: ['transactionKey', 'internalTransactionId'] })
@Unique({ properties: ['accountKey', 'nordigenInternalTransactionId'] })
@Unique({ properties: ['accountKey', 'enableBankingTransactionId'] })
export class Transaction extends Base {
  @Index()
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  @Index()
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @Index()
  @Property({ columnType: 'timestamptz', nullable: true })
  transactionDate?: Date;

  @PrimaryKey()
  transactionKey!: number;

  @ManyToOne({ cascade: [], entity: () => TransactionMerchant, fieldName: 'transaction_merchant_key', nullable: true })
  transactionMerchantKey?: Rel<TransactionMerchant>;

  @ManyToOne({ cascade: [], entity: () => TransactionType, fieldName: 'transaction_type_key', nullable: true })
  transactionTypeKey?: Rel<TransactionType>;

  // The original transaction value and currency (before any conversion by the bank)
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  originalAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'original_currency_key', nullable: true })
  originalCurrencyKey?: Rel<Currency>;

  // The settlement transaction value and currency (after any conversion by the bank, paid in the accounts currency)
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  editedSettlementAmount?: number;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  settlementAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'settlement_currency_key', nullable: true })
  settlementCurrencyKey?: Rel<Currency>;

  @Property({ columnType: 'numeric(18,8)', nullable: true })
  settlementExchangeRate?: number;

  // The transaction value and currency in the user's WonderMoney prefered currency (appuser.currency_key)
  @Property({ columnType: 'numeric(18,8)', nullable: true })
  appuserCurrencyExchangeRate?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'appuser_currency_key', nullable: true })
  appuserCurrencyKey?: Rel<Currency>;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  appuserSettlementAmount?: number;

  @Property({ nullable: true })
  externalTransactionId?: string;

  // Base64 encoded transaction identifier
  // We use this to detect duplicate transactions
  // Schema `${transaction_date_in_ms}-${transaction_amount}`
  // This is nullable because we may not have the transaction date
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  balance?: number;

  @Property({ nullable: true })
  description?: string;

  @Property({ nullable: true })
  descriptionDirty?: string;

  @Property({ nullable: true })
  internalTransactionId?: string;

  @Property({ nullable: true })
  nordigenInternalTransactionId?: string;

  // Enable Banking's replacement for `nordigenInternalTransactionId` (kept
  // alongside it, not replacing it — Phase 1a is additive-only, see plan §2/§8).
  @Property({ nullable: true })
  enableBankingTransactionId?: string;

  @Property({ nullable: true })
  notes?: string;

  @ManyToOne({ cascade: [], entity: () => TransactionStatus, fieldName: 'transaction_status_key' })
  transactionStatusKey?: Rel<TransactionStatus>;

  // The account balance at the time of the transaction in the user's WonderMoney prefered currency (appuser.currency_key)
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  appuserCurrencyBalance?: number;

  @OneToMany({ cascade: [], entity: () => AppuserTransactionCategory, mappedBy: 'transactionKey' })
  appuserTransactionCategories = new Collection<AppuserTransactionCategory>(this);

  @Property({ default: false })
  hidden = false;

  @Property({ default: false })
  reviewed = false;

  /** RAD-342.2: how confident the categorizer was (or 'high'/user_edit when the user set it). Null = never evaluated. */
  @Enum({ items: () => CategorizationConfidence, nullable: true })
  categorizationConfidence?: CategorizationConfidence;

  /** RAD-342.2: the raw categorization reason behind the confidence tier (e.g. 'user_mapping', 'stats_tie', 'user_edit'). */
  @Property({ length: 64, nullable: true })
  categorizationReason?: string;

  // If the transaction has been processed by the automatic categorisation service
  @Property({ default: false })
  processed = false;
}
