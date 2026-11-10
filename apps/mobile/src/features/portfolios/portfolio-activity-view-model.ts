import type { AmountsCompleteness } from '@/lib/api/completeness'

import type {
  PortfolioActivityItemDto,
  PortfolioAllocationDto,
  PortfolioDividendIncomeDto,
  PortfolioMetricsDto,
} from './portfolios-contract'

export type PortfolioActivityRow = Readonly<{
  amount: number | null
  /** Set when the row is a cash movement (the API books cash as a `CURRENCY_EUR` asset). */
  cashCurrency: string | null
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
  /** The asset's logo for the row's mark. */
  logoUrl?: string | null
  timestamp: string | null
  transactionKey: number | null
  /** The API's type key (`BUY`, `DEPOSIT`); translate it, falling back to `typeLabel`. */
  type: string | null
  /** The key in sentence case (`Buy`, `Stock split`), never shouting. */
  typeLabel: string | null
  unitPrice: number | null
}>

const CASH_ASSET = /^CURRENCY_([A-Z]{3})$/

/** `DEPOSIT` → `Deposit`, `STOCK_SPLIT` → `Stock split`. Uppercase labels are banned (DESIGN.md). */
export function sentenceCaseKey(key: string): string {
  const words = key.trim().replace(/_+/g, ' ').toLocaleLowerCase()
  return words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

/** The currency of a cash asset (`CURRENCY_EUR` → `EUR`), or `null` for a security. */
export function cashAssetCurrency(symbol: string | null | undefined): string | null {
  return symbol ? CASH_ASSET.exec(symbol)?.[1] ?? null : null
}

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
      cashCurrency: null,
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
      logoUrl: item.financialAssetKey.logoUrl ?? null,
      timestamp: item.transactionDate,
      transactionKey: null,
      type: 'STOCK_SPLIT',
      typeLabel: sentenceCaseKey('STOCK_SPLIT'),
      unitPrice: null,
    }
    const transactionId = item.transactionKey == null ? `transaction:${item.transactionDate ?? 'unknown'}:${index}` : `transaction:${item.transactionKey}`
    const cashCurrency = cashAssetCurrency(item.financialAssetKey?.symbol)
    const type = item.financialTransactionTypeKey?.name?.trim().toUpperCase() || null
    return {
      amount: decimal(item.settlementAmount),
      cashCurrency,
      currency: item.settlementCurrencyKey?.code ?? null,
      id: transactionId,
      itemType: 'TRANSACTION',
      // A cash asset's "name" is just its currency code and its symbol a raw key: neither is
      // a name, so the row is labelled from `cashCurrency` instead.
      name: cashCurrency ? null : item.financialAssetKey?.name ?? null,
      notes: item.notes ?? null,
      portfolioId: item.portfolioKey?.portfolioKey ?? null,
      portfolioName: item.portfolioKey?.name ?? null,
      quantity: decimal(item.quantity),
      split: null,
      ticker: cashCurrency ? null : item.financialAssetKey?.symbol ?? null,
      logoUrl: cashCurrency ? null : item.financialAssetKey?.logoUrl ?? null,
      timestamp: item.transactionDate ?? null,
      transactionKey: item.transactionKey ?? null,
      type,
      typeLabel: type ? sentenceCaseKey(type) : null,
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

export type PortfolioDividendIncomeViewModel = Pick<PortfolioAnalyticsViewModel, 'currency' | 'dividends' | 'totalDividends'> & Readonly<{
  /** Dividends left out of the totals for want of an exchange rate. */
  completeness?: AmountsCompleteness
}>

/** Shared by both the aggregate analytics panel and the per-portfolio detail screen —
 * same dividend-income response shape, just scoped to a different endpoint. */
export function mapPortfolioDividendIncome(
  dividends: PortfolioDividendIncomeDto,
  reportingCurrency: string | null,
): PortfolioDividendIncomeViewModel {
  // The totals are in the currency the API names, as on web; the reporting currency is the fallback.
  const named = dividends.completeness?.currencyCode ?? reportingCurrency
  const currency = named !== null && /^[A-Z]{3}$/.test(named) ? named : null
  return {
    currency,
    dividends: dividends.byAsset.map((item) => ({ symbol: item.symbol, value: item.totalDividends })),
    totalDividends: dividends.totalDividends,
    ...(dividends.completeness ? { completeness: dividends.completeness } : {}),
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
