import { changeSincePurchase, isEstimated, monthlyChartPoints, shownValue, splitAssets } from './manual-assets-view-model'
import { assetFixture } from './test-fixtures'

describe('manual assets view model', () => {
  it('lists active assets by name and keeps archived ones apart', () => {
    const { active, archived } = splitAssets([
      { archived: false, name: 'home' },
      { archived: true, name: 'Old car' },
      { archived: false, name: 'Car' },
    ])
    expect(active.map((asset) => asset.name)).toEqual(['Car', 'home'])
    expect(archived.map((asset) => asset.name)).toEqual(['Old car'])
  })

  it('shows an archived asset at its last valuation', () => {
    expect(shownValue(assetFixture)).toBe(250_000)
    expect(shownValue({ ...assetFixture, archived: true, value: null })).toBe(250_000)
  })

  it('works out the change since purchase, with no ratio over a zero price', () => {
    expect(changeSincePurchase(assetFixture)).toEqual({ amount: 50_000, ratio: 0.25 })
    expect(changeSincePurchase({ purchasePrice: 0, value: 10 })).toEqual({ amount: 10, ratio: null })
    expect(changeSincePurchase({ purchasePrice: null, value: 10 })).toBeNull()
  })

  it('calls a value estimated only when a growth rule has moved it', () => {
    const growthRule = { annualRatePercent: 5, startDate: null }
    expect(isEstimated({ ...assetFixture, growthRule, value: 262_500 })).toBe(true)
    expect(isEstimated({ ...assetFixture, growthRule })).toBe(false)
    expect(isEstimated(assetFixture)).toBe(false)
  })

  it('draws one point per month end, holding each valuation until the next: a step, not a ramp', () => {
    expect(monthlyChartPoints([
      { date: '2026-01-10', value: 200_000 },
      { date: '2026-03-15', value: 230_000 },
      { date: '2026-05-02', value: 230_000 },
    ])).toEqual([
      { date: '2026-01-31', value: 200_000 },
      { date: '2026-02-28', value: 200_000 },
      { date: '2026-03-31', value: 230_000 },
      { date: '2026-04-30', value: 230_000 },
      { date: '2026-05-02', value: 230_000 },
    ])
  })

  it('crosses a year end and keeps both points of a single month', () => {
    expect(monthlyChartPoints([{ date: '2025-12-20', value: 1 }, { date: '2026-01-05', value: 2 }])).toEqual([
      { date: '2025-12-31', value: 1 },
      { date: '2026-01-05', value: 2 },
    ])
    expect(monthlyChartPoints([{ date: '2026-03-01', value: 1 }, { date: '2026-03-20', value: 2 }])).toEqual([
      { date: '2026-03-01', value: 1 },
      { date: '2026-03-20', value: 2 },
    ])
    expect(monthlyChartPoints([{ date: '2026-03-01', value: 1 }])).toEqual([{ date: '2026-03-01', value: 1 }])
  })
})
