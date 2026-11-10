/**
 * Mirrors web's date-range preset math (components/reports/filters/useReportFilters.ts) without
 * pulling in date-fns — mobile has no existing dependency on it, and this is plain calendar
 * arithmetic in the device's local timezone, matching web's use of the browser's local timezone.
 */
import { LocalDayRangeError, localDayRange } from '@/lib/dates/transaction-date'

/** The named periods the picker offers; `custom` is the range the person picks instead. */
export type ReportDatePresetName = 'thisMonth' | 'lastMonth' | 'last3Months' | 'last6Months' | 'last12Months' | 'allTime'

/** A range of whole local days picked by hand, carrying the days it covers. */
export type ReportCustomDateRange = Readonly<{ kind: 'custom'; from: Date; to: Date }>

export type ReportDatePreset = ReportDatePresetName | ReportCustomDateRange

export const REPORT_DATE_PRESETS: readonly ReportDatePresetName[] = ['thisMonth', 'lastMonth', 'last3Months', 'last6Months', 'last12Months', 'allTime']

export const DEFAULT_REPORT_DATE_PRESET: ReportDatePresetName = 'last3Months'

export const REPORT_ALL_TIME_START = new Date(2000, 0, 1)

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
const subMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() - months, date.getDate())

export function isCustomReportDatePreset(preset: ReportDatePreset): preset is ReportCustomDateRange {
  return typeof preset !== 'string'
}

/** The picker's own key for a selection: the preset name, or `custom` for a hand-picked range. */
export function reportPresetKey(preset: ReportDatePreset): ReportDatePresetName | 'custom' {
  return typeof preset === 'string' ? preset : 'custom'
}

export function reportPresetDateRange(preset: ReportDatePreset, now: Date = new Date()): Readonly<{ from: Date; to: Date }> {
  if (isCustomReportDatePreset(preset)) {
    return { from: startOfDay(preset.from), to: endOfDay(preset.to) }
  }
  switch (preset) {
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'lastMonth':
      return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) }
    case 'last3Months':
      return { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) }
    case 'last6Months':
      return { from: startOfDay(subMonths(now, 6)), to: endOfDay(now) }
    case 'last12Months':
      return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) }
    case 'allTime':
      return { from: REPORT_ALL_TIME_START, to: endOfDay(now) }
    default:
      return reportPresetDateRange(DEFAULT_REPORT_DATE_PRESET, now)
  }
}

/** Why a hand-picked range was refused: a field is empty, a day is not real, or the start is after the end. */
export type ReportCustomRangeProblem = 'incomplete' | 'invalid' | 'order'

export class ReportCustomRangeError extends Error {
  constructor(readonly problem: ReportCustomRangeProblem) {
    super(problem)
    this.name = 'ReportCustomRangeError'
  }
}

/**
 * The custom preset for two `YYYY-MM-DD` days, the same whole-local-day rule the transactions
 * screen applies ({@link localDayRange}): the start is the first instant of its day, the end the
 * last instant of its day. A start after the end is refused rather than silently swapped.
 */
export function customReportDateRange(fromDay: string | null, toDay: string | null): ReportCustomDateRange {
  if (!fromDay || !toDay) throw new ReportCustomRangeError('incomplete')
  try {
    const { fromDate, toDate } = localDayRange(fromDay, toDay)
    return Object.freeze({ kind: 'custom', from: new Date(fromDate), to: new Date(toDate) })
  } catch (error) {
    throw new ReportCustomRangeError(error instanceof LocalDayRangeError && error.problem === 'order' ? 'order' : 'invalid')
  }
}

/**
 * The chosen days as the filter label, worded as the transactions range is
 * (`formatRange` in transactions-date-range.ts): "Aug 3, 2026 – Aug 17, 2026".
 */
export function formatReportDateRange(from: Date, to: Date, locale: string): string {
  const format = (value: Date) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)
    } catch {
      return value.toISOString().slice(0, 10)
    }
  }
  return `${format(from)} – ${format(to)}`
}
