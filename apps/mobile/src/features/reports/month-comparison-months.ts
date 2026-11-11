/**
 * The two calendar months the month-comparison report asks for, as `YYYY-MM`
 * keys. A month is a floating label, never an instant: the API turns it into the
 * month's range in the viewer's time zone.
 */

/** How far back the month pickers offer months. */
export const MONTH_PICKER_MONTHS = 36

/** `YYYY-MM` for a date, read in the device's calendar. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}`
}

/** `monthKey` moved by `delta` months (negative moves back). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number]
  return monthKeyOf(new Date(year, month - 1 + delta, 1))
}

/** The months the pickers offer: the last {@link MONTH_PICKER_MONTHS}, newest first. */
export function monthPickerOptions(now: Date = new Date()): string[] {
  const current = monthKeyOf(now)
  return Array.from({ length: MONTH_PICKER_MONTHS }, (_, index) => shiftMonthKey(current, -index))
}

/** "August 2026", in the reader's language. */
export function formatMonthLabel(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number]
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)))
  } catch {
    return monthKey
  }
}
