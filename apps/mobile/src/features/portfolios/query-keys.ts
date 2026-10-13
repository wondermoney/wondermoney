export const portfoliosKey = (epochId: number) => ['portfolios', epochId] as const
export const portfolioCurrenciesKey = (epochId: number) => ['portfolio-create', epochId, 'currencies'] as const
export const portfolioTransactionTypesKey = (epochId: number) => ['portfolio-transaction-create', epochId, 'transaction-types'] as const
export const portfolioCreateUnknownKey = (epochId: number) => ['portfolio-create', epochId, 'unknown-outcome'] as const
export const portfolioSettingsUnknownKey = (epochId: number, portfolioId: number) => ['portfolio-settings', epochId, portfolioId, 'unknown-outcome'] as const
export const aggregatePortfolioDashboardKey = (epochId: number) => (
  ['portfolio-dashboard', epochId, 'aggregate', 'YTD'] as const
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
export const portfolioAnalyticsKey = (epochId: number, resource: 'allocation' | 'dividends' | 'metrics') => (
  ['portfolio-analytics', epochId, resource] as const
)
export const portfolioDividendIncomeKey = (epochId: number, portfolioId: number) => (
  ['portfolio-analytics', epochId, portfolioId, 'dividend-income'] as const
)
export const portfolioPerformanceKey = (epochId: number, portfolioId: number, period: string) => (
  ['portfolio-performance', epochId, portfolioId, period] as const
)

const PORTFOLIO_CONTENT_QUERY_TAGS = new Set([
  'portfolios', 'portfolio', 'portfolio-dashboard', 'portfolio-holdings', 'portfolio-activity', 'portfolio-analytics', 'portfolio-performance',
])

/** Everything a transaction write can affect: quantities/values ripple through holdings, activity,
 * detail, dashboards, and analytics. Deliberately excludes the create/settings unknown-outcome
 * guard keys, which are reconciliation flags, not content. */
export const isPortfolioContentQueryForEpoch = (queryKey: readonly unknown[], epochId: number): boolean => (
  typeof queryKey[0] === 'string' && PORTFOLIO_CONTENT_QUERY_TAGS.has(queryKey[0]) && queryKey[1] === epochId
)
