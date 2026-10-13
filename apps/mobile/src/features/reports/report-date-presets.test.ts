import { DEFAULT_REPORT_DATE_PRESET, REPORT_ALL_TIME_START, reportPresetDateRange } from './report-date-presets'

const now = new Date(2026, 7, 15) // 15 Aug 2026 (local)

describe('report date presets', () => {
  it('defaults to last3Months', () => {
    expect(DEFAULT_REPORT_DATE_PRESET).toBe('last3Months')
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
