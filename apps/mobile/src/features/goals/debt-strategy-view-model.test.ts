import { mapDebtStrategy } from './debt-strategy-view-model'
import { debtStrategyFixture } from './test-fixtures'

describe('mapDebtStrategy', () => {
  it('is ineligible when either strategy is null', () => {
    expect(mapDebtStrategy({ ...debtStrategyFixture, avalanche: null })).toEqual({ eligible: false })
    expect(mapDebtStrategy({ ...debtStrategyFixture, snowball: null })).toEqual({ eligible: false })
  })

  it('is ineligible with fewer than two debts even if the server (unexpectedly) returns strategies', () => {
    expect(mapDebtStrategy({ ...debtStrategyFixture, debts: [debtStrategyFixture.debts[0]] })).toEqual({ eligible: false })
  })

  it('maps ordered per-debt bars by name with width proportional to the largest interest in that plan', () => {
    const result = mapDebtStrategy(debtStrategyFixture)
    if (!result.eligible) throw new Error('expected eligible result')
    expect(result.avalanche.bars).toEqual([
      { id: 1, name: 'Visa card', interest: 450, widthPercent: (450 / 1400) * 100 },
      { id: 2, name: 'Car loan', interest: 1400, widthPercent: 100 },
    ])
    expect(result.avalanche.months).toBe(30)
    expect(result.avalanche.totalInterest).toBe(1850)
  })

  it('falls back to a #id label for a debt missing from the debts list', () => {
    const withUnknownDebt = {
      ...debtStrategyFixture,
      avalanche: { order: [9], months: 5, totalInterest: 100, perDebt: [{ id: 9, months: 5, totalInterest: 100 }] },
    }
    const result = mapDebtStrategy(withUnknownDebt)
    if (!result.eligible) throw new Error('expected eligible result')
    expect(result.avalanche.bars).toEqual([{ id: 9, name: '#9', interest: 100, widthPercent: 100 }])
  })

  it('computes interestSaved as snowball minus avalanche and picks the strictly cheaper strategy', () => {
    expect(mapDebtStrategy(debtStrategyFixture)).toMatchObject({ interestSaved: 250, cheaper: 'avalanche' })
    const snowballCheaper = { ...debtStrategyFixture, avalanche: { ...debtStrategyFixture.avalanche!, totalInterest: 2000 }, snowball: { ...debtStrategyFixture.snowball!, totalInterest: 1500 } }
    expect(mapDebtStrategy(snowballCheaper)).toMatchObject({ interestSaved: -500, cheaper: 'snowball' })
  })

  it('reports no cheaper strategy when interest is tied', () => {
    const tied = { ...debtStrategyFixture, snowball: { ...debtStrategyFixture.snowball!, totalInterest: debtStrategyFixture.avalanche!.totalInterest } }
    expect(mapDebtStrategy(tied)).toMatchObject({ interestSaved: 0, cheaper: null })
  })
})
