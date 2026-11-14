import type { PortfolioPerformanceResponseDto, PortfolioPerformanceValuePoint } from './portfolios-contract'

export type PortfolioPerformanceChartPoint = Readonly<{
  x: number
  value: number
  /** The value again on a day money went in or out, where the chart draws its marker; null otherwise. */
  flow: number | null
}>

/** A day with a buy or sale: money put in, taken out, or a trade with no amount in the viewer's currency. */
export type PortfolioPerformanceFlow = Readonly<{
  date: string
  kind: 'deposit' | 'withdrawal' | 'unknown'
  /** Unsigned; null when the amount is unknown. */
  amount: number | null
}>

export type PortfolioPerformanceViewModel = Readonly<{
  points: readonly PortfolioPerformanceChartPoint[]
  /** The time-weighted return over the history, % since the first day; null when it was not measured. */
  totalReturnPercent: number | null
  /** The last day the return was measured; earlier than `endDate` when the latest days were not. */
  returnEndDate: string | null
  startDate: string | null
  endDate: string | null
  historyStatus: 'empty' | 'insufficient_history' | 'ready'
  /** Days money went in or out, oldest first. */
  flows: readonly PortfolioPerformanceFlow[]
  /** Some days left out a portfolio the API could not convert into the viewer's currency. */
  currencyIncomplete?: boolean
  /** The currency the history is valued in, when the API says (newer servers do). */
  currencyCode?: string | null
}>

function flowOf(point: PortfolioPerformanceValuePoint): PortfolioPerformanceFlow | null {
  const amount = point.netContribution
  // Absent: no trade that day. Zero: what was bought and sold cancelled out, so no money moved.
  if (amount === undefined || amount === 0) return null
  if (amount === null) return { date: point.date, kind: 'unknown', amount: null }
  return { date: point.date, kind: amount > 0 ? 'deposit' : 'withdrawal', amount: Math.abs(amount) }
}

/**
 * The value series drives the chart, one point per day. The return comes from the time-weighted
 * series, which can skip days it could not measure, so it is read by date and never by position:
 * its last point is the return as of that point's own day.
 */
export function mapPortfolioPerformance(response: PortfolioPerformanceResponseDto): PortfolioPerformanceViewModel {
  const raw = response.dataPoints
  const valueDates = new Set(raw.map((point) => point.date))
  const measured = (response.normalizedDataPoints ?? []).filter((point) => valueDates.has(point.date))
  const lastReturn = measured.reduce<(typeof measured)[number] | null>((latest, point) => (latest === null || point.date > latest.date ? point : latest), null)
  const flows: PortfolioPerformanceFlow[] = []
  const points = raw.map((point, index) => {
    const flow = flowOf(point)
    if (flow) flows.push(flow)
    return { x: index, value: point.value, flow: flow ? point.value : null }
  })
  return {
    points,
    totalReturnPercent: lastReturn?.value ?? null,
    returnEndDate: lastReturn?.date ?? null,
    startDate: raw.length > 0 ? raw[0]!.date : null,
    endDate: raw.length > 0 ? raw[raw.length - 1]!.date : null,
    historyStatus: response.portfolioHistoryStatus ?? (raw.length > 0 ? 'ready' : 'empty'),
    flows,
    currencyIncomplete: response.completeness?.isComplete === false,
    currencyCode: response.completeness?.currencyCode ?? null,
  }
}
