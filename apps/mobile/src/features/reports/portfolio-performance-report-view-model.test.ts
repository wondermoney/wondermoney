import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'

const row = (overrides: Partial<{ accountKey: string; name: string; currency: string; startBalance: number; endBalance: number; return: number; contributions: number }> = {}) => ({
  accountKey: 'acc-1',
  name: 'Broker',
  currency: 'EUR',
  startBalance: 1000,
  endBalance: 1100,
  return: 100,
  contributions: 0,
  ...overrides,
})

describe('portfolio-performance report view model', () => {
  it('flags non-negative returns as gaining and negative returns as not', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ accountKey: 'a', return: 50 }), row({ accountKey: 'b', return: -20 }), row({ accountKey: 'c', return: 0 })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.find((r) => r.accountKey === 'a')?.gaining).toBe(true)
    expect(result.rows.find((r) => r.accountKey === 'b')?.gaining).toBe(false)
    expect(result.rows.find((r) => r.accountKey === 'c')?.gaining).toBe(true)
  })

  it('sorts rows by absolute return descending, regardless of sign', () => {
    const result = mapPortfolioPerformanceReport({
      data: [
        row({ accountKey: 'small', return: 5 }),
        row({ accountKey: 'bigLoss', return: -200 }),
        row({ accountKey: 'medium', return: 50 }),
      ],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.map((r) => r.accountKey)).toEqual(['bigLoss', 'medium', 'small'])
  })

  it('keeps each row currency as an informational label, distinct per account', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ accountKey: 'usd', currency: 'USD' }), row({ accountKey: 'eur', currency: 'EUR' })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.rows.find((r) => r.accountKey === 'usd')?.currency).toBe('USD')
    expect(result.rows.find((r) => r.accountKey === 'eur')?.currency).toBe('EUR')
  })

  it('sums return across rows into aggregateReturn, since amounts are already in one shared currency server-side', () => {
    const result = mapPortfolioPerformanceReport({
      data: [row({ accountKey: 'a', return: 100 }), row({ accountKey: 'b', return: -30 })],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(result.aggregateReturn).toBe(70)
  })

  it('passes generatedAt through and returns an empty list with a zero aggregate for no rows', () => {
    const result = mapPortfolioPerformanceReport({ data: [], generatedAt: '2026-08-11T00:00:00.000Z' })
    expect(result).toEqual({ rows: [], generatedAt: '2026-08-11T00:00:00.000Z', aggregateReturn: 0 })
  })
})
