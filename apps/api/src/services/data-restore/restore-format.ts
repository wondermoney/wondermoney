import { z } from 'zod';

import { EXPORT_FORMAT } from '@service/data-export/export-format';

/**
 * What a restore accepts: the WonderMoney export format (`data-export/export-format.ts`), file by
 * file, as Zod schemas. Every row of every `data/*.json` file is checked against these before
 * anything is written.
 *
 * Versions: a restore reads every 1.x export. Rows are parsed leniently about fields (an unknown
 * field from a newer minor version is dropped), strictly about values. An older minor version is
 * brought up to the current one by {@link MINOR_MIGRATIONS} before the rows are checked. 1.1 only
 * added files (manual assets), which a 1.0 export simply does not have, so there is nothing to
 * migrate yet. Another major version is refused.
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

const member = z.object({ email: text(320), firstName: text(255), id, isExporter: z.boolean(), lastName: text(255), role: z.enum(['member', 'owner']).nullable() });

const preferences = z.object({
  currency: currency.nullable(),
  emailNotifications: z.object({ accountRecovery: flag, budgetAlerts: flag, growthEmails: flag, monthlyStory: flag, weeklyInsights: flag }),
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
  isPrivate: z.boolean(),
  name: text(255),
  openingBalance: optionalDecimal,
  openingBalanceDate: optionalTimestamp,
  ownerMemberId: ref,
  type: text(255),
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
const merchant = z.object({ global: z.boolean(), id, name: name(500) });
const merchantCategory = z.object({ categoryId: id, memberId: ref, merchantId: id, source: z.enum(['manual', 'openai', 'user']) });
const tag = z.object({ color: z.string().regex(/^#[0-9a-f]{3,6}$/iu), createdByMemberId: ref, id, name: name(64) });

const transaction = z.object({
  accountId: ref,
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
  status: text(64),
  transferCounterpartId: ref,
  transferDestinationAccountId: ref,
  transferDestinationGoalId: ref,
  transferDestinationPortfolioId: ref,
  type: text(64),
  uneditedSettlementAmount: optionalDecimal,
  userAmount: optionalDecimal,
  userCurrency: currency.nullable(),
  userExchangeRate: optionalDecimal,
}).refine((row) => [row.transferDestinationAccountId, row.transferDestinationGoalId, row.transferDestinationPortfolioId].filter((value) => value !== null).length <= 1, { message: 'at most one transfer destination' });

const transactionCategory = z.object({ categoryId: id, memberId: ref, source: z.enum(['deterministic', 'manual', 'openai', 'rule', 'user']), transactionId: id });
const transactionSplit = z.object({ amount: decimal, categoryId: ref, id, notes: text(500), position: z.number().int().min(0).max(10_000), transactionId: id });
const transactionTag = z.object({ tagId: id, transactionId: id });

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

const budget = z.object({ currency, description: text(10_000), id, memberId: ref, name: name(255), numAdults: z.number().int().min(0).max(1000), numDependents: z.number().int().min(0).max(1000) });
const budgetCategory = z.object({ accountIds: z.array(id).max(1000), amount: optionalDecimal, budgetId: id, categoryId: id, month: z.number().int().min(0).max(12), recurrency: z.enum(RECURRENCY).nullable(), year: z.number().int().min(1900).max(9999) });
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
  annualInterestRateBps: int.nullable(),
  currency,
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
  rateType: z.enum(['FIXED', 'UNKNOWN']),
  regularPaymentAmount: optionalDecimal,
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
  kind: z.enum(['other', 'property', 'valuable', 'vehicle']),
  name: name(255),
  notes: text(10_000),
  ownerMemberId: ref,
  purchaseDate: day.nullable(),
  purchasePrice: optionalDecimal,
});
const manualAssetValuation = z.object({ date: day, manualAssetId: id, note: text(10_000), value: decimal });
const loanAdjustment = z.object({ amount: decimal, effectiveDate: day, loanId: id, reason: text(10_000), type: z.enum(['BALANCE_CORRECTION', 'CAPITALIZED_INTEREST', 'FEE', 'PRINCIPAL_DECREASE', 'PRINCIPAL_INCREASE', 'WRITE_OFF']) });
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

/** Every data file a restore reads, by its name in `data/<name>.json`. */
export const DATA_FILES = {
  'accounts': account,
  'budget-categories': budgetCategory,
  'budget-incomes': budgetIncome,
  'budgets': budget,
  'categories': category,
  'category-settings': categorySetting,
  'goal-account-links': goalAccountLink,
  'goal-activities': goalActivity,
  'goal-transaction-fundings': goalFunding,
  'goals': goal,
  'loan-adjustments': loanAdjustment,
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
  'recurring-occurrences': recurringOccurrence,
  'recurring-series': recurringSeries,
  'rules': rule,
  'tags': tag,
  'transaction-categories': transactionCategory,
  'transaction-splits': transactionSplit,
  'transaction-tags': transactionTag,
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
  { field: 'categoryId', file: 'transaction-categories', target: 'categories' },
  { field: 'memberId', file: 'transaction-categories', target: 'members' },
  { field: 'transactionId', file: 'transaction-categories', target: 'transactions' },
  { field: 'categoryId', file: 'transaction-splits', target: 'categories' },
  { field: 'transactionId', file: 'transaction-splits', target: 'transactions' },
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
  { field: 'loanId', file: 'loan-adjustments', target: 'loans' },
  { field: 'loanId', file: 'loan-repayments', target: 'loans' },
  { field: 'transactionId', file: 'loan-repayments', target: 'transactions' },
  { field: 'ownerMemberId', file: 'manual-assets', target: 'members' },
  { field: 'manualAssetId', file: 'manual-asset-valuations', target: 'manual-assets' },
  { field: 'linkedAccountId', file: 'portfolios', target: 'accounts' },
  { field: 'ownerMemberId', file: 'portfolios', target: 'members' },
  { field: 'memberId', file: 'portfolio-transactions', target: 'members' },
  { field: 'portfolioId', file: 'portfolio-transactions', target: 'portfolios' },
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
