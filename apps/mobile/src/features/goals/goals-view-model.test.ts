import { mapGoalListItem } from './goals-view-model'
import { goalFixture } from './test-fixtures'

describe('goals view semantics', () => {
  it.each([
    ['on_track', 'on-track'],
    ['behind', 'behind'],
    ['funded', 'funded'],
  ] as const)('uses active summary status %s', (summary, expected) => {
    expect(mapGoalListItem({ ...goalFixture, summary: { ...goalFixture.summary, status: summary } }).effectiveStatus).toBe(expected)
  })

  it.each(['paused', 'completed', 'archived'] as const)(
    'gives lifecycle %s precedence over summary funded',
    (status) => {
      expect(mapGoalListItem({
        ...goalFixture,
        status,
        summary: { ...goalFixture.summary, status: 'funded' },
      }).effectiveStatus).toBe(status)
    },
  )

  it.each([0, -100])('marks a legacy target %s unavailable and never funded from it', (targetAmount) => {
    const mapped = mapGoalListItem({
      ...goalFixture,
      targetAmount,
      summary: { ...goalFixture.summary, progressPercentage: 100, status: 'funded' },
    })
    expect(mapped.progressAvailable).toBe(false)
    expect(mapped.effectiveStatus).toBe('progress-unavailable')
    expect(mapped.progressPercentage).toBe(0)
    expect(mapped.meterPercentage).toBe(0)
  })

  it('clamps only the visual meter and preserves exact server values including over-target state', () => {
    const mapped = mapGoalListItem({
      ...goalFixture,
      targetAmount: 100,
      monthlyContributionTarget: 0,
      targetDate: null,
      summary: {
        ...goalFixture.summary,
        availableAmount: 125,
        progressPercentage: 2,
        remainingToTarget: -900,
        requiredMonthlyContribution: null,
      },
    })
    expect(mapped.meterPercentage).toBe(100)
    expect(mapped.progressPercentage).toBe(125)
    expect(mapped.availableAmount).toBe(125)
    expect(mapped.targetAmount).toBe(100)
    expect(mapped.remainingToTarget).toBe(0)
    expect(mapped.overTarget).toBe(true)
    expect(mapped.monthlyContributionTarget).toBe(0)
    expect(mapped.targetDate).toBeNull()
  })

  it('derives progress and remaining from available and target instead of conflicting summary values', () => {
    const mapped = mapGoalListItem({
      ...goalFixture,
      targetAmount: 800,
      summary: { ...goalFixture.summary, availableAmount: 200, progressPercentage: 99, remainingToTarget: -1 },
    })
    expect(mapped.meterPercentage).toBe(25)
    expect(mapped.progressPercentage).toBe(25)
    expect(mapped.remainingToTarget).toBe(600)
    expect(mapped.availableAmount).toBe(200)
    expect(mapped.targetAmount).toBe(800)
  })

  it('maps linked accounts for read-only context', () => {
    expect(mapGoalListItem(goalFixture).linkedAccounts).toEqual([
      { accountId: 42, name: 'Current account' },
    ])
  })
})
