import type { TFunction } from 'i18next'

/**
 * Relative times, worded as web words them:
 *
 * - `distance` (default) is date-fns `formatDistanceToNow(…, { addSuffix: true })`,
 *   which web's DataProvenance and AccountsFreshness use: "less than a minute
 *   ago", "about 5 hours ago", "1 day ago".
 * - `calendar` is `Intl.RelativeTimeFormat(…, { numeric: 'auto' })`, which web's
 *   Bills & subscriptions page uses for "Last checked": "5 hours ago", "yesterday".
 *
 * Built from i18n strings (`common.relativeTime.*`) rather than
 * `Intl.RelativeTimeFormat`, which Hermes doesn't implement on every runtime
 * (it fell back to a bare date). A future time (clock skew, a seeded
 * timestamp) reads as now, as web clamps it.
 */
export type RelativeTimeStyle = 'distance' | 'calendar'

export type RelativeTimeParts = Readonly<{ key: string; count?: number }>

const MINUTES_IN_DAY = 1440
const MINUTES_IN_MONTH = 43_200

function toTime(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** date-fns `formatDistance`, without `includeSeconds`. */
function distanceParts(seconds: number): RelativeTimeParts {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return { key: 'lessThanMinute' }
  if (minutes < 45) return { key: 'minutes', count: minutes }
  if (minutes < 90) return { key: 'aboutHours', count: 1 }
  if (minutes < MINUTES_IN_DAY) return { key: 'aboutHours', count: Math.round(minutes / 60) }
  if (minutes < 2520) return { key: 'days', count: 1 }
  if (minutes < MINUTES_IN_MONTH) return { key: 'days', count: Math.round(minutes / MINUTES_IN_DAY) }
  if (minutes < MINUTES_IN_MONTH * 2) return { key: 'aboutMonths', count: Math.round(minutes / MINUTES_IN_MONTH) }
  const months = Math.floor(minutes / MINUTES_IN_MONTH)
  if (months < 12) return { key: 'months', count: Math.max(1, Math.round(minutes / MINUTES_IN_MONTH)) }
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (remainder < 3) return { key: 'aboutYears', count: years }
  if (remainder < 9) return { key: 'overYears', count: years }
  return { key: 'almostYears', count: years + 1 }
}

/** Web recurring's `formatRelativeDate` through `Intl.RelativeTimeFormat` with `numeric: 'auto'`. */
function calendarParts(seconds: number): RelativeTimeParts {
  if (seconds < 60) return seconds === 0 ? { key: 'now' } : { key: 'seconds', count: seconds }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { key: 'minutes', count: minutes }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { key: 'hours', count: hours }
  const days = Math.round(hours / 24)
  if (days === 1) return { key: 'yesterday' }
  if (days < 30) return { key: 'days', count: days }
  const months = Math.round(days / 30)
  if (months < 12) return months === 1 ? { key: 'lastMonth' } : { key: 'months', count: months }
  const years = Math.round(days / 365)
  return years === 1 ? { key: 'lastYear' } : { key: 'years', count: years }
}

/** Which phrase describes `value` relative to `now`; null without a valid time. */
export function relativeTimeParts(
  value: Date | string | number | null | undefined,
  options: { now?: number; style?: RelativeTimeStyle } = {},
): RelativeTimeParts | null {
  const time = toTime(value)
  if (time === null) return null
  const now = options.now ?? Date.now()
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  return (options.style ?? 'distance') === 'calendar' ? calendarParts(seconds) : distanceParts(seconds)
}

/** "1 day ago" in the reader's language; null without a valid time. */
export function formatRelativeTime(
  value: Date | string | number | null | undefined,
  t: TFunction,
  options: { now?: number; style?: RelativeTimeStyle } = {},
): string | null {
  const parts = relativeTimeParts(value, options)
  if (!parts) return null
  return parts.count === undefined
    ? t(`common.relativeTime.${parts.key}`)
    : t(`common.relativeTime.${parts.key}`, { count: parts.count })
}
