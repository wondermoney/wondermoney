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
  /** Switched to "Exclude from aggregate dashboard": listed so it can be opened, outside the totals. */
  excluded?: boolean
  gainPercent: number
  id: number
  name: string
  nativeCurrency: string
  value: number
  /** Share of the household total, percentage points (20.6 = 20.6%). */
  weight?: number
}>

/**
 * The dashboard period's time- and money-weighted returns, percentage points (10 = +10%).
 * A null figure cannot be measured.
 */
export type PeriodReturnsViewModel = Readonly<{
  timeWeighted: number | null
  moneyWeighted: number | null
  /** The money-weighted figure is a yearly rate (periods of a year or more), else over the period. */
  moneyWeightedAnnualized: boolean
  /** Days in the period with no snapshot, whose value was carried over from the day before. */
  missingSnapshotDays: number
}>

type DashboardSummaryDto = AggregateDashboardResponseDto['summary'] | IndividualDashboardResponseDto['summary']

/** The period returns, or undefined when the API did not send them (older servers). */
export function mapPeriodReturns(summary: DashboardSummaryDto): PeriodReturnsViewModel | undefined {
  const returns = summary.periodReturns
  if (!returns) return undefined
  return {
    timeWeighted: returns.timeWeighted,
    moneyWeighted: returns.moneyWeighted,
    moneyWeightedAnnualized: returns.moneyWeightedAnnualized,
    missingSnapshotDays: new Set(returns.missingSnapshotDates).size,
  }
}

/** The five figures web's PortfolioDashboardSummary leads with. */
type SummaryFigures = {
  /** 'YTD', '1M' … — names the period return ("YTD Return"). */
  periodLabel?: string
  /** Absent when the API does not send them; the summary then leaves them out. */
  periodReturns?: PeriodReturnsViewModel
  realizedGains?: number
  unrealizedGains?: number
}

export type PortfolioOverviewViewModel = Readonly<SummaryFigures & {
  assetCount: number
  currency: string
  /** A trade fee could not be converted and was left out of the gains. */
  feesLeftOut?: boolean
  periodReturn: number | null
  /** The portfolios the figures cover: the household's, or the member filter's. */
  portfolioCount: number
  portfolios: readonly PortfolioRowViewModel[]
  /**
   * Whether the household has any portfolio, whoever the member filter names: a member with none
   * sees empty figures, not the first-portfolio prompt. Absent, `portfolioCount` tells.
   */
  householdHasPortfolios?: boolean
  /**
   * The portfolios "Add transaction" offers: every one of the household's, the filtered ones
   * first. Absent, `portfolios`.
   */
  transactionTargets?: readonly Readonly<{ id: number; name: string }>[]
  totalGainLoss: number
  totalGainLossPercent: number
  totalValue: number
}>

/**
 * The tab's figures from the household's portfolio list and the aggregate dashboard. `filtered`:
 * the dashboard was asked for the member filter's portfolios only, so it alone counts them.
 */
export function mapPortfolioOverview(
  list: PortfoliosResponseDto,
  dashboard: AggregateDashboardResponseDto,
  filtered = false,
): PortfolioOverviewViewModel {
  const metadata = new Map(list.portfolios.map((portfolio) => [portfolio.portfolioKey, portfolio]))
  const shown = new Set(dashboard.portfolios.map((portfolio) => portfolio.portfolioKey))
  // Excluded from the aggregate dashboard: in the list and the rows, but in none of the figures.
  const excluded = dashboard.portfolios.filter((portfolio) => portfolio.excluded).length
  return {
    assetCount: dashboard.summary.assetCount,
    currency: dashboard.summary.currency,
    feesLeftOut: Boolean(dashboard.summary.feeConversionIncompleteAssetKeys?.length),
    periodReturn: dashboard.summary.periodReturn,
    // The list is the household's portfolios. Count from it, less the excluded ones, so the figure
    // matches the total even when the server's summary counts only the caller's own portfolios;
    // filtered, the summary counts the member's.
    portfolioCount: filtered ? dashboard.summary.portfolioCount : Math.max(list.portfolios.length - excluded, dashboard.summary.portfolioCount),
    householdHasPortfolios: Math.max(list.portfolios.length, dashboard.summary.portfolioCount) > 0,
    transactionTargets: [
      ...dashboard.portfolios.map((portfolio) => ({ id: portfolio.portfolioKey, name: portfolio.name })),
      ...list.portfolios.filter((portfolio) => !shown.has(portfolio.portfolioKey)).map((portfolio) => ({ id: portfolio.portfolioKey, name: portfolio.name })),
    ],
    portfolios: dashboard.portfolios.map((portfolio) => ({
      brokerName: metadata.get(portfolio.portfolioKey)?.broker?.displayName ?? null,
      currency: portfolio.currency,
      description: metadata.get(portfolio.portfolioKey)?.description ?? null,
      ...(portfolio.excluded ? { excluded: true } : {}),
      gainPercent: portfolio.gainPercent,
      id: portfolio.portfolioKey,
      name: portfolio.name,
      nativeCurrency: metadata.get(portfolio.portfolioKey)?.currencyKey.code ?? portfolio.currency,
      value: portfolio.value,
      weight: portfolio.weight,
    })),
    periodLabel: dashboard.summary.periodLabel,
    periodReturns: mapPeriodReturns(dashboard.summary),
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
    periodReturns: mapPeriodReturns(dashboard.summary),
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
