/* eslint perfectionist/sort-objects: off */
// Must come before the validator import below: the market-data response schemas are created at
// module load and need `.openapi()` to exist.
import './zod-openapi';

import { z } from 'zod';

import {
  companyInformationResponseSchema,
  earningsResponseSchema,
  financialsResponseSchema,
  fundamentalsResponseSchema,
  historicalDividendResponseSchema,
  historicalPriceResponseSchema,
  newsResponseSchema,
  quoteResponseSchema,
  searchTickerResponseSchema,
} from '@validators/financial-markets-dtos';

/**
 * Response schemas for the public API reference (`docs/openapi/wondermoney.json`).
 *
 * The API has no response validators: controllers build plain JSON. These schemas describe the
 * envelope and the fields a client can rely on. Every object is `passthrough()`, so a field the
 * server adds later does not make the published contract wrong; the reference documents what is
 * stable, not every column an entity happens to hold.
 *
 * Each schema carries a `refId`, so the generated document references it as a named component
 * (`#/components/schemas/Account`) instead of inlining the same shape on every operation.
 *
 * Keep them in step with the controllers when a response key changes: the generated spec is
 * committed, and the docs reference is built from it.
 */

const id = z.number().int();
const money = z.number();
const dateTime = z.string();
const date = z.string();

/** An object whose known fields are documented and whose other fields are allowed. */
const open = <T extends z.ZodRawShape>(name: string, shape: T) =>
  z.object(shape).passthrough().openapi(name);

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const tagSchema = open('Tag', {
  name: z.string(),
  tagKey: id,
});

export const categorySchema = open('Category', {
  categoryKey: id,
  color: nullableString,
  isIncome: z.boolean().optional(),
  name: z.string(),
  parentCategoryKey: nullableNumber,
});

export const accountSchema = open('Account', {
  accountFinancialInstitutionKey: z
    .object({ displayName: nullableString, logoUrl: nullableString })
    .nullable(),
  accountKey: id,
  accountName: nullableString,
  accountType: nullableString,
  appuserCurrencyAvailableBalance: nullableNumber,
  appuserCurrencyBalance: nullableNumber,
  availableBalance: nullableNumber,
  balance: nullableNumber,
  creditCard: z.record(z.string(), z.unknown()).nullable(),
  currencyKey: z.object({ code: z.string() }),
  fxStatus: z.string(),
  isOwnedByViewer: z.boolean(),
  isPrivate: z.boolean(),
  ownerFirstName: nullableString,
  refreshedAt: nullableString,
  source: z.enum(['manual', 'open_banking']),
});

export const accountTypeSchema = open('AccountType', {
  accountTypeKey: id,
  description: z.string(),
});

export const currencySchema = open('Currency', {
  code: z.string(),
  currencyKey: id,
  name: z.string().optional(),
  symbol: z.string().optional(),
});

export const financialInstitutionSchema = open('FinancialInstitution', {
  accountFinancialInstitutionKey: id,
  displayName: nullableString,
  logoUrl: nullableString,
  name: z.string(),
});

export const transactionSplitSchema = open('TransactionSplit', {
  amount: money,
  categoryKey: nullableNumber,
  description: nullableString,
  splitKey: id,
});

export const transactionSchema = open('Transaction', {
  accountKey: z.union([id, z.object({ accountKey: id })]).optional(),
  amount: money,
  categoryKey: nullableNumber,
  currencyKey: z.object({ code: z.string() }).optional(),
  description: nullableString,
  notes: nullableString,
  settlementAmount: nullableNumber,
  splits: z.array(transactionSplitSchema).optional(),
  status: z.string().optional(),
  tags: z.array(tagSchema).optional(),
  transactionDate: date,
  transactionKey: id,
  transactionType: z.string().optional(),
  transferDestination: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const transactionPageSchema = open('TransactionPage', {
  completeness: z.record(z.string(), z.unknown()).nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
  moneyIn: nullableNumber,
  moneyOut: nullableNumber,
  nextCursor: nullableString,
  total: nullableNumber,
  totalAmount: nullableNumber,
  transactions: z.array(transactionSchema),
});

export const transactionHistoryEntrySchema = open('TransactionHistoryEntry', {
  actorType: z.string(),
  changes: z.record(z.string(), z.unknown()),
  createdAt: dateTime,
  eventType: z.string(),
  source: z.string(),
});

export const transactionMerchantSchema = open('TransactionMerchant', {
  name: z.string(),
  transactionCount: z.number().int().optional(),
});

export const transactionReviewSummarySchema = open('TransactionReviewSummary', {
  reviewed: z.number().int(),
  total: z.number().int(),
  unreviewed: z.number().int(),
});

export const attachmentSchema = open('Attachment', {
  attachmentId: id,
  contentType: z.string(),
  createdAt: dateTime,
  fileName: z.string(),
  size: z.number().int(),
});

export const metricsSchema = open('Metrics', {
  metrics: z.record(z.string(), z.unknown()),
});

export const cashflowSchema = open('Cashflow', {
  cashflow: z.unknown(),
  completeness: z.record(z.string(), z.unknown()).nullable(),
});

export const forecastSchema = open('Forecast', {
  completeness: z.record(z.string(), z.unknown()).nullable(),
  days: z.array(z.record(z.string(), z.unknown())).optional(),
  forecast: z.array(z.record(z.string(), z.unknown())).optional(),
});

const creditCardStatementShape = {
  availableCredit: nullableNumber,
  balance: money,
  charges: money,
  dueDate: date,
  isCurrent: z.boolean(),
  payments: money,
  periodEnd: date,
  periodStart: date,
  status: z.enum(['closed', 'open', 'overdue', 'paid']),
};

export const creditCardStatementSchema = open('CreditCardStatement', creditCardStatementShape);

export const creditCardStatementDetailSchema = open('CreditCardStatementDetail', {
  ...creditCardStatementShape,
  transactions: z.array(open('CreditCardStatementTransaction', {
    amount: nullableNumber,
    description: nullableString,
    merchantName: nullableString,
    transactionDate: date.nullable(),
    transactionKey: id,
  })),
});

export const budgetSchema = open('Budget', {
  budgetKey: id,
  categories: z.array(z.record(z.string(), z.unknown())).optional(),
  currencyKey: z.object({ code: z.string() }).optional(),
  name: z.string(),
});

export const budgetTemplateSchema = open('BudgetTemplate', {
  budgetKey: id,
  categories: z.array(z.record(z.string(), z.unknown())),
  month: z.number().int().nullable(),
  year: z.number().int(),
});

export const budgetCategorySchema = open('BudgetCategory', {
  amount: money,
  budgetTemplateCategoryKey: id,
  categoryKey: id,
});

export const budgetSuggestionSchema = open('BudgetSuggestion', {
  categoryKey: id,
  reason: z.string().optional(),
  suggestedAmount: money,
});

export const goalSchema = open('Goal', {
  accounts: z.array(z.record(z.string(), z.unknown())).optional(),
  currentAmount: nullableNumber,
  goalKey: id,
  name: z.string(),
  status: z.string().optional(),
  targetAmount: nullableNumber,
  targetDate: nullableString,
});

export const goalActivitySchema = open('GoalActivity', {
  activity: z.array(z.record(z.string(), z.unknown())),
});

export const ruleSchema = open('Rule', {
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
  conditions: z.array(z.record(z.string(), z.unknown())).optional(),
  enabled: z.boolean().optional(),
  name: z.string(),
  ruleId: id,
});

export const loanSchema = open('Loan', {
  currencyKey: z.object({ code: z.string() }).optional(),
  interestRate: nullableNumber,
  loanKey: id,
  name: z.string(),
  outstandingBalance: nullableNumber,
  principal: nullableNumber,
  status: z.string().optional(),
});

export const loanSummarySchema = open('LoanSummary', {
  loan: loanSchema,
  summary: z.record(z.string(), z.unknown()),
});

export const loanProjectionSchema = open('LoanProjection', {
  projection: z.array(z.record(z.string(), z.unknown())),
});

export const loanScheduleEntrySchema = open('LoanScheduleEntry', {
  amount: money,
  balance: nullableNumber,
  dueDate: date,
  interest: nullableNumber,
  principal: nullableNumber,
});

export const loanRepaymentSchema = open('LoanRepayment', {
  amount: money,
  paidAt: nullableString,
  repaymentLinkId: id.optional(),
  transactionKey: nullableNumber,
});

export const manualAssetSchema = open('ManualAsset', {
  assetType: z.string().optional(),
  currencyKey: z.object({ code: z.string() }).optional(),
  currentValue: nullableNumber,
  manualAssetKey: id,
  name: z.string(),
});

export const valuationSchema = open('Valuation', {
  manualAssetKey: id,
  notes: nullableString,
  valuationId: id,
  value: money,
  valuedAt: date,
});

export const netWorthSchema = open('NetWorth', {
  netWorth: z.record(z.string(), z.unknown()),
});

export const netWorthHistoryPointSchema = open('NetWorthHistoryPoint', {
  assets: nullableNumber,
  date,
  liabilities: nullableNumber,
  netWorth: money,
});

export const portfolioSchema = open('Portfolio', {
  benchmarkSymbol: nullableString,
  costBasisMethod: z.string().optional(),
  currencyKey: z.object({ code: z.string() }).optional(),
  description: nullableString,
  excluded: z.boolean().optional(),
  favored: z.boolean().optional(),
  name: z.string(),
  portfolioKey: id,
  targetAllocation: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const holdingSchema = open('Holding', {
  costBasis: nullableNumber,
  currencyKey: z.object({ code: z.string() }).optional(),
  financialAssetKey: id.optional(),
  marketValue: nullableNumber,
  name: nullableString,
  quantity: nullableNumber,
  symbol: z.string(),
});

const priceSource = z.enum(['manual', 'market']);

export const assetPriceHistorySchema = open('AssetPriceHistory', {
  currency: nullableString,
  prices: z.array(open('AssetPricePoint', { date, price: z.number(), source: priceSource })),
});

export const assetPriceOnDaySchema = open('AssetPriceOnDay', {
  currency: nullableString,
  date,
  override: open('AssetPriceOverride', { note: nullableString, price: z.number() }).nullable(),
  price: nullableNumber,
  source: priceSource.nullable(),
});

export const portfolioTransactionSchema = open('PortfolioTransaction', {
  amount: nullableNumber,
  quantity: nullableNumber,
  symbol: nullableString,
  transactionDate: date,
  transactionKey: id,
  transactionType: z.string(),
});

export const portfolioDashboardSchema = open('PortfolioDashboard', {
  dashboard: z.record(z.string(), z.unknown()),
});

export const performanceSchema = open('PortfolioPerformance', {
  performance: z.record(z.string(), z.unknown()),
});

export const allocationSchema = open('PortfolioAllocation', {
  allocation: z.record(z.string(), z.unknown()),
});

export const topMoversSchema = open('PortfolioTopMovers', {
  topMovers: z.array(z.record(z.string(), z.unknown())),
});

export const portfolioCalendarSchema = open('PortfolioCalendar', {
  calendar: z.array(z.record(z.string(), z.unknown())),
});

export const dividendIncomeSchema = open('DividendIncome', {
  income: z.record(z.string(), z.unknown()),
});

export const recurringSeriesSchema = open('RecurringSeries', {
  amount: nullableNumber,
  frequency: z.string().optional(),
  name: z.string(),
  nextExpectedDate: nullableString,
  recurringSeriesId: id,
  status: z.string().optional(),
});

export const recurringOccurrenceSchema = open('RecurringOccurrence', {
  amount: nullableNumber,
  expectedDate: date,
  recurringSeriesId: id,
  status: z.string(),
});

export const reportSchema = open('Report', {
  completeness: z.record(z.string(), z.unknown()).nullable().optional(),
  data: z.unknown(),
  filters: z.record(z.string(), z.unknown()),
  generatedAt: dateTime,
});

export const spendingVsNormalRowSchema = open('SpendingVsNormalRow', {
  categoryKey: z.string(),
  name: z.string(),
  normal: nullableNumber,
  parentKey: nullableString,
  ratio: nullableNumber,
  total: money,
});

export const spendingVsNormalDataSchema = open('SpendingVsNormalData', {
  month: z.string(),
  rows: z.array(spendingVsNormalRowSchema),
});

export const spendingVsNormalCompletenessSchema = open('SpendingVsNormalCompleteness', {
  currencyCode: z.string(),
  isComplete: z.boolean(),
  unconvertedCurrencies: z.array(z.string()),
  unconvertedTransactions: z.number().int(),
});

export const configSchema = open('Config', {
  brokers: z.array(z.record(z.string(), z.unknown())),
  categories: z.array(categorySchema),
  currencies: z.array(currencySchema),
  fileStorage: z.boolean(),
  financialInstitutions: z.array(financialInstitutionSchema),
  financialTransactionTypes: z.array(z.record(z.string(), z.unknown())),
  transactionTypes: z.array(z.record(z.string(), z.unknown())),
});

export const exchangeRateOverrideSchema = open('ExchangeRateOverride', {
  currencyCode: z.string(),
  date,
  overrideId: id,
  rate: z.number(),
});

export const currencyRatesSchema = open('CurrencyRates', {
  currency: z.string(),
  overrides: z.array(exchangeRateOverrideSchema),
});

export const operationSchema = open('Operation', {
  error: nullableString,
  operationId: z.string(),
  progress: nullableNumber,
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string(),
  type: z.string().optional(),
});

export const assistantConsentSchema = open('AssistantConsent', {
  consent: z.record(z.string(), z.unknown()),
});

export const assistantAuditEventSchema = open('AssistantAuditEvent', {
  createdAt: dateTime,
  eventType: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const importSessionSchema = open('ImportSession', {
  columnMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  importSessionId: z.union([id, z.string()]),
  mappingSource: z.string().optional(),
  status: z.string(),
  summary: z.record(z.string(), z.unknown()).optional(),
  warning: nullableString,
});

export const importPreviewSchema = open('ImportPreview', {
  preview: z.record(z.string(), z.unknown()),
});

export const uploadUrlSchema = open('UploadUrl', {
  expiresAt: dateTime.optional(),
  key: z.string(),
  uploadUrl: z.string(),
});

export const csvFileSchema = z.string().openapi('CsvFile', { description: 'A CSV file' });

/** Response for a list endpoint: `{ [key]: Item[] }` plus any other fields. */
export function listResponse<T extends z.ZodType>(refId: string, key: string, item: T) {
  return z.object({ [key]: z.array(item) }).passthrough().openapi(refId);
}

/** Response for a single-resource endpoint: `{ [key]: Item }`. */
export function itemResponse<T extends z.ZodType>(refId: string, key: string, item: T) {
  return z.object({ [key]: item }).passthrough().openapi(refId);
}

export const marketSchemas = {
  companyInformation: companyInformationResponseSchema.openapi('CompanyInformation'),
  earnings: earningsResponseSchema.openapi('Earnings'),
  financials: financialsResponseSchema.openapi('Financials'),
  fundamentals: fundamentalsResponseSchema.openapi('Fundamentals'),
  historicalDividend: historicalDividendResponseSchema.openapi('HistoricalDividend'),
  historicalPrice: historicalPriceResponseSchema.openapi('HistoricalPrice'),
  news: newsResponseSchema.openapi('News'),
  quote: quoteResponseSchema.openapi('Quote'),
  searchTicker: searchTickerResponseSchema.openapi('TickerSearch'),
} as const;
