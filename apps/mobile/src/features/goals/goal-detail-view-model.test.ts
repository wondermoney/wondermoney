import { buildGoalMetadataChanges, mapGoalActivities, mapGoalDetail } from './goal-detail-view-model'
import { goalFixture } from './test-fixtures'

describe('goal detail view model', () => {
  it('builds only changed writable metadata and suppresses no-op writes', () => {
    const authoritative = { name: 'Reserve', targetAmount: 1000, monthlyContributionTarget: 100 }
    expect(buildGoalMetadataChanges(authoritative, { name: ' Reserve ', targetAmount: 1000, monthlyContributionTarget: 100 })).toBeNull()
    expect(buildGoalMetadataChanges(authoritative, { name: 'Travel', targetAmount: 1000, monthlyContributionTarget: null })).toEqual({ name: 'Travel', monthlyContributionTarget: null })
  })
  it('preserves actual overfunded progress while clamping only the meter', () => {
    const { summary: fixtureSummary, ...goal } = goalFixture
    const detail = mapGoalDetail({
      goal,
      summary: { ...fixtureSummary, availableAmount: 1250, progressPercentage: 100, remainingToTarget: 0, status: 'funded' },
    })
    expect(detail.progressPercentage).toBe(125)
    expect(detail.meterPercentage).toBe(100)
    expect(detail.overTarget).toBe(true)
    expect(detail.requiredMonthlyContribution).toBe(150)
    expect(detail.monthlyShortfall).toBe(25)
  })

  it('uses the goal currency only when raw activity has no populated currency code', () => {
    expect(mapGoalActivities([
      { goalActivityKey: 1, type: 'assigned', amount: 5, occurredAt: '2026-07-19T10:00:00.000Z', currencyCode: 'USD' },
      { goalActivityKey: 2, type: 'paused', occurredAt: '2026-07-18T10:00:00.000Z', currencyCode: undefined },
    ], 'EUR')).toMatchObject([{ currencyCode: 'USD' }, { currencyCode: 'EUR', amount: null }])
  })
})
