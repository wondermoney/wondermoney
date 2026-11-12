/* eslint perfectionist/sort-interfaces: off, perfectionist/sort-named-imports: off, perfectionist/sort-objects: off */
import { z } from 'zod';

import {
  createOfflineAccountRequestSchema,
  createTransactionRequestSchema,
  getAccountMetricsRequestSchema,
  getAccountRequestSchema,
  getAccountsCashflowRequestSchema,
  getAccountsForecastRequestSchema,
  getAccountsMetricsRequestSchema,
  getAccountTransactionsRequestSchema,
  getCategorySpendingRequestSchema,
  getCreditCardStatementDetailRequestSchema,
  getCreditCardStatementsRequestSchema,
  getRecentTransactionsRequestSchema,
  getTransactionHistoryRequestSchema,
  getTransactionMerchantsRequestSchema,
  getTransactionsRequestSchema,
  updateAccountRequestSchema,
  updateTransactionRequestSchema,
  updateTransactionsRequestSchema,
} from '@validators/account';
import { assistantAuditLogQuerySchema } from '@validators/assistant';
import { listAttachmentsRequestSchema } from '@validators/attachment';
import {
  addBudgetCategoryRequestSchema,
  createBudgetRequestSchema,
  getBudgetForecastRequestSchema,
  getBudgetRequestSchema,
  getBudgetSuggestionsRequestSchema,
  getBudgetTemplateByYearAndMonthRequestSchema,
  getBudgetTemplateByYearRequestSchema,
  getBudgetTemplateByYearUntilMonthRequestSchema,
  updateBudgetAccountsRequestSchema,
  updateBudgetCategoryAmountRequestSchema,
  updateBudgetRequestSchema,
  updateBudgetTemplateRequestSchema,
} from '@validators/budget';
import { createCategoryRequestSchema, updateCategoryRequestSchema } from '@validators/category';
import {
  getCompanyInfoRequestSchema,
  getEarningsRequestSchema,
  getFinancialsRequestSchema,
  getFundamentalsRequestSchema,
  getHistoricalDividendRequestSchema,
  getHistoricalPriceRequestSchema,
  getNewsRequestSchema,
  getQuoteRequestSchema,
  searchTickerRequestSchema,
} from '@validators/financial-markets';
import {
  assignGoalMoneyRequestSchema,
  createGoalRequestSchema,
  fundGoalTransactionRequestSchema,
  goalAccountLinkRequestSchema,
  goalActivityQueryRequestSchema,
  goalParamsRequestSchema,
  listGoalsRequestSchema,
  moveGoalMoneyOutRequestSchema,
  updateGoalRequestSchema,
} from '@validators/goal';
import { loanIdParamSchema, loanProjectionSchema, repaymentCandidatesSchema } from '@validators/loan';
import { manualAssetParamsSchema } from '@validators/manual-asset';
import { netWorthHistoryQuerySchema } from '@validators/net-worth';
import {
  getAggregateAllocationRequestSchema,
  getAggregateDashboardRequestSchema,
  getAggregatePerformanceRequestSchema,
  getAggregateTopMoversRequestSchema,
  getAssetPriceHistoryRequestSchema,
  getAssetPriceOverrideRequestSchema,
  getHoldingMarketDataRequestSchema,
  getPortfolioAllocationRequestSchema,
  getPortfolioDashboardRequestSchema,
  getPortfolioHistoryStatusRequestSchema,
  getPortfolioHoldingLotsRequestSchema,
  getPortfolioHoldingsRequestSchema,
  getPortfolioImportSessionPreviewRequestSchema,
  getPortfolioPerformanceRequestSchema,
  getPortfolioRequestSchema,
  getPortfoliosMetricsRequestSchema,
  getPortfoliosTransactionRequestSchema,
  getPortfolioTopMoversRequestSchema,
  getPortfolioTransactionRequestSchema,
} from '@validators/portfolio';
import { recurringListSchema, recurringOccurrencesQuerySchema } from '@validators/recurring';
import { monthComparisonQuerySchema, reportsQuerySchema, spendingVsNormalQuerySchema } from '@validators/reports';
import { setTransactionTagsRequestSchema } from '@validators/tag';
import { getTransactionImportSchema } from '@validators/transaction-import';
import { setTransactionSplitsRequestSchema } from '@validators/transaction-split';

import {
  accountSchema,
  accountTypeSchema,
  allocationSchema,
  assistantAuditEventSchema,
  assistantConsentSchema,
  attachmentSchema,
  budgetCategorySchema,
  budgetSchema,
  budgetSuggestionSchema,
  budgetTemplateSchema,
  cashflowSchema,
  categorySchema,
  configSchema,
  creditCardStatementDetailSchema,
  creditCardStatementSchema,
  csvFileSchema,
  currencyRatesSchema,
  currencySchema,
  dividendIncomeSchema,
  financialInstitutionSchema,
  forecastSchema,
  goalActivitySchema,
  goalSchema,
  assetPriceHistorySchema,
  assetPriceOnDaySchema,
  holdingSchema,
  importPreviewSchema,
  importSessionSchema,
  itemResponse,
  listResponse,
  loanRepaymentSchema,
  loanScheduleEntrySchema,
  loanSchema,
  loanSummarySchema,
  manualAssetSchema,
  marketSchemas,
  metricsSchema,
  netWorthHistoryPointSchema,
  netWorthSchema,
  operationSchema,
  performanceSchema,
  portfolioCalendarSchema,
  portfolioDashboardSchema,
  portfolioSchema,
  portfolioTransactionSchema,
  recurringOccurrenceSchema,
  recurringSeriesSchema,
  reportSchema,
  ruleSchema,
  spendingVsNormalCompletenessSchema,
  spendingVsNormalDataSchema,
  tagSchema,
  topMoversSchema,
  transactionHistoryEntrySchema,
  transactionMerchantSchema,
  transactionPageSchema,
  transactionReviewSummarySchema,
  transactionSchema,
  valuationSchema,
} from './response-schemas';

/**
 * The public operation catalog: one entry for every route a personal API token can call.
 *
 * Keys are `METHOD /full/path` in Express form (`:param`). The generator walks the mounted
 * routers, filters them through `api-token-policy.ts`, and refuses to emit a spec when an
 * allowed route has no entry here or an entry matches no route. That is what keeps the
 * committed spec honest: adding a route to the allowlist fails generation until it is
 * documented, and removing one fails until its entry is deleted.
 *
 * `request` is the validator envelope the controller parses (`{ body, params, query }`), so
 * the published parameters and body are the ones the server actually accepts. `response`
 * describes the success body; omit it together with `noContent: true` for a handler that
 * answers with an empty 200/204.
 */
export interface OperationDefinition {
  description?: string;
  request?: z.ZodTypeAny;
  response?: z.ZodTypeAny;
  summary: string;
  tag: string;
  /** Response media type. Defaults to `application/json`. */
  contentType?: string;
  /** Success status. Defaults to 200. */
  status?: number;
  /** Additional successful statuses with no response body. */
  noContentStatuses?: number[];
  /** The success response has no body. */
  noContent?: boolean;
}

const transactionTypeSchema = z.object({ description: z.string(), transactionTypeKey: z.number().int() }).openapi('TransactionType');
const brokerSchema = z.object({ brokerId: z.number().int(), name: z.string() }).passthrough().openapi('Broker');
const ruleExportSchema = z
  .object({ rules: z.array(z.record(z.string(), z.unknown())), version: z.string() })
  .passthrough()
  .openapi('RuleExport');
const watchlistSchema = z
  .object({
    items: z.array(z.object({ logoUrl: z.string().nullable(), symbol: z.string() })),
    symbols: z.array(z.string()),
  })
  .passthrough()
  .openapi('Watchlist');

const jsonRpcRequestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const jsonRpcResponseSchema = z.union([
  z.object({
    id: z.union([z.string(), z.number(), z.null()]),
    jsonrpc: z.literal('2.0'),
    result: z.record(z.string(), z.unknown()),
  }),
  z.object({
    error: z.object({ code: z.number().int(), data: z.unknown().optional(), message: z.string() }),
    id: z.union([z.string(), z.number(), z.null()]),
    jsonrpc: z.literal('2.0'),
  }),
]);

export const OPERATIONS: Record<string, OperationDefinition> = {
  'POST /v1/mcp': {
    tag: 'MCP',
    summary: 'Send a stateless MCP JSON-RPC request',
    description: 'Uses JSON-RPC over the MCP Streamable HTTP transport. Notifications may return HTTP 202 with no body.',
    noContentStatuses: [202],
    request: z.object({ body: jsonRpcRequestSchema }),
    response: jsonRpcResponseSchema,
  },
  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------
  'GET /v1/account': {
    tag: 'Accounts',
    summary: 'List accounts',
    response: listResponse('AccountList', 'accounts', accountSchema),
  },
  'GET /v1/account/:accountId': {
    tag: 'Accounts',
    summary: 'Get one account',
    request: getAccountRequestSchema,
    response: itemResponse('AccountResponse', 'account', accountSchema),
  },
  'GET /v1/account/:accountId/metrics': {
    tag: 'Accounts',
    summary: 'Get one account’s balance metrics',
    request: getAccountMetricsRequestSchema,
    response: metricsSchema,
  },
  'GET /v1/account/:accountId/recent-transactions': {
    tag: 'Accounts',
    summary: 'List an account’s recent transactions',
    request: getRecentTransactionsRequestSchema,
    response: listResponse('TransactionList', 'transactions', transactionSchema),
  },
  'GET /v1/account/:accountId/statements': {
    tag: 'Accounts',
    summary: 'List an account’s credit-card statements',
    request: getCreditCardStatementsRequestSchema,
    response: listResponse('CreditCardStatementList', 'statements', creditCardStatementSchema),
  },
  'GET /v1/account/:accountId/statements/:statementDate': {
    tag: 'Accounts',
    summary: 'Get one credit-card statement and its transactions',
    request: getCreditCardStatementDetailRequestSchema,
    response: itemResponse('CreditCardStatementResponse', 'statement', creditCardStatementDetailSchema),
  },
  'GET /v1/account/:accountId/transaction': {
    tag: 'Transactions',
    summary: 'List one account’s transactions',
    request: getAccountTransactionsRequestSchema,
    response: transactionPageSchema,
  },
  'GET /v1/account/account-types': {
    tag: 'Accounts',
    summary: 'List account types',
    response: listResponse('AccountTypeList', 'accountTypes', accountTypeSchema),
  },
  'GET /v1/account/cashflow': {
    tag: 'Accounts',
    summary: 'Get household cashflow',
    request: getAccountsCashflowRequestSchema,
    response: cashflowSchema,
  },
  'GET /v1/account/currencies': {
    tag: 'Accounts',
    summary: 'List currencies',
    response: listResponse('CurrencyList', 'currencies', currencySchema),
  },
  'GET /v1/account/financial-institutions': {
    tag: 'Accounts',
    summary: 'List financial institutions',
    response: listResponse('FinancialInstitutionList', 'accountFinancialInstitutions', financialInstitutionSchema),
  },
  'GET /v1/account/forecast': {
    tag: 'Accounts',
    summary: 'Forecast account balances',
    request: getAccountsForecastRequestSchema,
    response: forecastSchema,
  },
  'GET /v1/account/metrics': {
    tag: 'Accounts',
    summary: 'Get household balance metrics',
    request: getAccountsMetricsRequestSchema,
    response: metricsSchema,
  },
  'GET /v1/account/transaction': {
    tag: 'Transactions',
    summary: 'List transactions',
    description: 'Keyset-paginated. Pass `nextCursor` back as `cursor` to fetch the next page.',
    request: getTransactionsRequestSchema,
    response: transactionPageSchema,
  },
  'GET /v1/account/transaction-merchants': {
    tag: 'Transactions',
    summary: 'Search transaction merchants',
    request: getTransactionMerchantsRequestSchema,
    response: listResponse('TransactionMerchantList', 'transactionMerchants', transactionMerchantSchema),
  },
  'GET /v1/account/transaction-types': {
    tag: 'Transactions',
    summary: 'List transaction types',
    response: listResponse('TransactionTypeList', 'transactionTypes', transactionTypeSchema),
  },
  'GET /v1/account/transaction/:transactionId/attachments': {
    tag: 'Transactions',
    summary: 'List a transaction’s attachments',
    request: listAttachmentsRequestSchema,
    response: listResponse('AttachmentList', 'attachments', attachmentSchema),
  },
  'GET /v1/account/transaction/:transactionId/history': {
    tag: 'Transactions',
    summary: 'List a transaction’s audit history',
    request: getTransactionHistoryRequestSchema,
    response: listResponse('TransactionHistoryList', 'history', transactionHistoryEntrySchema),
  },
  'GET /v1/account/transaction/category-spending': {
    tag: 'Transactions',
    summary: 'Get spending by category',
    request: getCategorySpendingRequestSchema,
    response: z
      .object({
        categorySpending: z.array(z.record(z.string(), z.unknown())),
        completeness: z.record(z.string(), z.unknown()).nullable(),
      })
      .passthrough(),
  },
  'GET /v1/account/transaction/review-summary': {
    tag: 'Transactions',
    summary: 'Get the transaction review summary',
    response: transactionReviewSummarySchema,
  },
  'PATCH /v1/account/:accountId': {
    tag: 'Accounts',
    summary: 'Update an account',
    request: updateAccountRequestSchema,
    response: itemResponse('AccountResponse', 'account', accountSchema),
  },
  'PATCH /v1/account/transaction': {
    tag: 'Transactions',
    summary: 'Bulk update transactions',
    description: 'Categorise, hide or mark reviewed up to 500 transactions in one request.',
    request: updateTransactionsRequestSchema,
    noContent: true,
  },
  'PATCH /v1/account/transaction/:transactionId': {
    tag: 'Transactions',
    summary: 'Update a transaction',
    request: updateTransactionRequestSchema,
    response: itemResponse('TransactionResponse', 'transaction', transactionSchema),
  },
  'POST /v1/account/:accountId/transaction': {
    tag: 'Transactions',
    summary: 'Create a transaction on an account',
    request: createTransactionRequestSchema,
    status: 201,
    response: z.object({ possibleDuplicate: z.boolean() }).passthrough(),
  },
  'POST /v1/account/offline': {
    tag: 'Accounts',
    summary: 'Create a manual account',
    request: createOfflineAccountRequestSchema,
    status: 201,
    response: itemResponse('AccountResponse', 'account', accountSchema),
  },
  'PUT /v1/account/transaction/:transactionId/splits': {
    tag: 'Transactions',
    summary: 'Replace a transaction’s splits',
    request: setTransactionSplitsRequestSchema,
    response: itemResponse('TransactionResponse', 'transaction', transactionSchema),
  },
  'PUT /v1/account/transaction/:transactionId/tags': {
    tag: 'Transactions',
    summary: 'Replace a transaction’s tags',
    request: setTransactionTagsRequestSchema,
    response: listResponse('TagList', 'tags', tagSchema),
  },

  // ---------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------
  'GET /v1/budget': {
    tag: 'Budgets',
    summary: 'List budgets',
    response: listResponse('BudgetList', 'budgets', budgetSchema),
  },
  'GET /v1/budget/full': {
    tag: 'Budgets',
    summary: 'List budgets with their categories and amounts',
    response: listResponse('BudgetList', 'budgets', budgetSchema),
  },
  'GET /v1/budget/:budgetKey': {
    tag: 'Budgets',
    summary: 'Get one budget',
    request: getBudgetRequestSchema,
    response: itemResponse('BudgetResponse', 'budget', budgetSchema),
  },
  'GET /v1/budget/:budgetKey/accounts': {
    tag: 'Budgets',
    summary: 'List the accounts linked to a budget',
    request: getBudgetRequestSchema,
    response: listResponse('BudgetAccountList', 'accounts', accountSchema),
  },
  'GET /v1/budget/:budgetKey/forecast': {
    tag: 'Budgets',
    summary: 'Forecast a budget',
    request: getBudgetForecastRequestSchema,
    response: z.object({ forecast: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/budget/:budgetKey/suggestions': {
    tag: 'Budgets',
    summary: 'Suggest budget amounts',
    request: getBudgetSuggestionsRequestSchema,
    response: listResponse('BudgetSuggestionList', 'suggestions', budgetSuggestionSchema),
  },
  'GET /v1/budget/:budgetKey/:year/:month': {
    tag: 'Budgets',
    summary: 'Get a budget template for a month',
    request: getBudgetTemplateByYearAndMonthRequestSchema,
    response: budgetTemplateSchema,
  },
  'GET /v1/budget/:budgetKey/:year': {
    tag: 'Budgets',
    summary: 'Get a budget template for a year',
    request: getBudgetTemplateByYearRequestSchema,
    response: budgetTemplateSchema,
  },
  'GET /v1/budget/:budgetKey/:year/until/:month': {
    tag: 'Budgets',
    summary: 'Get a budget template from January to a month',
    request: getBudgetTemplateByYearUntilMonthRequestSchema,
    response: budgetTemplateSchema,
  },
  'POST /v1/budget': {
    tag: 'Budgets',
    summary: 'Create a budget',
    request: createBudgetRequestSchema,
    status: 201,
    response: itemResponse('BudgetResponse', 'budget', budgetSchema),
  },
  'POST /v1/budget/:budgetKey/category': {
    tag: 'Budgets',
    summary: 'Add a category to a budget',
    request: addBudgetCategoryRequestSchema,
    status: 201,
    response: itemResponse('BudgetCategoryResponse', 'budgetTemplateCategory', budgetCategorySchema),
  },
  'PATCH /v1/budget/:budgetKey': {
    tag: 'Budgets',
    summary: 'Update a budget',
    request: updateBudgetRequestSchema,
    response: itemResponse('BudgetResponse', 'budget', budgetSchema),
  },
  'PATCH /v1/budget/:budgetKey/accounts': {
    tag: 'Budgets',
    summary: 'Replace the accounts linked to a budget',
    request: updateBudgetAccountsRequestSchema,
    response: itemResponse('BudgetResponse', 'budget', budgetSchema),
  },
  'PATCH /v1/budget/:budgetKey/:budgetTemplateCategoryKey': {
    tag: 'Budgets',
    summary: 'Update a budget template category',
    request: updateBudgetTemplateRequestSchema,
    response: itemResponse('BudgetCategoryResponse', 'budgetTemplateCategory', budgetCategorySchema),
  },
  'PATCH /v1/budget/:budgetKey/:year/:month/:categoryKey': {
    tag: 'Budgets',
    summary: 'Update a category amount for a month',
    request: updateBudgetCategoryAmountRequestSchema,
    response: itemResponse('BudgetCategoryResponse', 'budgetTemplateCategory', budgetCategorySchema),
  },

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  'GET /v1/category': {
    tag: 'Categories',
    summary: 'List categories',
    response: listResponse('CategoryList', 'categories', categorySchema),
  },
  'POST /v1/category': {
    tag: 'Categories',
    summary: 'Create a category',
    request: createCategoryRequestSchema,
    status: 201,
    response: itemResponse('CategoryResponse', 'category', categorySchema),
  },
  'PATCH /v1/category/:categoryId': {
    tag: 'Categories',
    summary: 'Update a category',
    request: updateCategoryRequestSchema,
    response: itemResponse('CategoryResponse', 'category', categorySchema),
  },

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------
  'GET /v1/goals': {
    tag: 'Goals',
    summary: 'List goals',
    request: listGoalsRequestSchema,
    response: listResponse('GoalList', 'goals', goalSchema),
  },
  'GET /v1/goals/available-to-assign': {
    tag: 'Goals',
    summary: 'Get the amount available to assign to goals',
    response: z.object({ availableToAssign: z.number() }).passthrough(),
  },
  'GET /v1/goals/debt-strategy': {
    tag: 'Goals',
    summary: 'Get the debt payoff strategy',
    response: z.object({ strategy: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/goals/:goalKey/activity': {
    tag: 'Goals',
    summary: 'List a goal’s activity',
    request: goalActivityQueryRequestSchema,
    response: goalActivitySchema,
  },
  'POST /v1/goals': {
    tag: 'Goals',
    summary: 'Create a goal',
    request: createGoalRequestSchema,
    status: 201,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },
  'POST /v1/goals/:goalKey/assign': {
    tag: 'Goals',
    summary: 'Assign money to a goal',
    request: assignGoalMoneyRequestSchema,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },
  'POST /v1/goals/:goalKey/move-out': {
    tag: 'Goals',
    summary: 'Move money out of a goal',
    request: moveGoalMoneyOutRequestSchema,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },
  'POST /v1/goals/:goalKey/fund-transaction': {
    tag: 'Goals',
    summary: 'Fund a goal from a transaction',
    request: fundGoalTransactionRequestSchema,
    response: itemResponse('GoalFundingResponse', 'funding', z.record(z.string(), z.unknown())),
  },
  'POST /v1/goals/:goalKey/accounts': {
    tag: 'Goals',
    summary: 'Link an account to a goal',
    request: goalAccountLinkRequestSchema,
    status: 201,
    response: itemResponse('GoalAccountLinkResponse', 'link', z.record(z.string(), z.unknown())),
  },
  'POST /v1/goals/:goalKey/restore': {
    tag: 'Goals',
    summary: 'Restore a deleted goal',
    request: goalParamsRequestSchema,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },
  'GET /v1/goals/:goalKey': {
    tag: 'Goals',
    summary: 'Get one goal',
    request: goalParamsRequestSchema,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },
  'PATCH /v1/goals/:goalKey': {
    tag: 'Goals',
    summary: 'Update a goal',
    request: updateGoalRequestSchema,
    response: itemResponse('GoalResponse', 'goal', goalSchema),
  },

  // ---------------------------------------------------------------------------
  // Loans
  // ---------------------------------------------------------------------------
  'GET /v1/loan': {
    tag: 'Loans',
    summary: 'List loans',
    response: listResponse('LoanList', 'loans', loanSchema),
  },
  'GET /v1/loan/overview': {
    tag: 'Loans',
    summary: 'Get the loan overview',
    response: z.object({ overview: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/loan/:loanId': {
    tag: 'Loans',
    summary: 'Get one loan',
    request: loanIdParamSchema,
    response: itemResponse('LoanResponse', 'loan', loanSchema),
  },
  'GET /v1/loan/:loanId/summary': {
    tag: 'Loans',
    summary: 'Get a loan summary',
    request: loanIdParamSchema,
    response: loanSummarySchema,
  },
  'GET /v1/loan/:loanId/projection': {
    tag: 'Loans',
    summary: 'Project a loan’s payoff',
    request: loanProjectionSchema,
    response: z.object({ projection: z.array(z.record(z.string(), z.unknown())) }).passthrough(),
  },
  'GET /v1/loan/:loanId/schedule': {
    tag: 'Loans',
    summary: 'Get a loan repayment schedule',
    request: loanIdParamSchema,
    response: listResponse('LoanScheduleList', 'schedule', loanScheduleEntrySchema),
  },
  'GET /v1/loan/:loanId/repayments': {
    tag: 'Loans',
    summary: 'List a loan’s repayments',
    request: loanIdParamSchema,
    response: listResponse('LoanRepaymentList', 'repayments', loanRepaymentSchema),
  },
  'GET /v1/loan/:loanId/repayment-candidates': {
    tag: 'Loans',
    summary: 'List transactions that could repay a loan',
    request: repaymentCandidatesSchema,
    response: listResponse('LoanRepaymentCandidateList', 'candidates', transactionSchema),
  },

  // ---------------------------------------------------------------------------
  // Manual assets
  // ---------------------------------------------------------------------------
  'GET /v1/manual-assets': {
    tag: 'Manual assets',
    summary: 'List manual assets',
    response: listResponse('ManualAssetList', 'assets', manualAssetSchema),
  },
  'GET /v1/manual-assets/:manualAssetId': {
    tag: 'Manual assets',
    summary: 'Get one manual asset',
    request: manualAssetParamsSchema,
    response: itemResponse('ManualAssetResponse', 'asset', manualAssetSchema),
  },
  'GET /v1/manual-assets/:manualAssetId/valuations': {
    tag: 'Manual assets',
    summary: 'List a manual asset’s valuations',
    request: manualAssetParamsSchema,
    response: listResponse('ValuationList', 'valuations', valuationSchema),
  },

  // ---------------------------------------------------------------------------
  // Net worth
  // ---------------------------------------------------------------------------
  'GET /v1/net-worth': {
    tag: 'Net worth',
    summary: 'Get the current net worth',
    response: netWorthSchema,
  },
  'GET /v1/net-worth/history': {
    tag: 'Net worth',
    summary: 'Get net worth history',
    request: netWorthHistoryQuerySchema,
    response: listResponse('NetWorthHistoryList', 'history', netWorthHistoryPointSchema),
  },

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------
  'GET /v1/operations/:operationId': {
    tag: 'Operations',
    summary: 'Get a background operation',
    request: z.object({ params: z.object({ operationId: z.string() }) }),
    response: operationSchema,
  },

  // ---------------------------------------------------------------------------
  // Portfolio
  // ---------------------------------------------------------------------------
  'GET /v1/portfolio': {
    tag: 'Portfolio',
    summary: 'List portfolios',
    response: listResponse('PortfolioList', 'portfolios', portfolioSchema),
  },
  'GET /v1/portfolio/dashboard': {
    tag: 'Portfolio',
    summary: 'Get the aggregate portfolio dashboard',
    request: getAggregateDashboardRequestSchema,
    response: portfolioDashboardSchema,
  },
  'GET /v1/portfolio/performance': {
    tag: 'Portfolio',
    summary: 'Get aggregate portfolio performance',
    request: getAggregatePerformanceRequestSchema,
    response: performanceSchema,
  },
  'GET /v1/portfolio/allocation': {
    tag: 'Portfolio',
    summary: 'Get the aggregate portfolio allocation',
    request: getAggregateAllocationRequestSchema,
    response: allocationSchema,
  },
  'GET /v1/portfolio/top-movers': {
    tag: 'Portfolio',
    summary: 'Get the aggregate top movers',
    request: getAggregateTopMoversRequestSchema,
    response: topMoversSchema,
  },
  'GET /v1/portfolio/transactions': {
    tag: 'Portfolio',
    summary: 'List portfolio transactions across portfolios',
    request: getPortfoliosTransactionRequestSchema,
    response: listResponse('PortfolioTransactionList', 'transactions', portfolioTransactionSchema),
  },
  'GET /v1/portfolio/holdings': {
    tag: 'Portfolio',
    summary: 'List holdings across portfolios',
    response: listResponse('HoldingList', 'holdings', holdingSchema),
  },
  'GET /v1/portfolio/brokers': {
    tag: 'Portfolio',
    summary: 'List brokers',
    response: listResponse('BrokerList', 'brokers', brokerSchema),
  },
  'GET /v1/portfolio/transaction-types': {
    tag: 'Portfolio',
    summary: 'List portfolio transaction types',
    response: listResponse('TransactionTypeList', 'transactionTypes', transactionTypeSchema),
  },
  'GET /v1/portfolio/metrics': {
    tag: 'Portfolio',
    summary: 'Get portfolio metrics',
    request: getPortfoliosMetricsRequestSchema,
    response: metricsSchema,
  },
  'GET /v1/portfolio/calendar': {
    tag: 'Portfolio',
    summary: 'Get the portfolio dividend and earnings calendar',
    response: portfolioCalendarSchema,
  },
  'GET /v1/portfolio/dividend-income': {
    tag: 'Portfolio',
    summary: 'Get aggregate dividend income',
    response: dividendIncomeSchema,
  },
  'GET /v1/portfolio/holding/:symbol/analyst': {
    tag: 'Portfolio',
    summary: 'Get analyst data for a holding',
    request: getHoldingMarketDataRequestSchema,
    response: z.object({ analyst: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/portfolio/holding/:symbol/valuation': {
    tag: 'Portfolio',
    summary: 'Get a valuation for a holding',
    request: getHoldingMarketDataRequestSchema,
    response: z.object({ valuation: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/portfolio/holding/:financialAssetKey/prices': {
    tag: 'Portfolio',
    summary: 'List a security’s daily prices, with the household’s manual prices',
    request: getAssetPriceHistoryRequestSchema,
    response: assetPriceHistorySchema,
  },
  'GET /v1/portfolio/holding/:financialAssetKey/prices/:date': {
    tag: 'Portfolio',
    summary: 'Get a security’s price on a day, and the household’s manual price for it',
    request: getAssetPriceOverrideRequestSchema,
    response: assetPriceOnDaySchema,
  },
  'GET /v1/portfolio/:portfolioId': {
    tag: 'Portfolio',
    summary: 'Get one portfolio',
    request: getPortfolioRequestSchema,
    response: itemResponse('PortfolioResponse', 'portfolio', portfolioSchema),
  },
  'GET /v1/portfolio/:portfolioId/history-status': {
    tag: 'Portfolio',
    summary: 'Get a portfolio’s history status',
    request: getPortfolioHistoryStatusRequestSchema,
    response: z.object({ status: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/portfolio/:portfolioId/dashboard': {
    tag: 'Portfolio',
    summary: 'Get a portfolio dashboard',
    request: getPortfolioDashboardRequestSchema,
    response: portfolioDashboardSchema,
  },
  'GET /v1/portfolio/:portfolioId/performance': {
    tag: 'Portfolio',
    summary: 'Get a portfolio’s performance',
    request: getPortfolioPerformanceRequestSchema,
    response: performanceSchema,
  },
  'GET /v1/portfolio/:portfolioId/allocation': {
    tag: 'Portfolio',
    summary: 'Get a portfolio’s allocation',
    request: getPortfolioAllocationRequestSchema,
    response: allocationSchema,
  },
  'GET /v1/portfolio/:portfolioId/top-movers': {
    tag: 'Portfolio',
    summary: 'Get a portfolio’s top movers',
    request: getPortfolioTopMoversRequestSchema,
    response: topMoversSchema,
  },
  'GET /v1/portfolio/:portfolioId/transactions': {
    tag: 'Portfolio',
    summary: 'List a portfolio’s transactions',
    request: getPortfolioTransactionRequestSchema,
    response: listResponse('PortfolioTransactionList', 'transactions', portfolioTransactionSchema),
  },
  'GET /v1/portfolio/:portfolioId/holdings': {
    tag: 'Portfolio',
    summary: 'List a portfolio’s holdings',
    request: getPortfolioHoldingsRequestSchema,
    response: listResponse('HoldingList', 'holdings', holdingSchema),
  },
  'GET /v1/portfolio/:portfolioId/holding/:financialAssetKey/lots': {
    tag: 'Portfolio',
    summary: 'List a holding’s lots',
    request: getPortfolioHoldingLotsRequestSchema,
    response: listResponse('HoldingLotList', 'lots', z.record(z.string(), z.unknown())),
  },
  'GET /v1/portfolio/:portfolioId/dividend-income': {
    tag: 'Portfolio',
    summary: 'Get a portfolio’s dividend income',
    request: getPortfolioRequestSchema,
    response: dividendIncomeSchema,
  },

  // ---------------------------------------------------------------------------
  // Import sessions
  // ---------------------------------------------------------------------------
  'GET /v1/portfolio-import-sessions/:importSessionId': {
    tag: 'Import sessions',
    summary: 'Get a portfolio import session preview',
    request: getPortfolioImportSessionPreviewRequestSchema,
    response: importPreviewSchema,
  },
  'GET /v1/transaction-import-sessions/:importId': {
    tag: 'Import sessions',
    summary: 'Get a transaction import session',
    request: getTransactionImportSchema,
    response: importSessionSchema,
  },

  // ---------------------------------------------------------------------------
  // Recurring
  // ---------------------------------------------------------------------------
  'GET /v1/recurring': {
    tag: 'Recurring',
    summary: 'List recurring series',
    request: recurringListSchema,
    response: listResponse('RecurringSeriesList', 'items', recurringSeriesSchema),
  },
  'GET /v1/recurring/summary': {
    tag: 'Recurring',
    summary: 'Get the recurring summary',
    response: z.object({ summary: z.record(z.string(), z.unknown()) }).passthrough(),
  },
  'GET /v1/recurring/occurrences': {
    tag: 'Recurring',
    summary: 'List recurring occurrences',
    request: recurringOccurrencesQuerySchema,
    response: listResponse('RecurringOccurrenceList', 'occurrences', recurringOccurrenceSchema),
  },

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------
  'GET /v1/reports/spending-by-category': {
    tag: 'Reports',
    summary: 'Report spending by category',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/spending-vs-normal': {
    tag: 'Reports',
    summary: 'Compare this month’s spending with its three-month normal',
    description:
      'Returns category spending for one month against the same-days average of the previous three months. ' +
      'The `accountKeys`, `categoryKeys`, and `timezone` filters apply; pending transactions are included, ' +
      'transfers and non-spending categories are excluded, and amounts use the viewer’s currency.',
    request: spendingVsNormalQuerySchema,
    response: z.object({
      completeness: spendingVsNormalCompletenessSchema,
      data: spendingVsNormalDataSchema,
      filters: spendingVsNormalQuerySchema.shape.query,
      generatedAt: z.string(),
    }),
  },
  'GET /v1/reports/spending-by-category.csv': {
    tag: 'Reports',
    summary: 'Export spending by category as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/cashflow': {
    tag: 'Reports',
    summary: 'Report cashflow',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/cashflow.csv': {
    tag: 'Reports',
    summary: 'Export cashflow as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/month-comparison': {
    tag: 'Reports',
    summary: 'Compare two months',
    request: monthComparisonQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/month-comparison.csv': {
    tag: 'Reports',
    summary: 'Export the month comparison as CSV',
    request: monthComparisonQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/sankey': {
    tag: 'Reports',
    summary: 'Report the cashflow Sankey diagram',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/sankey.csv': {
    tag: 'Reports',
    summary: 'Export the Sankey report as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/net-worth-history': {
    tag: 'Reports',
    summary: 'Report net worth history',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/net-worth-history.csv': {
    tag: 'Reports',
    summary: 'Export net worth history as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/budget-vs-actual': {
    tag: 'Reports',
    summary: 'Report budget versus actual',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/budget-vs-actual.csv': {
    tag: 'Reports',
    summary: 'Export budget versus actual as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },
  'GET /v1/reports/portfolio-performance': {
    tag: 'Reports',
    summary: 'Report portfolio performance',
    request: reportsQuerySchema,
    response: reportSchema,
  },
  'GET /v1/reports/portfolio-performance.csv': {
    tag: 'Reports',
    summary: 'Export portfolio performance as CSV',
    request: reportsQuerySchema,
    response: csvFileSchema,
    contentType: 'text/csv',
  },

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  'GET /v1/rule': {
    tag: 'Rules',
    summary: 'List rules',
    response: listResponse('RuleList', 'rules', ruleSchema),
  },
  'GET /v1/rule/export': {
    tag: 'Rules',
    summary: 'Export rules as a portable JSON file',
    response: ruleExportSchema,
  },

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------
  'GET /v1/tag': {
    tag: 'Tags',
    summary: 'List tags',
    response: listResponse('TagList', 'tags', tagSchema),
  },

  // ---------------------------------------------------------------------------
  // Financial markets
  // ---------------------------------------------------------------------------
  'GET /v1/financial-markets/watchlist': {
    tag: 'Financial markets',
    summary: 'Get the watchlist',
    response: watchlistSchema,
  },
  'GET /v1/financial-markets/ticker/search': {
    tag: 'Financial markets',
    summary: 'Search tickers',
    request: searchTickerRequestSchema,
    response: marketSchemas.searchTicker,
  },
  'GET /v1/financial-markets/ticker/:ticker/info': {
    tag: 'Financial markets',
    summary: 'Get company information',
    request: getCompanyInfoRequestSchema,
    response: marketSchemas.companyInformation,
  },
  'GET /v1/financial-markets/ticker/:ticker/historical-price': {
    tag: 'Financial markets',
    summary: 'Get historical prices',
    request: getHistoricalPriceRequestSchema,
    response: marketSchemas.historicalPrice,
  },
  'GET /v1/financial-markets/ticker/:ticker/historical-dividend': {
    tag: 'Financial markets',
    summary: 'Get historical dividends',
    request: getHistoricalDividendRequestSchema,
    response: marketSchemas.historicalDividend,
  },
  'GET /v1/financial-markets/ticker/:ticker/financials': {
    tag: 'Financial markets',
    summary: 'Get financial statements',
    request: getFinancialsRequestSchema,
    response: marketSchemas.financials,
  },
  'GET /v1/financial-markets/ticker/:ticker/earnings': {
    tag: 'Financial markets',
    summary: 'Get earnings',
    request: getEarningsRequestSchema,
    response: marketSchemas.earnings,
  },
  'GET /v1/financial-markets/ticker/:ticker/quote': {
    tag: 'Financial markets',
    summary: 'Get a quote',
    request: getQuoteRequestSchema,
    response: marketSchemas.quote,
  },
  'GET /v1/financial-markets/ticker/:ticker/fundamentals': {
    tag: 'Financial markets',
    summary: 'Get fundamentals',
    request: getFundamentalsRequestSchema,
    response: marketSchemas.fundamentals,
  },
  'GET /v1/financial-markets/ticker/:ticker/news': {
    tag: 'Financial markets',
    summary: 'Get ticker news',
    request: getNewsRequestSchema,
    response: marketSchemas.news,
  },

  // ---------------------------------------------------------------------------
  // Config, currency, assistant
  // ---------------------------------------------------------------------------
  'GET /v1/configs': {
    tag: 'Config',
    summary: 'Get client configuration',
    response: configSchema,
  },
  'GET /v1/currency/rates': {
    tag: 'Currency',
    summary: 'List exchange-rate overrides',
    response: currencyRatesSchema,
  },
  'GET /v1/assistant/consent': {
    tag: 'Assistant',
    summary: 'Get assistant consent',
    response: assistantConsentSchema,
  },
  'GET /v1/assistant/audit-log': {
    tag: 'Assistant',
    summary: 'List assistant audit events',
    request: assistantAuditLogQuerySchema,
    response: listResponse('AssistantAuditEventList', 'events', assistantAuditEventSchema),
  },
};
