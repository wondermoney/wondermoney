import type { GoalActivityDto, GoalDetailResponseDto, GoalMetadataWrite } from './goals-contract'
import type { GoalEffectiveStatus } from './goals-view-model'

export type GoalActivityViewModel = Readonly<{
  id: number
  type: GoalActivityDto['type']
  amount: number | null
  currencyCode: string
  occurredAt: string
  note: string | null
}>

export type GoalDetailViewModel = Readonly<{
  id: number
  name: string
  lifecycleStatus: GoalDetailResponseDto['goal']['status']
  status: GoalEffectiveStatus
  currencyCode: string
  targetDate: string | null
  availableAmount: number
  targetAmount: number
  monthlyContributionTarget: number | null
  progressAvailable: boolean
  progressPercentage: number
  meterPercentage: number
  overTarget: boolean
  remainingToTarget: number
  assignedThisMonth: number
  requiredMonthlyContribution: number | null
  monthlyShortfall: number | null
  spentAmount: number
  linkedAccounts: readonly { accountId: number; name: string | null }[]
  editable: boolean
}>

export function mapGoalDetail(response: GoalDetailResponseDto): GoalDetailViewModel {
  const { goal, summary } = response
  const progressAvailable = goal.targetAmount > 0
  const progressPercentage = progressAvailable ? (summary.availableAmount / goal.targetAmount) * 100 : 0
  const summaryStatus = summary.status === 'on_track' ? 'on-track' : summary.status
  return {
    id: goal.goalKey,
    name: goal.name,
    lifecycleStatus: goal.status,
    status: goal.status === 'active'
      ? (progressAvailable ? summaryStatus : 'progress-unavailable')
      : goal.status,
    currencyCode: goal.currencyCode,
    targetDate: goal.targetDate,
    availableAmount: summary.availableAmount,
    targetAmount: goal.targetAmount,
    monthlyContributionTarget: goal.monthlyContributionTarget ?? null,
    progressAvailable,
    progressPercentage,
    meterPercentage: progressAvailable ? Math.min(100, Math.max(0, progressPercentage)) : 0,
    overTarget: progressAvailable && summary.availableAmount > goal.targetAmount,
    remainingToTarget: summary.remainingToTarget,
    assignedThisMonth: summary.assignedThisMonth,
    requiredMonthlyContribution: summary.requiredMonthlyContribution,
    monthlyShortfall: summary.monthlyShortfall,
    spentAmount: summary.spentAmount,
    linkedAccounts: goal.accountLinks.map((link) => ({ accountId: link.accountKey.accountKey, name: link.accountKey.accountName })),
    editable: goal.status === 'active' || goal.status === 'paused',
  }
}

export function buildGoalMetadataChanges(
  authoritative: Pick<GoalDetailViewModel, 'name' | 'targetAmount' | 'monthlyContributionTarget'>,
  candidate: { name: string; targetAmount: number; monthlyContributionTarget: number | null },
): GoalMetadataWrite | null {
  const changes: GoalMetadataWrite = {}
  const name = candidate.name.trim()
  if (name !== authoritative.name.trim()) changes.name = name
  if (candidate.targetAmount !== authoritative.targetAmount) changes.targetAmount = candidate.targetAmount
  if (candidate.monthlyContributionTarget !== authoritative.monthlyContributionTarget) {
    changes.monthlyContributionTarget = candidate.monthlyContributionTarget
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export function mapGoalActivities(
  activities: readonly GoalActivityDto[],
  fallbackCurrencyCode: string,
): GoalActivityViewModel[] {
  return activities.map((activity) => ({
    id: activity.goalActivityKey,
    type: activity.type,
    amount: activity.amount ?? null,
    currencyCode: activity.currencyCode ?? fallbackCurrencyCode,
    occurredAt: activity.occurredAt,
    note: activity.note ?? null,
  }))
}
