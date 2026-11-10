import { inTimeZone } from '@/test/time-zone'

import { formatMonth, formatShortDate, monthKey } from './transactions-date-range'

/** A bank booking on 1 August: a date with no time, stored at UTC midnight. */
const BOOKING = '2026-08-01T00:00:00.000Z'
const now = new Date(2026, 10, 9, 12)

describe.each(['America/New_York', 'Asia/Tokyo'])('a viewer in %s', (zone) => {
  inTimeZone(zone)

  it('sees a date-only booking on its own date and in its own month', () => {
    expect(formatShortDate(BOOKING, 'en-US', now)).toBe('Aug 1')
    expect(formatMonth(BOOKING, 'en-US')).toBe('August 2026')
    expect(monthKey(BOOKING)).toBe(monthKey('2026-08-15T12:00:00.000Z'))
  })

  it('sees a booking on 1 January in its own year', () => {
    expect(formatShortDate('2026-01-01T00:00:00.000Z', 'en-US', now)).toBe('Jan 1')
    expect(formatMonth('2026-01-01T00:00:00.000Z', 'en-US')).toBe('January 2026')
  })
})

describe('a transaction with a real time', () => {
  describe('in New York', () => {
    inTimeZone('America/New_York')
    it('is on its local day', () => {
      expect(formatShortDate('2026-08-01T02:30:00.000Z', 'en-US', now)).toBe('Jul 31')
      expect(formatMonth('2026-08-01T02:30:00.000Z', 'en-US')).toBe('July 2026')
    })
  })
  describe('in Tokyo', () => {
    inTimeZone('Asia/Tokyo')
    it('is on its local day', () => {
      expect(formatShortDate('2026-07-31T20:00:00.000Z', 'en-US', now)).toBe('Aug 1')
    })
  })
})
