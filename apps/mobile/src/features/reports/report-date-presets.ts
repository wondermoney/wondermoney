/**
 * Mirrors web's date-range preset math (components/reports/filters/useReportFilters.ts) without
 * pulling in date-fns — mobile has no existing dependency on it, and this is plain calendar
 * arithmetic in the device's local timezone, matching web's use of the browser's local timezone.
 */
export type ReportDatePreset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'last6Months' | 'last12Months' | 'allTime'

export const REPORT_DATE_PRESETS: readonly ReportDatePreset[] = ['thisMonth', 'lastMonth', 'last3Months', 'last6Months', 'last12Months', 'allTime']

export const DEFAULT_REPORT_DATE_PRESET: ReportDatePreset = 'last3Months'

export const REPORT_ALL_TIME_START = new Date(2000, 0, 1)

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
const subMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() - months, date.getDate())

export function reportPresetDateRange(preset: ReportDatePreset, now: Date = new Date()): Readonly<{ from: Date; to: Date }> {
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
