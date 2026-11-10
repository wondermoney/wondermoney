import type { GoalListItemDto } from './goals-contract'

export type GoalEffectiveStatus =
  | 'on-track'
  | 'behind'
  | 'funded'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'progress-unavailable'
  | 'unknown'

export type GoalListItemViewModel = Readonly<{
  goalId: number
  name: string
  currencyCode: string
  effectiveStatus: GoalEffectiveStatus
  availableAmount: number
  targetAmount: number
  remainingToTarget: number
  assignedThisMonth: number
  spentAmount: number
  linkedAccounts: readonly Readonly<{ accountId: number; name: string | null }>[]
  monthlyContributionTarget: number | null
  targetDate: string | null
  progressAvailable: boolean
  progressPercentage: number
  meterPercentage: number
  overTarget: boolean
  /** The goal's own lifecycle status, which web's status chip shows ("Active"). */
  lifecycleStatus: GoalListItemDto['status']
  /** Web's `goal.type === 'debt_paydown'`: a "Pay off debt" chip, the debt balance as the figure. */
  isDebt: boolean
  /** Web's `goalProgress`: the API's progress percentage, clamped 0..100; null when unknowable. */
  displayProgress: number | null
  fundedHistorically: number
  /** The outstanding debt on a debt goal (projection, then the goal's own balance). */
  debtBalance: number | null
  /** The payoff projection on a debt goal, or null when the API sent none. */
  payoff: Readonly<{ paysOff: boolean; payoffDate: string | null }> | null
}>

/** Web's `lib/goals/progress.ts`: the API figure, else available ÷ target, clamped. */
export function goalDisplayProgress(targetAmount: number, summary: { progressPercentage?: number | null; availableAmount?: number | null }): number | null {
  const clamp = (value: number) => Math.max(0, Math.min(100, value))
  if (typeof summary.progressPercentage === 'number' && Number.isFinite(summary.progressPercentage)) return clamp(summary.progressPercentage)
  if (typeof summary.availableAmount !== 'number' || !(targetAmount > 0)) return null
  return clamp((summary.availableAmount / targetAmount) * 100)
}

export function mapGoalListItem(dto: GoalListItemDto): GoalListItemViewModel {
  const progressAvailable = dto.targetAmount > 0
  const actualProgressPercentage = progressAvailable
    ? (dto.summary.availableAmount / dto.targetAmount) * 100
    : 0
  const summaryStatus = dto.summary.status === 'on_track' ? 'on-track' : dto.summary.status
  const effectiveStatus: GoalEffectiveStatus = dto.status !== 'active'
    ? dto.status
    : progressAvailable
      ? summaryStatus
      : 'progress-unavailable'

  return {
    goalId: dto.goalKey,
    name: dto.name,
    currencyCode: dto.currencyCode,
    effectiveStatus,
    availableAmount: dto.summary.availableAmount,
    targetAmount: dto.targetAmount,
    remainingToTarget: Math.max(dto.targetAmount - dto.summary.availableAmount, 0),
    assignedThisMonth: dto.summary.assignedThisMonth,
    spentAmount: dto.summary.spentAmount,
    linkedAccounts: dto.accountLinks.map((link) => ({
      accountId: link.accountKey.accountKey,
      name: link.accountKey.accountName,
    })),
    monthlyContributionTarget: dto.monthlyContributionTarget,
    targetDate: dto.targetDate,
    progressAvailable,
    progressPercentage: actualProgressPercentage,
    meterPercentage: progressAvailable
      ? Math.min(100, Math.max(0, actualProgressPercentage))
      : 0,
    overTarget: progressAvailable && dto.summary.availableAmount > dto.targetAmount,
    lifecycleStatus: dto.status,
    isDebt: dto.type === 'debt_paydown',
    displayProgress: goalDisplayProgress(dto.targetAmount, dto.summary),
    fundedHistorically: dto.summary.fundedHistorically,
    debtBalance: dto.summary.debtProjection?.currentBalance ?? dto.currentBalance ?? null,
    payoff: dto.summary.debtProjection
      ? { paysOff: dto.summary.debtProjection.paysOff, payoffDate: dto.summary.debtProjection.payoffDate }
      : null,
  }
}

export const mapGoals = (response: { goals: GoalListItemDto[] }): GoalListItemViewModel[] => (
  response.goals.map(mapGoalListItem)
)
