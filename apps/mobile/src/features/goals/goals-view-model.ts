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
}>

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
  }
}

export const mapGoals = (response: { goals: GoalListItemDto[] }): GoalListItemViewModel[] => (
  response.goals.map(mapGoalListItem)
)
