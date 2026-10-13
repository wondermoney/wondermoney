import { basisPointsToPercent, MAX_RATE_BPS, percentToBasisPoints } from './interest-rate'

describe('interest rate conversion', () => {
  it('writes a percentage as basis points', () => {
    // The bug: 3.1 was sent as 3.1 bps, i.e. 0.031%.
    expect(percentToBasisPoints(3.1)).toBe(310)
    expect(percentToBasisPoints(0)).toBe(0)
    expect(percentToBasisPoints(100)).toBe(MAX_RATE_BPS)
  })

  it('round-trips what the user typed', () => {
    for (const percent of [0, 0.5, 3.1, 7.25, 12.75, 100]) {
      expect(basisPointsToPercent(percentToBasisPoints(percent))).toBe(percent)
    }
  })

  it('produces the integer the read contract requires', () => {
    for (const percent of [3.1, 7.259, 0.014]) {
      expect(Number.isInteger(percentToBasisPoints(percent))).toBe(true)
    }
  })
})
