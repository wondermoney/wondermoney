import type { RecurringAgendaEntry } from './recurring-view-model'

/** Days in a month grid: six weeks, so the range always covers a whole month's cells. */
export const CALENDAR_CELL_COUNT = 42

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/
const pad = (value: number) => String(value).padStart(2, '0')

export type RecurringAgendaGroup = Readonly<{
  day: string
  entries: readonly RecurringAgendaEntry[]
}>

/** The `YYYY-MM` key of a date, in the device's calendar. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** The `YYYY-MM` key `delta` months from `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = monthParts(month)
  return monthKey(new Date(year, monthIndex + delta, 1))
}

/** The first and last day of the month grid, as the API takes them. */
export function calendarRange(month: string): Readonly<{ from: string; to: string }> {
  const [year, monthIndex] = monthParts(month)
  const first = new Date(year, monthIndex, 1)
  // getDay(): Sunday is 0. Shift so Monday is 0.
  const leading = (first.getDay() + 6) % 7
  const start = new Date(year, monthIndex, 1 - leading)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + CALENDAR_CELL_COUNT - 1)
  return Object.freeze({ from: dayKey(start), to: dayKey(end) })
}

/** Agenda entries grouped by day, days and entries in date order. */
export function groupAgenda(entries: readonly RecurringAgendaEntry[]): RecurringAgendaGroup[] {
  const grouped = new Map<string, RecurringAgendaEntry[]>()
  for (const entry of entries) {
    const list = grouped.get(entry.day) ?? []
    list.push(entry)
    grouped.set(entry.day, list)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, list]) => ({
      day,
      entries: [...list].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
    }))
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthParts(month: string): [number, number] {
  const match = MONTH_PATTERN.exec(month)
  if (!match) throw new Error(`Expected a YYYY-MM month, received "${month}"`)
  return [Number(match[1]), Number(match[2]) - 1]
}
