import { reportPriorPeriodFilters } from './report-prior-period'

describe('reportPriorPeriodFilters', () => {
  it('shifts the date range back by its own length, preserving other filters', () => {
    const filters = {
      fromDate: '2026-07-01T00:00:00.000Z',
      toDate: '2026-08-01T00:00:00.000Z',
      accountKeys: ['a1'],
      currencyKey: 'EUR',
    }
    const prior = reportPriorPeriodFilters(filters)
    // 31-day range (July), shifted back by its own exact millisecond length — not a calendar-month shift.
    expect(prior.fromDate).toBe('2026-05-31T00:00:00.000Z')
    expect(prior.toDate).toBe('2026-07-01T00:00:00.000Z')
    expect(prior.accountKeys).toEqual(['a1'])
    expect(prior.currencyKey).toBe('EUR')
  })

  it('preserves an odd-length range exactly, not rounding to calendar months', () => {
    const filters = { fromDate: '2026-08-05T12:00:00.000Z', toDate: '2026-08-11T12:00:00.000Z' }
    const prior = reportPriorPeriodFilters(filters)
    expect(new Date(prior.toDate).getTime()).toBe(new Date(filters.fromDate).getTime())
    expect(new Date(prior.fromDate).getTime()).toBe(new Date(filters.fromDate).getTime() - (new Date(filters.toDate).getTime() - new Date(filters.fromDate).getTime()))
  })
})
