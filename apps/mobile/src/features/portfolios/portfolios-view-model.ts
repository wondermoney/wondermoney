import type {
  AggregateDashboardResponseDto,
  IndividualDashboardResponseDto,
  PortfolioHoldingsResponseDto,
  PortfolioResponseDto,
  PortfoliosResponseDto,
} from './portfolios-contract'

export type PortfolioRowViewModel = Readonly<{
  /** Display name of the broker it was imported from, for its mark. */
  brokerName?: string | null
  currency: string
  description: string | null
  gainPercent: number
  id: number
  name: string
  nativeCurrency: string
  value: number
  /** Share of the household total, percentage points (20.6 = 20.6%). */
  weight?: number
}>

/** The five figures web's PortfolioDashboardSummary leads with. */
type SummaryFigures = {
  /** 'YTD', '1M' … — names the period return ("YTD Return"). */
  periodLabel?: string
  realizedGains?: number
  unrealizedGains?: number
}

export type PortfolioOverviewViewModel = Readonly<SummaryFigures & {
  assetCount: number
  currency: string
  /** A trade fee could not be converted and was left out of the gains. */
  feesLeftOut?: boolean
  periodReturn: number | null
  portfolioCount: number
  portfolios: readonly PortfolioRowViewModel[]
  totalGainLoss: number
  totalGainLossPercent: number
  totalValue: number
}>

export function mapPortfolioOverview(
  list: PortfoliosResponseDto,
  dashboard: AggregateDashboardResponseDto,
): PortfolioOverviewViewModel {
  const metadata = new Map(list.portfolios.map((portfolio) => [portfolio.portfolioKey, portfolio]))
  return {
    assetCount: dashboard.summary.assetCount,
    currency: dashboard.summary.currency,
    feesLeftOut: Boolean(dashboard.summary.feeConversionIncompleteAssetKeys?.length),
    periodReturn: dashboard.summary.periodReturn,
    // The list is the household's portfolios. Count from it, so the figure matches the rows and
    // the total even when the server's summary counts only the caller's own portfolios.
    portfolioCount: Math.max(list.portfolios.length, dashboard.summary.portfolioCount),
    portfolios: dashboard.portfolios.map((portfolio) => ({
      brokerName: metadata.get(portfolio.portfolioKey)?.broker?.displayName ?? null,
      currency: portfolio.currency,
      description: metadata.get(portfolio.portfolioKey)?.description ?? null,
      gainPercent: portfolio.gainPercent,
      id: portfolio.portfolioKey,
      name: portfolio.name,
      nativeCurrency: metadata.get(portfolio.portfolioKey)?.currencyKey.code ?? portfolio.currency,
      value: portfolio.value,
      weight: portfolio.weight,
    })),
    periodLabel: dashboard.summary.periodLabel,
    realizedGains: dashboard.summary.realizedGains,
    unrealizedGains: dashboard.summary.unrealizedGains,
    totalGainLoss: dashboard.summary.totalGainLoss,
    totalGainLossPercent: dashboard.summary.totalGainLossPercent,
    totalValue: dashboard.summary.totalValue,
  }
}

export type HoldingViewModel = Readonly<{
  allocation: number | null
  averageBuyPrice: number | null
  currency: string
  currentPrice: number | null
  currentValue: number | null
  /** A fee on this asset could not be converted and was left out of its cost and gain. */
  feeConversionIncomplete?: boolean
  gain: number | null
  gainPercent: number | null
  id: number
  isInvalid: boolean
  name: string
  /** Set on the household-wide list, where a row opens its own portfolio's holding. */
  portfolioId?: number | null
  quantity: number
  /** Lifetime realized gain of the asset's sales; null when unknown (invalid holding, older API). */
  realizedGain?: number | null
  symbol: string
  type: string
  /** The asset's logo, its mark; letters stand in without one. */
  logoUrl?: string | null
}>

export type PortfolioDetailViewModel = Readonly<SummaryFigures & {
  worstPerformer?: { change: number; ticker: string } | null
  assetCount: number
  bestPerformer: { change: number; ticker: string } | null
  biggestPosition: { ticker: string; weight: number } | null
  currency: string
  description: string | null
  feesLeftOut?: boolean
  holdings: readonly HoldingViewModel[]
  holdingsCount: number
  id: number
  name: string
  nativeCurrency: string
  periodReturn: number | null
  totalGainLoss: number
  totalGainLossPercent: number
  totalValue: number
}>

export function mapPortfolioDetail(
  metadata: PortfolioResponseDto,
  dashboard: IndividualDashboardResponseDto,
  holdings: PortfolioHoldingsResponseDto,
): PortfolioDetailViewModel {
  return {
    assetCount: dashboard.summary.assetCount,
    bestPerformer: dashboard.quickStats.bestPerformer,
    biggestPosition: dashboard.quickStats.biggestPosition,
    currency: dashboard.summary.currency,
    description: metadata.portfolio.description ?? null,
    feesLeftOut: Boolean(dashboard.summary.feeConversionIncompleteAssetKeys?.length),
    holdings: mapHoldings(holdings),
    holdingsCount: dashboard.quickStats.holdingsCount,
    id: metadata.portfolio.portfolioKey,
    name: metadata.portfolio.name,
    nativeCurrency: metadata.portfolio.currencyKey.code,
    periodLabel: dashboard.summary.periodLabel,
    periodReturn: dashboard.summary.periodReturn,
    realizedGains: dashboard.summary.realizedGains,
    totalGainLoss: dashboard.summary.totalGainLoss,
    totalGainLossPercent: dashboard.summary.totalGainLossPercent,
    totalValue: dashboard.summary.totalValue,
    unrealizedGains: dashboard.summary.unrealizedGains,
    worstPerformer: dashboard.quickStats.worstPerformer,
  }
}

/** Holdings as rows. An invalid holding keeps its identity but none of its valuations. */
export function mapHoldings(holdings: PortfolioHoldingsResponseDto): HoldingViewModel[] {
  return holdings.holdings.map((holding) => {
    const invalid = holding.isInvalid === true
    return {
      allocation: invalid ? null : holding.allocation,
      averageBuyPrice: invalid ? null : holding.averageBuyPrice,
      currency: holding.currency,
      currentPrice: invalid ? null : holding.currentPrice,
      currentValue: invalid ? null : holding.currentValue,
      feeConversionIncomplete: holding.feeConversionIncomplete === true,
      gain: invalid ? null : holding.unrealizedGains,
      gainPercent: invalid ? null : holding.unrealizedGainsPercentage,
      id: holding.financialAssetKey,
      isInvalid: invalid,
      name: holding.financialAssetName,
      portfolioId: holding.portfolioKey ?? null,
      quantity: holding.quantity,
      realizedGain: invalid ? null : holding.realizedGains ?? null,
      symbol: holding.financialAssetSymbol,
      type: holding.financialAssetType,
      logoUrl: holding.financialAssetLogoUrl ?? null,
    }
  })
}
