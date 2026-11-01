import type {
  PortfolioActivityItemDto,
  PortfolioAllocationDto,
  PortfolioDividendIncomeDto,
  PortfolioMetricsDto,
} from './portfolios-contract'

export type PortfolioActivityRow = Readonly<{
  amount: number | null
  currency: string | null
  id: string
  itemType: 'STOCK_SPLIT' | 'TRANSACTION'
  name: string | null
  notes: string | null
  portfolioId: number | null
  portfolioName: string | null
  quantity: number | null
  split: Readonly<{ denominator: number | null; numerator: number | null; ratio: number | null }> | null
  ticker: string | null
  timestamp: string | null
  transactionKey: number | null
  type: string | null
  unitPrice: number | null
}>

const decimal = (value: number | null | undefined): number | null => value ?? null

/** Web's holding drill-down filters the same activity feed by ticker client-side rather than
 * calling a dedicated per-asset endpoint (none exists); this mirrors that. */
export function filterPortfolioActivityByTicker(rows: readonly PortfolioActivityRow[], ticker: string): PortfolioActivityRow[] {
  return rows.filter((row) => row.ticker === ticker)
}

export function mapPortfolioActivity(items: readonly PortfolioActivityItemDto[]): PortfolioActivityRow[] {
  return items.map((item, index) => {
    if (item.itemType === 'STOCK_SPLIT') return {
      amount: null,
      currency: null,
      id: item.id,
      itemType: item.itemType,
      name: item.financialAssetKey.name ?? null,
      notes: null,
      portfolioId: item.portfolioKey.portfolioKey ?? null,
      portfolioName: item.portfolioKey.name ?? null,
      quantity: null,
      split: { denominator: item.denominator ?? null, numerator: item.numerator ?? null, ratio: item.splitRatio ?? null },
      ticker: item.financialAssetKey.symbol ?? null,
      timestamp: item.transactionDate,
      transactionKey: null,
      type: 'STOCK_SPLIT',
      unitPrice: null,
    }
    const transactionId = item.transactionKey == null ? `transaction:${item.transactionDate ?? 'unknown'}:${index}` : `transaction:${item.transactionKey}`
    return {
      amount: decimal(item.settlementAmount),
      currency: item.settlementCurrencyKey?.code ?? null,
      id: transactionId,
      itemType: 'TRANSACTION',
      name: item.financialAssetKey?.name ?? null,
      notes: item.notes ?? null,
      portfolioId: item.portfolioKey?.portfolioKey ?? null,
      portfolioName: item.portfolioKey?.name ?? null,
      quantity: decimal(item.quantity),
      split: null,
      ticker: item.financialAssetKey?.symbol ?? null,
      timestamp: item.transactionDate ?? null,
      transactionKey: item.transactionKey ?? null,
      type: item.financialTransactionTypeKey?.name ?? null,
      unitPrice: decimal(item.settlementUnitAmount),
    }
  })
}

export type PortfolioAnalyticsViewModel = Readonly<{
  allocation: readonly Readonly<{ percentage: number; type: string; value: number }>[]
  currency: string | null
  dividends: readonly Readonly<{ symbol: string; value: number }>[]
  risk: Readonly<{
    level: 'High' | 'Low' | 'Medium' | null
    maxDrawdown: number | null
    readiness: 'insufficient_history' | 'ready'
    sharpeRatio: number | null
    volatility: number | null
  }>
  totalDividends: number
}>

export type PortfolioDividendIncomeViewModel = Pick<PortfolioAnalyticsViewModel, 'currency' | 'dividends' | 'totalDividends'>

/** Shared by both the aggregate analytics panel and the per-portfolio detail screen —
 * same dividend-income response shape, just scoped to a different endpoint. */
export function mapPortfolioDividendIncome(
  dividends: PortfolioDividendIncomeDto,
  reportingCurrency: string | null,
): PortfolioDividendIncomeViewModel {
  const currency = reportingCurrency !== null && /^[A-Z]{3}$/.test(reportingCurrency) ? reportingCurrency : null
  return {
    currency,
    dividends: dividends.byAsset.map((item) => ({ symbol: item.symbol, value: item.totalDividends })),
    totalDividends: dividends.totalDividends,
  }
}

export function mapPortfolioAnalytics(
  allocation: PortfolioAllocationDto,
  dividends: PortfolioDividendIncomeDto,
  metrics: PortfolioMetricsDto,
  reportingCurrency: string | null,
): PortfolioAnalyticsViewModel {
  return {
    allocation: allocation.byType,
    ...mapPortfolioDividendIncome(dividends, reportingCurrency),
    risk: {
      level: metrics.metrics.riskLevel,
      maxDrawdown: metrics.metrics.maxDrawdown,
      readiness: metrics.metrics.readiness.riskMetrics.status,
      sharpeRatio: metrics.metrics.sharpeRatio,
      volatility: metrics.metrics.volatility,
    },
  }
}
