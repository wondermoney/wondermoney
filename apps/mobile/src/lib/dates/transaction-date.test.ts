import { inTimeZone } from '@/test/time-zone'

import { deviceTimeZone, formatTransactionDate, isDateOnlyTransactionDate, localCalendarDay, localDayRange, transactionDisplayDate } from './transaction-date'

/** A bank booking on 1 August: a date with no time, which the API stores at UTC midnight. */
const BOOKING = '2026-08-01T00:00:00.000Z'
const format = (date: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
const formatWithTime = (date: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)

describe('isDateOnlyTransactionDate', () => {
  it('is true at exactly UTC midnight, as the API reads it', () => {
    expect(isDateOnlyTransactionDate(BOOKING)).toBe(true)
    expect(isDateOnlyTransactionDate('2026-08-01')).toBe(true)
  })

  it('is false for any other time, and for a value that is not a date', () => {
    expect(isDateOnlyTransactionDate('2026-08-01T00:00:00.001Z')).toBe(false)
    expect(isDateOnlyTransactionDate('2026-08-01T14:30:00.000Z')).toBe(false)
    expect(isDateOnlyTransactionDate('2026-08-01T00:00:00.000+01:00')).toBe(false)
    expect(isDateOnlyTransactionDate('not a date')).toBe(false)
  })
})

describe.each(['America/New_York', 'Asia/Tokyo'])('a viewer in %s', (zone) => {
  inTimeZone(zone)

  it('sees a date-only booking on its own date', () => {
    const date = transactionDisplayDate(BOOKING)
    expect(format(date)).toBe('Aug 1, 2026')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(1)
  })

  it('reads a date-only booking as its own date in any format', () => {
    expect(formatTransactionDate(BOOKING, 'en-US')).toBe('Aug 1, 2026')
    expect(formatTransactionDate(BOOKING, 'pt-PT', { dateStyle: 'long' })).toBe('1 de agosto de 2026')
  })

  it('counts a date-only booking on its own calendar day', () => {
    expect(localCalendarDay(BOOKING)).toBe('2026-08-01')
  })
})

describe('a transaction with a real time', () => {
  describe('in New York', () => {
    inTimeZone('America/New_York')
    it('shows in local time', () => {
      expect(formatWithTime(transactionDisplayDate('2026-08-01T02:30:00.000Z'))).toBe('Jul 31, 2026, 10:30 PM')
      expect(localCalendarDay('2026-08-01T02:30:00.000Z')).toBe('2026-07-31')
    })
  })
  describe('in Tokyo', () => {
    inTimeZone('Asia/Tokyo')
    it('shows in local time', () => {
      expect(formatWithTime(transactionDisplayDate('2026-07-31T20:00:00.000Z'))).toBe('Aug 1, 2026, 5:00 AM')
      expect(localCalendarDay('2026-07-31T20:00:00.000Z')).toBe('2026-08-01')
    })
  })
})

describe('formatTransactionDate', () => {
  inTimeZone('America/New_York')
  it('formats a real time on its local day', () => {
    expect(formatTransactionDate('2026-08-01T02:30:00.000Z', 'en-US')).toBe('Jul 31, 2026')
  })
  it('gives back a value that is not a date as it came', () => {
    expect(formatTransactionDate('soon', 'en-US')).toBe('soon')
  })
})

describe('transactionDisplayDate', () => {
  it('is an invalid date for a value that is not one', () => {
    expect(Number.isNaN(transactionDisplayDate('soon').getTime())).toBe(true)
  })
})

describe('localDayRange', () => {
  describe('in New York', () => {
    inTimeZone('America/New_York')
    it('runs from the first instant of the first local day to the last instant of the last', () => {
      expect(localDayRange('2026-08-01', '2026-08-31')).toEqual({ fromDate: '2026-08-01T04:00:00.000Z', toDate: '2026-09-01T03:59:59.999Z' })
    })
  })
  describe('in Tokyo', () => {
    inTimeZone('Asia/Tokyo')
    it('runs from the first instant of the first local day to the last instant of the last', () => {
      expect(localDayRange('2026-08-01', '2026-08-31')).toEqual({ fromDate: '2026-07-31T15:00:00.000Z', toDate: '2026-08-31T14:59:59.999Z' })
    })
    it('names its days back from the instants', () => {
      const range = localDayRange('2026-08-01', '2026-08-31')
      expect([localCalendarDay(range.fromDate), localCalendarDay(range.toDate)]).toEqual(['2026-08-01', '2026-08-31'])
    })
  })
  it('rejects a day that is not on the calendar, or a start after the end', () => {
    expect(() => localDayRange('2026-02-30', '2026-03-01')).toThrow('The start date is not a real calendar date.')
    expect(() => localDayRange('2026-03-01', '2026-02-30')).toThrow('The end date is not a real calendar date.')
    expect(() => localDayRange('2026-03-02', '2026-03-01')).toThrow('The start date must not be after the end date.')
    expect(() => localDayRange('1/3/2026', '2026-03-01')).toThrow('Enter both dates as YYYY-MM-DD.')
  })
})

describe('deviceTimeZone', () => {
  inTimeZone('Asia/Tokyo')
  it('names the device time zone', () => {
    expect(deviceTimeZone()).toBe('Asia/Tokyo')
  })
})
