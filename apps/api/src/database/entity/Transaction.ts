import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Enum, Filter, Formula, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { reimbursedAmountOfSql } from '@service/transaction/reimbursement-sql.js';

import { HIDDEN_FILTER, hiddenTransactionCond, TENANT_FILTER, transactionTenantCond } from '../filters/tenant-filter';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { AppuserTransactionCategory } from './AppuserTransactionCategory';
import { Base } from './BaseEntity';
import { Currency } from './Currency';
import { Goal } from './Goal';
import { InstallmentPlan } from './InstallmentPlan';
import { Portfolio } from './Portfolio';
import { Tenant } from './Tenant';
import { TransactionMerchant } from './TransactionMerchant';
import { TransactionSplit } from './TransactionSplit';
import { TransactionStatus } from './TransactionStatus';
import { TransactionTag } from './TransactionTag';
import { TransactionType } from './TransactionType';

export enum CategorizationConfidence {
  HIGH = 'high',
  LOW = 'low',
  MEDIUM = 'medium',
  NONE = 'none',
}

/**
 * How a stored amount in the user's currency was converted.
 *
 * - `exact`: same currency, or converted at a stored rate from within the staleness window.
 * - `provisional`: converted at the latest stored rate, which is older than the window.
 * - `missing`: no rate exists, so no converted amount is stored. Totals leave the row out and
 *   say so; it is never counted at a rate of 1.
 *
 * Null on rows written before the column existed.
 */
export enum FxStatus {
  EXACT = 'exact',
  MISSING = 'missing',
  PROVISIONAL = 'provisional',
}

@Check({ expression: `num_nonnulls("transfer_destination_account_key", "transfer_destination_portfolio_key", "transfer_destination_goal_key") <= 1`, name: 'transaction_transfer_destination_single_check' })
@Entity()
@Filter({ args: false, cond: transactionTenantCond, default: true, name: TENANT_FILTER })
@Filter({ cond: hiddenTransactionCond, default: true, name: HIDDEN_FILTER })
@Index({ properties: ['appuserKey', 'transactionDate'] }) // Composite index for user transaction queries
@Index({ properties: ['accountKey', 'transactionDate'] }) // Composite index for account transaction queries
@Index({
  expression:
    'CREATE UNIQUE INDEX transaction_installment_unique ON "transaction" (installment_plan_key, installment_number) WHERE installment_plan_key IS NOT NULL AND deleted_at IS NULL',
  name: 'transaction_installment_unique',
})
@Index({
  expression: 'CREATE INDEX transaction_installment_unlinked_plan_index ON "transaction" (installment_unlinked_plan_key) WHERE installment_unlinked_plan_key IS NOT NULL',
  name: 'transaction_installment_unlinked_plan_index',
})
@Unique({ properties: ['transactionKey', 'internalTransactionId'] })
@Unique({ properties: ['accountKey', 'nordigenInternalTransactionId'] })
@Unique({ properties: ['accountKey', 'enableBankingTransactionId'] })
@Unique({ properties: ['transferCounterpartKey'] })
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

  /**
   * Moves this row to the credit-card statement that contains this date, instead of the one its
   * `transactionDate` falls in — for when the bank's own statement disagrees. Read only by the
   * statement totals (`services/account/credit-card-statement.service.ts`); null means the
   * transaction date decides.
   */
  @Property({ columnType: 'date', nullable: true })
  statementDateOverride?: Date;

  @PrimaryKey()
  transactionKey!: number;

  /**
   * The installment plan this posted row pays, with `installmentNumber` naming which installment
   * ("3" of "3/12"). Both are null on every other row, and set together. A live row is the only
   * thing that makes a schedule row paid: the plan's future installments are projections, never
   * transactions (`services/installment/`). One installment is paid by at most one live row.
   *
   * The tenant filter is off on this relation: a visible row's plan is on the same card, so the
   * plan's filter adds nothing, and the join it would add to every transaction read breaks row locks.
   */
  @Property({ columnType: 'int', nullable: true })
  installmentNumber?: null | number;

  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => InstallmentPlan, fieldName: 'installment_plan_key', filters: { [TENANT_FILTER]: false }, nullable: true })
  installmentPlanKey?: null | Rel<InstallmentPlan>;

  /**
   * The plan a member unlinked this row from by hand. The automatic linker
   * (`linkPostedInstallments`) never links the row to that plan again, so the next sync or import
   * does not undo the unlink; linking the row to that plan by hand clears it. Null on every other
   * row, and cleared when the plan is deleted. Tenant filter off, as on `installmentPlanKey`.
   */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => InstallmentPlan, fieldName: 'installment_unlinked_plan_key', filters: { [TENANT_FILTER]: false }, nullable: true })
  installmentUnlinkedPlanKey?: null | Rel<InstallmentPlan>;

  @ManyToOne({ cascade: [], entity: () => TransactionMerchant, fieldName: 'transaction_merchant_key', nullable: true })
  transactionMerchantKey?: Rel<TransactionMerchant>;

  @ManyToOne({ cascade: [], entity: () => TransactionType, fieldName: 'transaction_type_key', nullable: true })
  transactionTypeKey?: Rel<TransactionType>;

  /**
   * The other half of an own-account transfer. Set on both rows of a pair, each pointing at
   * the other, by transfer matching (`services/transaction/transfer-matching.service.ts`), which is
   * also what types them TRANSFER_IN / TRANSFER_OUT. Null for every row that is not a matched pair,
   * including a manual transfer nothing matched. Unique: a row belongs to at most one pair.
   */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Transaction, fieldName: 'transfer_counterpart_key', nullable: true })
  transferCounterpartKey?: Rel<Transaction>;

  /**
   * On both rows of a pair across two currencies: the rate the banks settled at, the incoming
   * amount over the outgoing one (units of the incoming currency per unit of the outgoing). Written
   * by transfer matching alongside `transferCounterpartKey`; null on a same-currency pair and on
   * every row not in a pair.
   */
  @Property({ columnType: 'numeric(18,8)', nullable: true })
  transferExchangeRate?: null | number;

  /*
   * Where the money of an outgoing transfer went, when the user said so: another household account,
   * a portfolio or a goal. At most one is set, only on a TRANSFER_OUT row (`transaction-transfer.service.ts`).
   * A description only: it moves no money and creates no row on the other side.
   */
  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Account, fieldName: 'transfer_destination_account_key', nullable: true })
  transferDestinationAccountKey?: Rel<Account>;

  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Goal, fieldName: 'transfer_destination_goal_key', nullable: true })
  transferDestinationGoalKey?: Rel<Goal>;

  @ManyToOne({ cascade: [], deleteRule: 'set null', entity: () => Portfolio, fieldName: 'transfer_destination_portfolio_key', nullable: true })
  transferDestinationPortfolioKey?: Rel<Portfolio>;

  // The original transaction value and currency (before any conversion by the bank)
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  originalAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'original_currency_key', nullable: true })
  originalCurrencyKey?: Rel<Currency>;

  // The settlement transaction value and currency (after any conversion by the bank, paid in the accounts currency)
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  editedSettlementAmount?: number;

  /**
   * The settlement amount before the user's first amount edit: what the bank charged (refreshed by
   * every sync of an edited row) or what a manual row was entered with. An edit is bounded by
   * it, not by the previous edit. Null on a row never edited.
   */
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  settlementAmount?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'settlement_currency_key', nullable: true })
  settlementCurrencyKey?: Rel<Currency>;

  @Property({ columnType: 'numeric(18,8)', nullable: true })
  settlementExchangeRate?: number;

  @Property({ columnType: 'numeric(18,4)', nullable: true })
  uneditedSettlementAmount?: number;

  // The transaction value and currency in the user's WonderMoney prefered currency (appuser.currency_key)
  @Property({ columnType: 'numeric(18,8)', nullable: true })
  appuserCurrencyExchangeRate?: number;

  @ManyToOne({ cascade: [], entity: () => Currency, fieldName: 'appuser_currency_key', nullable: true })
  appuserCurrencyKey?: Rel<Currency>;

  /** Null when no rate converts the amount (`fxStatus` is then `missing`). */
  @Property({ columnType: 'numeric(18,4)', nullable: true })
  appuserSettlementAmount?: null | number;

  @Property({ nullable: true })
  externalTransactionId?: string;

  /** How `appuserSettlementAmount` was converted; see {@link FxStatus}. */
  @Enum({ items: () => FxStatus, nullable: true })
  fxStatus?: FxStatus | null;

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

  /** The description was set by a person (typed on a manual entry); rules never change it. */
  @Property({ default: false })
  descriptionEditedByUser = false;

  @Property({ nullable: true })
  internalTransactionId?: string;

  /** The merchant was set by a person (chosen on a manual entry); rules never change it. */
  @Property({ default: false })
  merchantEditedByUser = false;

  @Property({ nullable: true })
  nordigenInternalTransactionId?: string;

  // Enable Banking's dedup id. `nordigenInternalTransactionId` stays alongside it: its unique
  // constraint is the dedup guarantee for rows ingested through the legacy provider.
  @Property({ nullable: true })
  enableBankingTransactionId?: string;

  @Property({ nullable: true })
  notes?: string;

  @ManyToOne({ cascade: [], entity: () => TransactionStatus, fieldName: 'transaction_status_key' })
  transactionStatusKey?: Rel<TransactionStatus>;

  // The account balance at the time of the transaction in the user's WonderMoney prefered currency (appuser.currency_key)
  @Property({ columnType: 'numeric(18, 4)', nullable: true })
  appuserCurrencyBalance?: null | number;

  @OneToMany({ cascade: [], entity: () => AppuserTransactionCategory, mappedBy: 'transactionKey' })
  appuserTransactionCategories = new Collection<AppuserTransactionCategory>(this);

  /** The household tags on this transaction; see {@link TransactionTag}. */
  @Property({ default: false })
  hidden = false;

  @Property({ default: false })
  reviewed = false;

  @OneToMany({ cascade: [], entity: () => TransactionTag, mappedBy: 'transactionKey' })
  transactionTags = new Collection<TransactionTag>(this);

  /**
   * The live lines of a split transaction, empty when it is not split; see {@link TransactionSplit}.
   * Readers that total by category go through `services/transaction/category-lines.ts`.
   */
  @OneToMany({ cascade: [], entity: () => TransactionSplit, mappedBy: 'transactionKey', orderBy: { position: 'ASC' } })
  splits = new Collection<TransactionSplit>(this);

  /**
   * What the reimbursement links on this transaction take off it, positive, in its settlement
   * currency (`TransactionReimbursement`; only the links that count, `reimbursement-sql.ts`).
   * Lazy: loaded only when populated (`CATEGORY_LINE_POPULATE` in `category-lines.ts`), and read
   * only there.
   */
  @Formula((columns) => reimbursedAmountOfSql(columns.transactionKey), { lazy: true, type: 'float' })
  reimbursedAmount?: number;

  /** How confident the categorizer was (or 'high'/user_edit when the user set it). Null = never evaluated. */
  @Enum({ items: () => CategorizationConfidence, nullable: true })
  categorizationConfidence?: CategorizationConfidence;

  /** The raw categorization reason behind the confidence tier (e.g. 'user_mapping', 'stats_tie', 'user_edit'). */
  @Property({ length: 64, nullable: true })
  categorizationReason?: string;

  // If the transaction has been processed by the automatic categorisation service
  @Property({ default: false })
  processed = false;
}
