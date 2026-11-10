import { transactionDisplayDate } from '@/lib/dates/transaction-date'

import type { TransactionFilters } from './transactions-contract'

/** The presets the date-range sheet offers. Web opens on the last 60 days. */
export const RANGE_PRESETS = [30, 60, 90] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]
export const DEFAULT_RANGE_DAYS: RangePreset = 60

const startOfDay = (date: Date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy }
const endOfDay = (date: Date) => { const copy = new Date(date); copy.setHours(23, 59, 59, 999); return copy }

/** `days` back from the start of today, to the end of today, in local time (web `subDays` + `startOfDay`/`endOfDay`). */
export function presetRange(days: number, now = new Date()): Readonly<{ fromDate: string; toDate: string }> {
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { fromDate: startOfDay(from).toISOString(), toDate: endOfDay(now).toISOString() }
}

/** Which preset the current filters are, if any: `all` for no date, `custom` for anything else. */
export function presetFor(filters: TransactionFilters, now = new Date()): RangePreset | 'all' | 'custom' {
  if (!filters.fromDate) return 'all'
  if (!filters.toDate) return 'custom'
  for (const days of RANGE_PRESETS) {
    const range = presetRange(days, now)
    if (range.fromDate === filters.fromDate && range.toDate === filters.toDate) return days
  }
  return 'custom'
}

/** "Sep 6, 2026 – Nov 5, 2026", web's `DatePickerRange` trigger. `null` when no date bounds the list. */
export function formatRange(filters: TransactionFilters, locale: string): string | null {
  if (!filters.fromDate) return null
  const format = (value: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
    } catch {
      return value.slice(0, 10)
    }
  }
  return filters.toDate ? `${format(filters.fromDate)} – ${format(filters.toDate)}` : `${format(filters.fromDate)} –`
}

/**
 * Web's `formatShortDate` for a transaction date: the year only when it is not this year ("Nov 3",
 * "Oct 4, 2025"). A date-only bank booking shows on its own date ({@link transactionDisplayDate}).
 */
export function formatShortDate(value: string, locale: string, now = new Date()): string {
  const date = transactionDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(date)
}

/** The ledger's month line ("October 2025") for a transaction date. */
export function formatMonth(value: string, locale: string): string {
  const date = transactionDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
}

/** The month a transaction date is listed under. */
export const monthKey = (value: string) => {
  const date = transactionDisplayDate(value)
  return Number.isNaN(date.getTime()) ? value : `${date.getFullYear()}-${date.getMonth()}`
}

