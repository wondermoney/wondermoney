import { z } from 'zod';

import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { TransactionTemplateDirection } from '@entity/TransactionTemplate';
import { BUDGET_PERIOD_START_DAY_MAX, BUDGET_PERIOD_START_DAY_MIN } from '@service/budget/budget-period';
import { EXPORT_FORMAT } from '@service/data-export/export-format';
import { LoanAmortizationMethod } from '@service/loan/loan-types';
import { MAX_INSTALLMENT_COUNT, MIN_INSTALLMENT_COUNT } from '@validators/installment-plan';
import { isSafeImageUrl, MERCHANT_LOGO_URL_MAX_LENGTH, MERCHANT_WEBSITE_MAX_LENGTH } from '@validators/merchant';

/**
 * What a restore accepts: the WonderMoney export format (`data-export/export-format.ts`), file by
 * file, as Zod schemas. Every row of every `data/*.json` file is checked against these before
 * anything is written.
 *
 * Versions: a restore reads every 1.x export. Rows are parsed leniently about fields (an unknown
 * field from a newer minor version is dropped), strictly about values. An older minor version is
 * brought up to the current one by {@link MINOR_MIGRATIONS} before the rows are checked. 1.1 to
 * 1.10 only added files (manual assets, loan rate periods, reimbursement links, crypto wallet addresses
 * and tokens, card settings, installment plans and schedules, transaction templates, exchange-rate
 * and price overrides), a loan rate type, a manual asset kind and optional fields (a loan's secured
 * asset, a budget's month start day, which defaults to the 1st, a merchant's website and logo URL,
 * the 1.8 fields, 1.9's account shares, and 1.10's joint accounts and transaction attribution, each defaulting to what the
 * app gives a row created without it), which an
 * older export simply does not have, so there is nothing to migrate yet. 1.11 added the expense
 * group files and a split line's `memberId`, likewise absent from older exports. Another major
 * version is refused.
 */
export const RESTORE_MAJOR_VERSION = 1;

export interface RestoreLimits {
  maxArchiveBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxRows: number;
  maxTotalBytes: number;
}

/** Limits that keep one restore bounded in memory and time. */
export const RESTORE_LIMITS: RestoreLimits = {
  /** The uploaded zip. */
  maxArchiveBytes: 64 * 1024 * 1024,
  /** Any one file once decompressed. */
  maxFileBytes: 256 * 1024 * 1024,
  /** Every file together once decompressed. */
  maxTotalBytes: 512 * 1024 * 1024,
  /** Files in the archive. */
  maxFiles: 200,
  /** Rows in any one data file. */
  maxRows: 2_000_000,
};

const DECIMAL = /^-?\d{1,18}(\.\d{1,12})?$/u;

const id = z.number().int().positive().max(2_147_483_647);
const ref = id.nullable();
const decimal = z.string().regex(DECIMAL, 'a decimal number as a string');
const optionalDecimal = decimal.nullable();
const timestamp = z.iso.datetime();
const optionalTimestamp = timestamp.nullable();
const day = z.iso.date();
const text = (max: number) => z.string().max(max).nullable();
const name = (max: number) => z.string().trim().min(1).max(max);
const currency = z.string().regex(/^[A-Z0-9]{2,10}$/u, 'a currency code');
const int = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const flag = z.boolean().nullable();

const RECURRENCY = ['ANNUALLY', 'BI_ANNUALLY', 'MONTHLY', 'MONTHLY_14', 'QUARTERLY'] as const;
const positiveDecimal = decimal.refine((value) => Number(value) > 0, 'a positive amount');
/** A day an override may be set for: no later than tomorrow in UTC, as when it is set in the app (`validators/currency.ts`). */
const overrideDay = day.refine((value) => value <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'not in the future');

const member = z.object({ email: text(320), firstName: text(255), id, isExporter: z.boolean(), lastName: text(255), role: z.enum(['admin', 'member', 'owner', 'viewer']).nullable() });

const preferences = z.object({
  currency: currency.nullable(),
  /** `bankSyncAlerts` and `creditCardDueReminders` are absent from older exports. */
  emailNotifications: z.object({ accountRecovery: flag, bankSyncAlerts: flag.optional(), budgetAlerts: flag, creditCardDueReminders: flag.optional(), growthEmails: flag, monthlyStory: flag, weeklyInsights: flag }),
  language: text(10),
  memberId: ref,
});

const account = z.object({
  accountNumber: text(255),
  balance: optionalDecimal,
  bankLinked: z.boolean(),
  closed: z.boolean(),
  createdAt: optionalTimestamp,
  currency,
  holderName: text(255),
  id,
  institution: text(255),
  /** A joint account (1.10); absent: not joint, the account is its owner's. */
  isJoint: z.boolean().optional(),
  isPrivate: z.boolean(),
  name: text(255),
  openingBalance: optionalDecimal,
  openingBalanceDate: optionalTimestamp,
  ownerMemberId: ref,
  /** The member's place for the account in their list (1.8); absent or null: unordered. */
  position: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable().optional(),
  /**
   * Who a private account was shared with (1.9). Read and checked, not restored: every member of
   * the export becomes the restoring member, so a restored private account is theirs alone, to share
   * again with the people in their household now.
   */
  shares: z.array(z.object({ access: z.enum(['read', 'write']), memberId: ref })).max(50).optional(),
  type: text(255),
});

/** A card account's statement cycle (1.8), within the bounds the card settings accept (`validators/account.ts`). */
const dayOfMonth = z.number().int().min(1).max(31);
const creditCard = z.object({
  accountId: id,
  creditLimit: optionalDecimal.refine((value) => value === null || (Number(value) >= 0 && Number(value) <= 999_999_999_999), 'between 0 and 999999999999'),
  minimumPaymentPercent: optionalDecimal.refine((value) => value === null || (Number(value) >= 0 && Number(value) <= 100), 'between 0 and 100'),
  paymentDueDay: dayOfMonth,
  statementCloseDay: dayOfMonth,
});

const category = z.object({
  bgColor: text(32),
  countsAsSpending: z.boolean(),
  icon: text(255),
  id,
  isDefaultBudgetCategory: z.boolean(),
  name: name(255),
  parentId: ref,
  recurrency: z.enum(RECURRENCY).nullable(),
  system: z.boolean(),
  textColor: text(32),
});

const categorySetting = z.object({ categoryId: id, countsAsSpending: z.boolean() });
/** An https address the clients may render, under the same rule as an edit (`validators/merchant.ts`). */
const httpsUrl = (max: number) => z.string().max(max).refine(isSafeImageUrl, 'an https address').nullable().optional();
/** `website` and `logoUrl` arrived in 1.5; absent from older exports. */
const merchant = z.object({ global: z.boolean(), id, logoUrl: httpsUrl(MERCHANT_LOGO_URL_MAX_LENGTH), name: name(500), website: httpsUrl(MERCHANT_WEBSITE_MAX_LENGTH) });
const merchantCategory = z.object({ categoryId: id, memberId: ref, merchantId: id, source: z.enum(['manual', 'openai', 'user']) });
const tag = z.object({ color: z.string().regex(/^#[0-9a-f]{3,6}$/iu), createdByMemberId: ref, id, name: name(64) });

const transaction = z.object({
  accountId: ref,
  /** "Spent by" (1.10): a member, or Shared; absent or neither: the account's default. */
  attributedMemberId: ref.optional(),
  attributedToShared: z.boolean().optional(),
  balance: optionalDecimal,
  bankSynced: z.boolean(),
  createdAt: optionalTimestamp,
  date: optionalTimestamp,
  description: text(10_000),
  descriptionEditedByUser: z.boolean(),
  descriptionRaw: text(10_000),
  editedSettlementAmount: optionalDecimal,
  hidden: z.boolean(),
  id,
  /** The plan installment this row pays (1.8), set together with `installmentPlanId`. */
  installmentNumber: z.number().int().min(1).max(MAX_INSTALLMENT_COUNT).nullable().optional(),
  installmentPlanId: ref.optional(),
  /** The plan a member unlinked this row from by hand, which the automatic linker leaves alone (1.8). */
  installmentUnlinkedPlanId: ref.optional(),
  memberId: ref,
  merchantEditedByUser: z.boolean(),
  merchantId: ref,
  notes: text(10_000),
  originalAmount: optionalDecimal,
  originalCurrency: currency.nullable(),
  reviewed: z.boolean(),
  settlementAmount: optionalDecimal,
  settlementCurrency: currency.nullable(),
  settlementExchangeRate: optionalDecimal,
  /** The card statement the row counts in, when not its own date's (1.8). */
  statementDateOverride: day.nullable().optional(),
  status: text(64),
  transferCounterpartId: ref,
  transferDestinationAccountId: ref,
  transferDestinationGoalId: ref,
  transferDestinationPortfolioId: ref,
  /** The rate a cross-currency transfer pair settled at (1.8). */
  transferExchangeRate: optionalDecimal.optional(),
  type: text(64),
  uneditedSettlementAmount: optionalDecimal,
  userAmount: optionalDecimal,
  userCurrency: currency.nullable(),
  userExchangeRate: optionalDecimal,
}).refine((row) => [row.transferDestinationAccountId, row.transferDestinationGoalId, row.transferDestinationPortfolioId].filter((value) => value !== null).length <= 1, { message: 'at most one transfer destination' })
  .refine((row) => (row.installmentPlanId == null) === (row.installmentNumber == null), { message: 'an installment plan and number together', path: ['installmentNumber'] })
  .refine((row) => !(row.attributedToShared === true && row.attributedMemberId != null), { message: 'a member or Shared, not both', path: ['attributedToShared'] });

const transactionCategory = z.object({ categoryId: id, memberId: ref, source: z.enum(['deterministic', 'manual', 'openai', 'rule', 'user']), transactionId: id });
/** A refund linked to the expense it offsets (1.6); `amount` is positive, in the expense's currency. */
const transactionReimbursement = z.object({ amount: decimal.refine((value) => Number(value) > 0, 'a positive amount'), createdAt: optionalTimestamp, expenseTransactionId: id, id, reimbursementTransactionId: id });
/** `memberId` (1.11): the expense group member whose share the line is. */
const transactionSplit = z.object({ amount: decimal, categoryId: ref, id, memberId: ref.optional().default(null), notes: text(500), position: z.number().int().min(0).max(10_000), transactionId: id });

/** Expense groups (1.11): people sharing costs, their shared expenses and settlements. */
const expenseGroup = z.object({ archived: z.boolean(), createdAt: optionalTimestamp, currency, id, name: name(100) });
/** `householdMemberId` names a member of the export for a person of the household; null for anyone else. */
const expenseGroupMember = z.object({ email: text(254), groupId: id, householdMemberId: ref, id, name: name(100), position: z.number().int().min(0).max(10_000) });
const expenseGroupExpense = z.object({ groupId: id, paidByMemberId: id, splitMethod: z.enum(['amounts', 'equal', 'percentages']), transactionId: id });
const expenseGroupSettlement = z.object({
  amount: decimal.refine((value) => Number(value) > 0, 'a positive amount'),
  createdAt: optionalTimestamp,
  currency,
  fromMemberId: id,
  groupId: id,
  notes: text(500),
  settledOn: day,
  toMemberId: id,
  transactionId: ref,
}).refine((row) => row.fromMemberId !== row.toMemberId, { message: 'two different people', path: ['toMemberId'] });
const transactionTag = z.object({ tagId: id, transactionId: id });

/** A purchase paid in installments (1.8), within the bounds a plan is created with (`validators/installment-plan.ts`). */
const installmentPlan = z.object({
  accountId: id,
  categoryId: ref,
  createdAt: optionalTimestamp,
  createdByMemberId: ref,
  description: name(255),
  id,
  installmentCount: z.number().int().min(MIN_INSTALLMENT_COUNT).max(MAX_INSTALLMENT_COUNT),
  purchaseDate: day,
  totalAmount: positiveDecimal.refine((value) => Number(value) <= 1_000_000_000, 'at most 1000000000'),
});
const installment = z.object({
  amount: positiveDecimal,
  dueDate: day.nullable(),
  installmentNumber: z.number().int().min(1).max(MAX_INSTALLMENT_COUNT),
  planId: id,
  scheduledDate: day,
  statementDate: day.nullable(),
});

/** A saved entry (1.8), as `validators/transaction-template.ts` accepts one. */
const transactionTemplate = z.object({
  accountId: ref,
  amount: positiveDecimal.nullable(),
  categoryId: ref,
  description: text(500),
  direction: z.enum(TransactionTemplateDirection),
  id,
  memberId: ref,
  merchantId: ref,
  name: name(120),
  notes: text(1000),
  position: z.number().int().min(0).max(2_147_483_647),
});

const rule = z.object({
  actions: z.array(z.record(z.string(), z.unknown())).max(50),
  active: z.boolean(),
  conditions: z.array(z.record(z.string(), z.unknown())).max(50),
  id,
  match: z.enum(['all', 'any']),
  name: name(255),
  ownerMemberId: ref,
  position: z.number().int().min(0),
  stopProcessing: z.boolean(),
  version: z.number().int().min(1).max(32_767),
});

const recurringSeries = z.object({
  accountId: ref,
  amountType: z.enum(['fixed', 'variable']),
  averageAmount: optionalDecimal,
  cadence: z.enum(['biweekly', 'monthly', 'quarterly', 'weekly', 'yearly']),
  categoryId: ref,
  currency: currency.nullable(),
  displayName: name(255),
  expectedAmount: optionalDecimal,
  expectedAmountMax: optionalDecimal,
  expectedAmountMin: optionalDecimal,
  firstSeenAt: optionalTimestamp,
  id,
  lastAmount: optionalDecimal,
  lastSeenAt: optionalTimestamp,
  memberId: ref,
  merchantDisplayName: text(255),
  merchantKey: name(255),
  nextExpectedAt: optionalTimestamp,
  occurrenceCount: z.number().int().min(0),
  source: z.enum(['detected', 'user_created']),
  status: z.enum(['candidate', 'confirmed', 'dismissed', 'ended', 'paused']),
  type: z.enum(['bill', 'subscription']),
});

const recurringOccurrence = z.object({ amount: optionalDecimal, currency: currency.nullable(), date: timestamp, matchStatus: z.enum(['manual_added', 'manual_removed', 'matched', 'missed', 'predicted']), seriesId: id, transactionId: ref });

const budget = z.object({
  currency, description: text(10_000), id, memberId: ref, name: name(255), numAdults: z.number().int().min(0).max(1000), numDependents: z.number().int().min(0).max(1000),
  /** The day the budget's months start on (1.4); an older export's budgets start on the 1st. */
  periodStartDay: z.number().int().min(BUDGET_PERIOD_START_DAY_MIN).max(BUDGET_PERIOD_START_DAY_MAX).default(1),
  /** Whether rollover carries an overspend too (1.8); the app's default otherwise. */
  rolloverCarriesOverspend: z.boolean().default(true),
});
const budgetCategory = z.object({
  accountIds: z.array(id).max(1000), amount: optionalDecimal, budgetId: id, categoryId: id, month: z.number().int().min(0).max(12), recurrency: z.enum(RECURRENCY).nullable(),
  /** Whether the month takes part in rollover (1.8); off otherwise. */
  rolloverEnabled: z.boolean().default(false),
  year: z.number().int().min(1900).max(9999),
});
const budgetIncome = z.object({ amount: optionalDecimal, budgetId: id, name: name(255), recurrency: z.enum(RECURRENCY).nullable() });

const goal = z.object({
  annualInterestRateBps: int.nullable(),
  archivedAt: optionalTimestamp,
  completedAt: optionalTimestamp,
  createdAt: optionalTimestamp,
  currency,
  currentBalance: optionalDecimal,
  description: text(10_000),
  extraPayment: optionalDecimal,
  icon: text(255),
  id,
  loanId: ref,
  memberId: ref,
  minimumPayment: optionalDecimal,
  monthlyContributionTarget: optionalDecimal,
  name: name(255),
  priority: int,
  status: z.enum(['active', 'archived', 'completed', 'paused']),
  targetAmount: decimal,
  targetDate: optionalTimestamp,
  type: z.enum(['debt_paydown', 'save_up']),
});

const goalAccountLink = z.object({ accountId: id, goalId: id });
const goalActivity = z.object({
  amount: optionalDecimal,
  categoryId: ref,
  createdByMemberId: ref,
  currency: currency.nullable(),
  destinationType: text(255),
  goalId: id,
  memberId: ref,
  note: text(10_000),
  occurredAt: timestamp,
  sourceType: text(255),
  transactionId: ref,
  type: z.enum(['archived', 'assigned', 'completed', 'goal_created', 'goal_updated', 'manual_adjustment', 'moved_in', 'moved_out', 'paused', 'resumed', 'spent_from_goal', 'transaction_funding_reversed']),
});
const goalFunding = z.object({ amount: decimal, currency, fundingType: z.literal('funded_expense'), goalId: id, reversedAt: optionalTimestamp, transactionId: id });

const loan = z.object({
  /** How payments split into principal and interest (1.8); French (level payments) otherwise. */
  amortizationMethod: z.enum(LoanAmortizationMethod).default(LoanAmortizationMethod.FRENCH),
  annualInterestRateBps: int.nullable(),
  currency,
  /** The first payment's day (1.8). */
  firstPaymentDate: day.nullable().default(null),
  id,
  includeInNetWorth: z.boolean(),
  maturityDate: day.nullable(),
  name: name(255),
  notes: text(10_000),
  openingBalanceDate: day,
  openingPrincipalBalance: decimal,
  originalPrincipal: optionalDecimal,
  ownerMemberId: ref,
  paymentDayOfMonth: z.number().int().min(1).max(31).nullable(),
  paymentFrequency: z.literal('MONTHLY'),
  providerName: text(255),
  rateType: z.enum(['FIXED', 'UNKNOWN', 'VARIABLE']),
  regularPaymentAmount: optionalDecimal,
  /** The manual asset the loan finances (1.3); absent from older exports. */
  securedAssetId: ref.optional(),
  status: z.enum(['ACTIVE', 'CLOSED', 'PAID_OFF']),
  termMonths: z.number().int().min(0).max(2000).nullable(),
  type: z.enum(['AUTO_LOAN', 'MORTGAGE', 'OTHER', 'PERSONAL_LOAN', 'STUDENT_LOAN']),
});
const manualAsset = z.object({
  archivedAt: optionalTimestamp,
  createdAt: optionalTimestamp,
  currency,
  growthAnnualRatePercent: optionalDecimal,
  growthStartDate: day.nullable(),
  id,
  isPrivate: z.boolean(),
  kind: z.enum(['crypto_wallet', 'other', 'property', 'valuable', 'vehicle']),
  name: name(255),
  notes: text(10_000),
  ownerMemberId: ref,
  purchaseDate: day.nullable(),
  purchasePrice: optionalDecimal,
});
// The address is checked again as a public one when it is restored (`household-restore.ts`).
const cryptoWalletAddress = z.object({ address: z.string().min(1).max(200), chain: z.enum(['bitcoin', 'ethereum']), id, kind: z.enum(['address', 'xpub']), label: text(100), manualAssetId: id });
const cryptoWalletToken = z.object({
  addressId: id,
  balance: z.string().regex(/^\d{1,78}$/u),
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/u).nullable(),
  decimals: z.number().int().min(0).max(36),
  name: text(255),
  symbol: name(32),
  tracked: z.boolean(),
});
const manualAssetValuation = z.object({ date: day, manualAssetId: id, note: text(10_000), value: decimal });
const loanAdjustment = z.object({ amount: decimal, effectiveDate: day, loanId: id, reason: text(10_000), type: z.enum(['BALANCE_CORRECTION', 'CAPITALIZED_INTEREST', 'FEE', 'PRINCIPAL_DECREASE', 'PRINCIPAL_INCREASE', 'WRITE_OFF']) });
const loanRatePeriod = z.object({ annualInterestRateBps: z.number().int().min(0).max(10_000), effectiveDate: day, loanId: id });
const loanRepayment = z.object({
  allocationSource: z.enum(['AMORTIZATION_ESTIMATE', 'AUTO_MATCHED', 'MANUAL']),
  feeAmount: decimal,
  interestAmount: decimal,
  loanId: id,
  needsReview: z.boolean(),
  notes: text(10_000),
  paymentDate: day,
  principalAmount: decimal,
  totalPaymentAmount: decimal,
  transactionId: id,
});

const portfolio = z.object({
  accountBalanceMode: z.enum(['cash_only', 'includes_holdings']).nullable(),
  benchmarkSymbol: text(64),
  closedAt: optionalTimestamp,
  /** How a sale relieves cost (1.8); FIFO otherwise. */
  costBasisMethod: z.enum(PortfolioCostBasisMethod).default(PortfolioCostBasisMethod.FIFO),
  createdAt: optionalTimestamp,
  currency,
  description: text(10_000),
  excluded: z.boolean(),
  favored: z.boolean(),
  id,
  linkedAccountId: ref,
  name: name(255),
  ownerMemberId: ref,
  targetAllocation: z.record(z.string().max(64), z.number().finite()).nullable(),
});

export const assetSchema = z.object({ currency: currency.nullable(), exchange: text(64), isin: z.string().regex(/^[A-Z0-9]{12}$/u).nullable().catch(null), name: text(500), symbol: name(64), type: text(64) });

const portfolioTransaction = z.object({
  asset: assetSchema,
  broker: text(255),
  date: optionalTimestamp,
  feeAmount: optionalDecimal,
  feeCurrency: currency.nullable(),
  id,
  memberId: ref,
  notes: text(10_000),
  originalAmount: optionalDecimal,
  originalCurrency: currency.nullable(),
  originalUnitAmount: optionalDecimal,
  portfolioId: id,
  quantity: decimal,
  savingsCertificateTaxExempt: z.boolean().nullable(),
  settlementAmount: decimal,
  settlementCurrency: currency,
  settlementExchangeRate: optionalDecimal,
  settlementUnitAmount: decimal,
  type: name(64),
});

const watchlist = z.object({ memberId: ref, symbol: name(64) });

/** A household's own price for a security on a day (1.8), as `validators/portfolio.ts` accepts one. */
const priceOverride = z.object({
  asset: assetSchema,
  createdByMemberId: ref,
  currency,
  date: overrideDay,
  note: z.string().trim().max(500).nullable(),
  price: positiveDecimal.refine((value) => Number(value) <= 1_000_000_000_000, 'at most 1000000000000'),
});
/** A household's own exchange rate for a pair on a day (1.8), as `validators/currency.ts` accepts one. */
const exchangeRateOverride = z.object({
  createdByMemberId: ref,
  date: overrideDay,
  fromCurrency: currency,
  rate: positiveDecimal.refine((value) => Number(value) <= 1_000_000_000, 'at most 1000000000'),
  toCurrency: currency,
}).refine((row) => row.fromCurrency !== row.toCurrency, { message: 'two different currencies', path: ['toCurrency'] });

/** Every data file a restore reads, by its name in `data/<name>.json`. */
export const DATA_FILES = {
  'accounts': account,
  'budget-categories': budgetCategory,
  'budget-incomes': budgetIncome,
  'budgets': budget,
  'categories': category,
  'category-settings': categorySetting,
  'credit-cards': creditCard,
  'crypto-wallet-addresses': cryptoWalletAddress,
  'crypto-wallet-tokens': cryptoWalletToken,
  'exchange-rate-overrides': exchangeRateOverride,
  'expense-group-expenses': expenseGroupExpense,
  'expense-group-members': expenseGroupMember,
  'expense-group-settlements': expenseGroupSettlement,
  'expense-groups': expenseGroup,
  'goal-account-links': goalAccountLink,
  'goal-activities': goalActivity,
  'goal-transaction-fundings': goalFunding,
  'goals': goal,
  'installment-plans': installmentPlan,
  'installments': installment,
  'loan-adjustments': loanAdjustment,
  'loan-rate-periods': loanRatePeriod,
  'loan-repayments': loanRepayment,
  'loans': loan,
  'manual-asset-valuations': manualAssetValuation,
  'manual-assets': manualAsset,
  'members': member,
  'merchant-categories': merchantCategory,
  'merchants': merchant,
  'portfolio-transactions': portfolioTransaction,
  'portfolios': portfolio,
  preferences,
  'price-overrides': priceOverride,
  'recurring-occurrences': recurringOccurrence,
  'recurring-series': recurringSeries,
  'rules': rule,
  'tags': tag,
  'transaction-categories': transactionCategory,
  'transaction-reimbursements': transactionReimbursement,
  'transaction-splits': transactionSplit,
  'transaction-tags': transactionTag,
  'transaction-templates': transactionTemplate,
  'transactions': transaction,
  watchlist,
} as const;

export type AssetRef = z.output<typeof assetSchema>;
export type DataFileName = keyof typeof DATA_FILES;
export type DataRows = { [Name in DataFileName]: z.output<(typeof DATA_FILES)[Name]>[] };

/**
 * The references between files: `field` of each row of `file` names a row `id` of `target` (an
 * array field names several). A reference to a row that is not there fails the restore.
 */
export const REFERENCES: readonly { field: string; file: DataFileName; target: DataFileName }[] = [
  { field: 'ownerMemberId', file: 'accounts', target: 'members' },
  { field: 'accountId', file: 'credit-cards', target: 'accounts' },
  { field: 'parentId', file: 'categories', target: 'categories' },
  { field: 'categoryId', file: 'category-settings', target: 'categories' },
  { field: 'categoryId', file: 'merchant-categories', target: 'categories' },
  { field: 'memberId', file: 'merchant-categories', target: 'members' },
  { field: 'merchantId', file: 'merchant-categories', target: 'merchants' },
  { field: 'memberId', file: 'preferences', target: 'members' },
  { field: 'createdByMemberId', file: 'tags', target: 'members' },
  { field: 'accountId', file: 'transactions', target: 'accounts' },
  { field: 'memberId', file: 'transactions', target: 'members' },
  { field: 'merchantId', file: 'transactions', target: 'merchants' },
  { field: 'transferCounterpartId', file: 'transactions', target: 'transactions' },
  { field: 'transferDestinationAccountId', file: 'transactions', target: 'accounts' },
  { field: 'transferDestinationGoalId', file: 'transactions', target: 'goals' },
  { field: 'transferDestinationPortfolioId', file: 'transactions', target: 'portfolios' },
  { field: 'installmentPlanId', file: 'transactions', target: 'installment-plans' },
  { field: 'installmentUnlinkedPlanId', file: 'transactions', target: 'installment-plans' },
  { field: 'accountId', file: 'installment-plans', target: 'accounts' },
  { field: 'categoryId', file: 'installment-plans', target: 'categories' },
  { field: 'createdByMemberId', file: 'installment-plans', target: 'members' },
  { field: 'planId', file: 'installments', target: 'installment-plans' },
  { field: 'accountId', file: 'transaction-templates', target: 'accounts' },
  { field: 'categoryId', file: 'transaction-templates', target: 'categories' },
  { field: 'memberId', file: 'transaction-templates', target: 'members' },
  { field: 'merchantId', file: 'transaction-templates', target: 'merchants' },
  { field: 'categoryId', file: 'transaction-categories', target: 'categories' },
  { field: 'memberId', file: 'transaction-categories', target: 'members' },
  { field: 'transactionId', file: 'transaction-categories', target: 'transactions' },
  { field: 'expenseTransactionId', file: 'transaction-reimbursements', target: 'transactions' },
  { field: 'reimbursementTransactionId', file: 'transaction-reimbursements', target: 'transactions' },
  { field: 'categoryId', file: 'transaction-splits', target: 'categories' },
  { field: 'transactionId', file: 'transaction-splits', target: 'transactions' },
  { field: 'memberId', file: 'transaction-splits', target: 'expense-group-members' },
  { field: 'groupId', file: 'expense-group-members', target: 'expense-groups' },
  { field: 'householdMemberId', file: 'expense-group-members', target: 'members' },
  { field: 'groupId', file: 'expense-group-expenses', target: 'expense-groups' },
  { field: 'paidByMemberId', file: 'expense-group-expenses', target: 'expense-group-members' },
  { field: 'transactionId', file: 'expense-group-expenses', target: 'transactions' },
  { field: 'groupId', file: 'expense-group-settlements', target: 'expense-groups' },
  { field: 'fromMemberId', file: 'expense-group-settlements', target: 'expense-group-members' },
  { field: 'toMemberId', file: 'expense-group-settlements', target: 'expense-group-members' },
  { field: 'transactionId', file: 'expense-group-settlements', target: 'transactions' },
  { field: 'tagId', file: 'transaction-tags', target: 'tags' },
  { field: 'transactionId', file: 'transaction-tags', target: 'transactions' },
  { field: 'ownerMemberId', file: 'rules', target: 'members' },
  { field: 'accountId', file: 'recurring-series', target: 'accounts' },
  { field: 'categoryId', file: 'recurring-series', target: 'categories' },
  { field: 'memberId', file: 'recurring-series', target: 'members' },
  { field: 'seriesId', file: 'recurring-occurrences', target: 'recurring-series' },
  { field: 'transactionId', file: 'recurring-occurrences', target: 'transactions' },
  { field: 'memberId', file: 'budgets', target: 'members' },
  { field: 'accountIds', file: 'budget-categories', target: 'accounts' },
  { field: 'budgetId', file: 'budget-categories', target: 'budgets' },
  { field: 'categoryId', file: 'budget-categories', target: 'categories' },
  { field: 'budgetId', file: 'budget-incomes', target: 'budgets' },
  { field: 'loanId', file: 'goals', target: 'loans' },
  { field: 'memberId', file: 'goals', target: 'members' },
  { field: 'accountId', file: 'goal-account-links', target: 'accounts' },
  { field: 'goalId', file: 'goal-account-links', target: 'goals' },
  { field: 'categoryId', file: 'goal-activities', target: 'categories' },
  { field: 'createdByMemberId', file: 'goal-activities', target: 'members' },
  { field: 'goalId', file: 'goal-activities', target: 'goals' },
  { field: 'memberId', file: 'goal-activities', target: 'members' },
  { field: 'transactionId', file: 'goal-activities', target: 'transactions' },
  { field: 'goalId', file: 'goal-transaction-fundings', target: 'goals' },
  { field: 'transactionId', file: 'goal-transaction-fundings', target: 'transactions' },
  { field: 'ownerMemberId', file: 'loans', target: 'members' },
  { field: 'securedAssetId', file: 'loans', target: 'manual-assets' },
  { field: 'loanId', file: 'loan-adjustments', target: 'loans' },
  { field: 'loanId', file: 'loan-rate-periods', target: 'loans' },
  { field: 'loanId', file: 'loan-repayments', target: 'loans' },
  { field: 'transactionId', file: 'loan-repayments', target: 'transactions' },
  { field: 'ownerMemberId', file: 'manual-assets', target: 'members' },
  { field: 'manualAssetId', file: 'manual-asset-valuations', target: 'manual-assets' },
  { field: 'manualAssetId', file: 'crypto-wallet-addresses', target: 'manual-assets' },
  { field: 'addressId', file: 'crypto-wallet-tokens', target: 'crypto-wallet-addresses' },
  { field: 'linkedAccountId', file: 'portfolios', target: 'accounts' },
  { field: 'ownerMemberId', file: 'portfolios', target: 'members' },
  { field: 'memberId', file: 'portfolio-transactions', target: 'members' },
  { field: 'portfolioId', file: 'portfolio-transactions', target: 'portfolios' },
  { field: 'createdByMemberId', file: 'price-overrides', target: 'members' },
  { field: 'createdByMemberId', file: 'exchange-rate-overrides', target: 'members' },
  { field: 'memberId', file: 'watchlist', target: 'members' },
];

const manifestFile = z.object({ bytes: z.number().int().min(0), path: z.string().min(1).max(255), rows: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/u) });

export const manifestSchema = z.object({
  appVersion: z.string().max(100),
  currency: currency.nullable(),
  exportedAt: timestamp,
  exportedBy: z.object({ memberId: id }),
  files: z.array(manifestFile).max(RESTORE_LIMITS.maxFiles),
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.string().regex(/^\d{1,4}\.\d{1,4}$/u),
});

export type RestoreManifest = z.output<typeof manifestSchema>;

/**
 * Raw rows of an export at minor version `minor`, rewritten to the current minor version's shape.
 * Keyed by the minor version a migration brings an export up from; run in order.
 */
export const MINOR_MIGRATIONS: Readonly<Record<number, (files: Partial<Record<DataFileName, unknown[]>>) => void>> = {};
