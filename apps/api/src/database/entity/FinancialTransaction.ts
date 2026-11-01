import type { Rel } from '@mikro-orm/core';
import { Entity, Filter, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { TENANT_FILTER, tenantScopedCond } from '../filters/tenant-filter';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { FinancialAsset } from './FinancialAsset';
import { FinancialBroker } from './FinancialBroker';
import { FinancialTransactionType } from './FinancialTransactionType';
import { Portfolio } from './Portfolio';
import { Tenant } from './Tenant';

@Entity()
@Filter({ args: false, cond: tenantScopedCond, default: true, name: TENANT_FILTER })
export class FinancialTransaction extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key', nullable: true })
  appuserKey?: Rel<Appuser>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialAsset,
    fieldName: 'financial_asset_key',
    nullable: true,
  })
  financialAssetKey?: Rel<FinancialAsset>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialBroker,
    fieldName: 'financial_broker_key',
    nullable: true,
  })
  financialBrokerKey?: Rel<FinancialBroker>;

  @ManyToOne({
    cascade: [],
    entity: () => FinancialTransactionType,
    fieldName: 'financial_transaction_type_key',
    nullable: true,
  })
  financialTransactionTypeKey?: Rel<FinancialTransactionType>;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  originalAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'original_currency_key', nullable: true })
  originalCurrencyKey?: Rel<Currency>;

  @Property({ columnType: 'numeric(18,8)', nullable: true })
  originalUnitAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Portfolio, fieldName: 'portfolio_key', nullable: true })
  portfolioKey?: Rel<Portfolio>;

  @Property({ columnType: 'numeric(18,8)' })
  quantity!: number;

  @Property({ columnType: 'numeric(18,4)' })
  settlementAmount!: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'settlement_currency_key' })
  settlementCurrencyKey!: Rel<Currency>;

  @Property({ columnType: 'numeric(18,8)', nullable: true })
  settlementExchangeRate?: number;

  @Property({ columnType: 'numeric(18,8)' })
  settlementUnitAmount!: number;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key', nullable: true })
  tenantKey?: Rel<Tenant>;

  @Property({ columnType: 'timestamptz', nullable: true })
  transactionDate?: Date;

  @PrimaryKey()
  transactionKey!: number;

  // The transaction value and currency in the user's WonderMoney prefered currency (appuser.currency_key)
  @Property({ columnType: 'numeric(18,8)', nullable: true })
  appuserCurrencyExchangeRate?: number;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  appuserSettlementAmount?: number;

  @Property({ columnType: 'numeric(18,8)', nullable: true })
  appuserUnitAmount?: number;

  @Property({ nullable: true })
  externalTransactionId?: string;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  feeAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'fee_currency_key', nullable: true })
  feeCurrencyKey?: Rel<Currency>;

  // Base64 encoded transaction identifier
  // Idempotency key for imports.
  // Duplicate detection is intentionally scoped to this normalized identifier
  // so re-uploading the same CSV can safely skip rows without schema changes.
  @Property({ unique: true })
  internalTransactionId!: string;

  @Property({ nullable: true })
  notes?: string;
}
