import type { PortfolioPerformancePoint, PortfolioPerformanceResponseDto } from './portfolios-contract'

export type PortfolioPerformanceChartPoint = Readonly<{ x: number; value: number }>

export type PortfolioPerformanceViewModel = Readonly<{
  points: readonly PortfolioPerformanceChartPoint[]
  totalReturnPercent: number | null
  startDate: string | null
  endDate: string | null
  historyStatus: 'empty' | 'insufficient_history' | 'ready'
}>

function toChartPoints(points: readonly PortfolioPerformancePoint[]): PortfolioPerformanceChartPoint[] {
  return points.map((point, index) => ({ x: index, value: point.value }))
}

export function mapPortfolioPerformance(response: PortfolioPerformanceResponseDto): PortfolioPerformanceViewModel {
  const raw = response.dataPoints
  const normalized = response.normalizedDataPoints
  return {
    points: toChartPoints(raw),
    totalReturnPercent: normalized && normalized.length > 0 ? normalized[normalized.length - 1]!.value : null,
    startDate: raw.length > 0 ? raw[0]!.date : null,
    endDate: raw.length > 0 ? raw[raw.length - 1]!.date : null,
    historyStatus: response.portfolioHistoryStatus ?? (raw.length > 0 ? 'ready' : 'empty'),
  }
}
