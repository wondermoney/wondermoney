import { inTimeZone } from '@/test/time-zone'

import {
  customReportDateRange,
  DEFAULT_REPORT_DATE_PRESET,
  formatReportDateRange,
  isCustomReportDatePreset,
  REPORT_ALL_TIME_START,
  REPORT_DATE_PRESETS,
  ReportCustomRangeError,
  reportPresetDateRange,
  reportPresetKey,
} from './report-date-presets'

const now = new Date(2026, 7, 15) // 15 Aug 2026 (local)

describe('report date presets', () => {
  it('defaults to last3Months', () => {
    expect(DEFAULT_REPORT_DATE_PRESET).toBe('last3Months')
  })

  it('offers only the named periods, not a custom placeholder', () => {
    expect(REPORT_DATE_PRESETS).toEqual(['thisMonth', 'lastMonth', 'last3Months', 'last6Months', 'last12Months', 'allTime'])
  })

  it('computes thisMonth as the full current calendar month', () => {
    const range = reportPresetDateRange('thisMonth', now)
    expect(range.from).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0))
    expect(range.to).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999))
  })

  it('computes lastMonth as the full prior calendar month', () => {
    const range = reportPresetDateRange('lastMonth', now)
    expect(range.from).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0))
    expect(range.to).toEqual(new Date(2026, 6, 31, 23, 59, 59, 999))
  })

  it('computes last3Months as a rolling window ending today', () => {
    const range = reportPresetDateRange('last3Months', now)
    expect(range.from).toEqual(new Date(2026, 4, 15, 0, 0, 0, 0))
    expect(range.to).toEqual(new Date(2026, 7, 15, 23, 59, 59, 999))
  })

  it('computes last6Months and last12Months as rolling windows', () => {
    expect(reportPresetDateRange('last6Months', now).from).toEqual(new Date(2026, 1, 15, 0, 0, 0, 0))
    expect(reportPresetDateRange('last12Months', now).from).toEqual(new Date(2025, 7, 15, 0, 0, 0, 0))
  })

  it('computes allTime from the fixed epoch start through today', () => {
    const range = reportPresetDateRange('allTime', now)
    expect(range.from).toEqual(REPORT_ALL_TIME_START)
    expect(range.to).toEqual(new Date(2026, 7, 15, 23, 59, 59, 999))
  })

  it('handles year rollover across January', () => {
    const jan = new Date(2026, 0, 15)
    expect(reportPresetDateRange('lastMonth', jan).from).toEqual(new Date(2025, 11, 1, 0, 0, 0, 0))
  })

  it('falls back to the default preset for an unrecognized value', () => {
    expect(reportPresetDateRange('bogus' as never, now)).toEqual(reportPresetDateRange('last3Months', now))
  })
})

describe('a custom report date range', () => {
  inTimeZone('America/New_York')

  it('carries the chosen local days, start of the first to end of the last', () => {
    const custom = customReportDateRange('2026-08-03', '2026-08-17')
    expect(custom.kind).toBe('custom')
    expect(custom.from).toEqual(new Date(2026, 7, 3, 0, 0, 0, 0))
    expect(custom.to).toEqual(new Date(2026, 7, 17, 23, 59, 59, 999))
    expect(reportPresetDateRange(custom)).toEqual({ from: custom.from, to: custom.to })
  })

  it('is the custom value the picker and the label recognise', () => {
    const custom = customReportDateRange('2026-08-03', '2026-08-17')
    expect(isCustomReportDatePreset(custom)).toBe(true)
    expect(isCustomReportDatePreset('last3Months')).toBe(false)
    expect(reportPresetKey(custom)).toBe('custom')
    expect(reportPresetKey('last3Months')).toBe('last3Months')
  })

  it('rejects a start after the end with an order problem', () => {
    expect(() => customReportDateRange('2026-08-17', '2026-08-03')).toThrow(ReportCustomRangeError)
    try {
      customReportDateRange('2026-08-17', '2026-08-03')
    } catch (error) {
      expect(error).toBeInstanceOf(ReportCustomRangeError)
      expect((error as ReportCustomRangeError).problem).toBe('order')
    }
  })

  it('rejects an incomplete or unreal day', () => {
    expect(() => customReportDateRange(null, '2026-08-03')).toThrow(ReportCustomRangeError)
    try {
      customReportDateRange('2026-02-30', '2026-03-01')
    } catch (error) {
      expect((error as ReportCustomRangeError).problem).toBe('invalid')
    }
  })

  it('formats the label as the transactions range does', () => {
    const custom = customReportDateRange('2026-08-03', '2026-08-17')
    expect(formatReportDateRange(custom.from, custom.to, 'en-US')).toBe('Aug 3, 2026 – Aug 17, 2026')
  })
})
