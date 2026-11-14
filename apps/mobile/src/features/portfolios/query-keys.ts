export const portfoliosKey = (epochId: number) => ['portfolios', epochId] as const
export const portfolioCurrenciesKey = (epochId: number) => ['portfolio-create', epochId, 'currencies'] as const
export const portfolioTransactionTypesKey = (epochId: number) => ['portfolio-transaction-create', epochId, 'transaction-types'] as const
export const portfolioCreateUnknownKey = (epochId: number) => ['portfolio-create', epochId, 'unknown-outcome'] as const
export const portfolioSettingsUnknownKey = (epochId: number, portfolioId: number) => ['portfolio-settings', epochId, portfolioId, 'unknown-outcome'] as const
/**
 * The Portfolios tab's member filter (a member's key or `shared`) is the last entry of an
 * aggregate read's key, so invalidating the read refreshes every member's.
 */
const memberTail = (member?: string) => (member === undefined ? [] as const : [member] as const)

export const aggregatePortfolioDashboardKey = (epochId: number, period: string = 'YTD', member?: string) => (
  ['portfolio-dashboard', epochId, 'aggregate', period, ...memberTail(member)] as const
)
/** Every period of the aggregate dashboard, for invalidation. */
export const aggregatePortfolioDashboardPrefix = (epochId: number) => (
  ['portfolio-dashboard', epochId, 'aggregate'] as const
)
export const aggregatePortfolioHoldingsKey = (epochId: number, member?: string) => (
  ['portfolio-holdings', epochId, 'aggregate', ...memberTail(member)] as const
)
export const portfolioAllocationKey = (epochId: number, portfolioId: number) => (
  ['portfolio-analytics', epochId, portfolioId, 'allocation'] as const
)
export const portfolioTopMoversKey = (epochId: number, portfolioId: number | 'aggregate', period: string, member?: string) => (
  ['portfolio-top-movers', epochId, portfolioId, period, 5, ...memberTail(member)] as const
)
export const portfolioKey = (epochId: number, portfolioId: number) => (
  ['portfolio', epochId, portfolioId] as const
)
export const portfolioDashboardKey = (epochId: number, portfolioId: number) => (
  ['portfolio-dashboard', epochId, portfolioId, 'YTD'] as const
)
export const portfolioHoldingsKey = (epochId: number, portfolioId: number) => (
  ['portfolio-holdings', epochId, portfolioId] as const
)
export const portfolioActivityKey = (epochId: number, portfolioId: number | 'aggregate', fromDate?: string, toDate?: string) => (
  ['portfolio-activity', epochId, portfolioId, fromDate ?? null, toDate ?? null, 50] as const
)
export const portfolioAnalyticsKey = (epochId: number, resource: 'allocation' | 'dividends' | 'metrics', member?: string) => (
  ['portfolio-analytics', epochId, resource, ...memberTail(member)] as const
)
export const portfolioDividendIncomeKey = (epochId: number, portfolioId: number) => (
  ['portfolio-analytics', epochId, portfolioId, 'dividend-income'] as const
)
export const portfolioPerformancePrefix = (epochId: number, portfolioId: number | 'aggregate') => ['portfolio-performance', epochId, portfolioId] as const
export const portfolioPerformanceKey = (epochId: number, portfolioId: number | 'aggregate', period: string, member?: string) => (
  [...portfolioPerformancePrefix(epochId, portfolioId), period, ...memberTail(member)] as const
)

const PORTFOLIO_CONTENT_QUERY_TAGS = new Set([
  'portfolios', 'portfolio', 'portfolio-dashboard', 'portfolio-holdings', 'portfolio-activity', 'portfolio-analytics', 'portfolio-performance', 'portfolio-top-movers',
])

/** Everything a transaction write can affect: quantities/values ripple through holdings, activity,
 * detail, dashboards, and analytics. Deliberately excludes the create/settings unknown-outcome
 * guard keys, which are reconciliation flags, not content. */
export const isPortfolioContentQueryForEpoch = (queryKey: readonly unknown[], epochId: number): boolean => (
  typeof queryKey[0] === 'string' && PORTFOLIO_CONTENT_QUERY_TAGS.has(queryKey[0]) && queryKey[1] === epochId
)
