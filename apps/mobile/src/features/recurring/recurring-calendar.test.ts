import { calendarRange, groupAgenda, monthKey, shiftMonth } from './recurring-calendar'
import type { RecurringAgendaEntry } from './recurring-view-model'

const entry = (overrides: Partial<RecurringAgendaEntry> = {}): RecurringAgendaEntry => ({
  seriesKey: 1,
  name: 'Rent',
  date: '2026-03-05T00:00:00.000Z',
  day: '2026-03-05',
  amount: 20,
  currency: 'EUR',
  status: 'projected',
  ...overrides,
})

describe('recurring calendar', () => {
  it('shifts months across a year boundary', () => {
    expect(monthKey(new Date(2026, 2, 15))).toBe('2026-03')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('covers the whole month grid in the requested range', () => {
    expect(calendarRange('2026-03')).toEqual({ from: '2026-02-23', to: '2026-04-05' })
  })

  it('groups entries by day, days and entries in date order', () => {
    const groups = groupAgenda([
      entry({ day: '2026-03-07', date: '2026-03-07T00:00:00.000Z', name: 'Gym', seriesKey: 3 }),
      entry(),
      entry({ name: 'Internet', seriesKey: 2 }),
    ])

    expect(groups.map((group) => group.day)).toEqual(['2026-03-05', '2026-03-07'])
    expect(groups[0]!.entries.map((item) => item.name)).toEqual(['Internet', 'Rent'])
  })
})
