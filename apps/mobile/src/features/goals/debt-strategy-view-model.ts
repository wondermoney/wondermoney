import type { DebtStrategyResponseDto, DebtStrategyResultDto } from './goals-contract'

export type DebtStrategyBar = Readonly<{
  id: number
  name: string
  interest: number
  /** 0-100, relative to the largest bar within this plan — drives the proportional bar width. */
  widthPercent: number
}>

export type DebtStrategyPlan = Readonly<{
  months: number
  totalInterest: number
  bars: readonly DebtStrategyBar[]
}>

export type DebtStrategyViewModel =
  | Readonly<{ eligible: false }>
  | Readonly<{
    eligible: true
    avalanche: DebtStrategyPlan
    snowball: DebtStrategyPlan
    /** Positive when avalanche saves interest over snowball, negative the reverse, 0 when tied. */
    interestSaved: number
    cheaper: 'avalanche' | 'snowball' | null
  }>

function mapPlan(strategy: DebtStrategyResultDto, names: Map<number, string>): DebtStrategyPlan {
  const bars = strategy.order.map((id) => {
    const perDebt = strategy.perDebt.find((debt) => debt.id === id)
    return { id, name: names.get(id) ?? `#${id}`, interest: perDebt?.totalInterest ?? 0 }
  })
  const maxInterest = bars.reduce((max, bar) => Math.max(max, bar.interest), 0)
  return {
    months: strategy.months,
    totalInterest: strategy.totalInterest,
    bars: bars.map((bar) => ({ ...bar, widthPercent: maxInterest > 0 ? (bar.interest / maxInterest) * 100 : 0 })),
  }
}

/** Mirrors web's DebtStrategySection.tsx: the comparison is only meaningful with at least two
 * debts, matching the API which returns null strategies (and the section renders nothing) below
 * that threshold. */
export function mapDebtStrategy(data: DebtStrategyResponseDto): DebtStrategyViewModel {
  if (!data.avalanche || !data.snowball || data.debts.length < 2) return { eligible: false }
  const names = new Map(data.debts.map((debt) => [debt.id, debt.name] as const))
  const avalanche = mapPlan(data.avalanche, names)
  const snowball = mapPlan(data.snowball, names)
  const interestSaved = snowball.totalInterest - avalanche.totalInterest
  const cheaper = interestSaved === 0 ? null : interestSaved > 0 ? 'avalanche' as const : 'snowball' as const
  return { eligible: true, avalanche, snowball, interestSaved, cheaper }
}
