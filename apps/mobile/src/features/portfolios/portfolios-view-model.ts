import type {
  AggregateDashboardResponseDto,
  IndividualDashboardResponseDto,
  PortfolioHoldingsResponseDto,
  PortfolioResponseDto,
  PortfoliosResponseDto,
} from './portfolios-contract'

export type PortfolioRowViewModel = Readonly<{
  currency: string
  description: string | null
  gainPercent: number
  id: number
  name: string
  nativeCurrency: string
  value: number
}>

export type PortfolioOverviewViewModel = Readonly<{
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
    portfolioCount: dashboard.summary.portfolioCount,
    portfolios: dashboard.portfolios.map((portfolio) => ({
      currency: portfolio.currency,
      description: metadata.get(portfolio.portfolioKey)?.description ?? null,
      gainPercent: portfolio.gainPercent,
      id: portfolio.portfolioKey,
      name: portfolio.name,
      nativeCurrency: metadata.get(portfolio.portfolioKey)?.currencyKey.code ?? portfolio.currency,
      value: portfolio.value,
    })),
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
  quantity: number
  symbol: string
  type: string
}>

export type PortfolioDetailViewModel = Readonly<{
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
    holdings: holdings.holdings.map((holding) => {
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
        quantity: holding.quantity,
        symbol: holding.financialAssetSymbol,
        type: holding.financialAssetType,
      }
    }),
    holdingsCount: dashboard.quickStats.holdingsCount,
    id: metadata.portfolio.portfolioKey,
    name: metadata.portfolio.name,
    nativeCurrency: metadata.portfolio.currencyKey.code,
    periodReturn: dashboard.summary.periodReturn,
    totalGainLoss: dashboard.summary.totalGainLoss,
    totalGainLossPercent: dashboard.summary.totalGainLossPercent,
    totalValue: dashboard.summary.totalValue,
  }
}
