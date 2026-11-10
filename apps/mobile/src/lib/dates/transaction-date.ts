/**
 * Transaction dates as the API stores them, read on the device's calendar.
 *
 * A bank booking carries a date and no time. The API stores it at **UTC midnight** of that date;
 * anything with a real time (a manual entry, a receipt) is stored at its instant. The API reads a
 * `transactionDate` at exactly UTC midnight as date-only and counts it on that calendar day for
 * every viewer, whatever their time zone. This file is the same rule on the device, so a booking
 * is shown on the day the filters count it on: formatting UTC midnight in local time would put a
 * 1 August booking on 31 July for anyone west of UTC.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whether a transaction date from the API is a date with no time (exactly UTC midnight). */
export function isDateOnlyTransactionDate(value: string | Date): boolean {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
}

/**
 * The `Date` to show a transaction date with, in local time: local midnight of its own date for a
 * date-only booking (so any local formatting, month or year check reads that date), its instant
 * otherwise. An invalid date for a value that is not one.
 */
export function transactionDisplayDate(value: string | Date): Date {
  const date = new Date(value)
  if (!isDateOnlyTransactionDate(date)) return date
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * The last instant a transaction date covers, in local time: the end of its own day for a
 * date-only booking, its instant otherwise. For "still to come" checks, so a payment expected on
 * a date stays upcoming all that day. An invalid date for a value that is not one.
 */
export function transactionDateEnd(value: string | Date): Date {
  const date = transactionDisplayDate(value)
  if (isDateOnlyTransactionDate(value)) date.setHours(23, 59, 59, 999)
  return date
}

/**
 * A transaction date in `locale` (`dateStyle: 'medium'` by default): its own date for a date-only
 * booking, the local day otherwise. A value that is not a date comes back as it is.
 */
export function formatTransactionDate(value: string, locale: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const date = transactionDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return localCalendarDay(date)
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The local calendar day (`YYYY-MM-DD`) a transaction date falls on: its own date when it is date-only. */
export function localCalendarDay(value: string | Date): string {
  const date = transactionDisplayDate(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value.slice(0, 10) : ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localDay(day: string, end: boolean): Date | null {
  const match = DAY_PATTERN.exec(day)
  if (!match) return null
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const value = end ? new Date(year, month, date, 23, 59, 59, 999) : new Date(year, month, date, 0, 0, 0, 0)
  return value.getFullYear() === year && value.getMonth() === month && value.getDate() === date ? value : null
}

/**
 * A range of whole local calendar days (`YYYY-MM-DD`, both included) as the first and last
 * instant, the form the transaction endpoints take with the device's time zone.
 */
export function localDayRange(fromDay: string, toDay: string): Readonly<{ fromDate: string; toDate: string }> {
  if (!DAY_PATTERN.test(fromDay) || !DAY_PATTERN.test(toDay)) throw new Error('Enter both dates as YYYY-MM-DD.')
  const from = localDay(fromDay, false)
  if (!from) throw new Error('The start date is not a real calendar date.')
  const to = localDay(toDay, true)
  if (!to) throw new Error('The end date is not a real calendar date.')
  if (from.getTime() > to.getTime()) throw new Error('The start date must not be after the end date.')
  return Object.freeze({ fromDate: from.toISOString(), toDate: to.toISOString() })
}

/**
 * The device's IANA time zone, the calendar ranges are picked in. Sent with a range so the API
 * counts a date-only booking on the same calendar days. `undefined` when the runtime cannot name
 * one: the API then compares every row as an instant.
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
