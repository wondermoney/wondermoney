import type { ManualAssetDto } from './manual-assets-contract'

export type ValuePoint = Readonly<{ date: string; value: number }>

/** Assets that count today first, by name; archived ones apart. */
export function splitAssets<T extends Pick<ManualAssetDto, 'archived' | 'name'>>(assets: readonly T[]): { active: T[]; archived: T[] } {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return {
    active: assets.filter((asset) => !asset.archived).sort(byName),
    archived: assets.filter((asset) => asset.archived).sort(byName),
  }
}

/** What the asset is worth on its page: today's value, or for an archived one its last valuation. */
export function shownValue(asset: Pick<ManualAssetDto, 'archived' | 'lastValuation' | 'value'>): number | null {
  return asset.archived ? (asset.lastValuation?.value ?? null) : asset.value
}

/** Today's value less the purchase price, in the asset's currency; null without both. */
export function changeSincePurchase(asset: Pick<ManualAssetDto, 'purchasePrice' | 'value'>): { amount: number; ratio: number | null } | null {
  if (asset.value === null || asset.purchasePrice === null) return null
  const amount = asset.value - asset.purchasePrice
  return { amount, ratio: asset.purchasePrice === 0 ? null : amount / asset.purchasePrice }
}

/** Today's value comes from the growth rule rather than straight from a valuation. */
export function isEstimated(asset: Pick<ManualAssetDto, 'growthRule' | 'lastValuation' | 'value'>): boolean {
  return asset.growthRule !== null && asset.value !== null && asset.lastValuation !== null && asset.value !== asset.lastValuation.value
}

const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)

/**
 * The history as the chart draws it: the value in force at the end of each month from the first
 * point to the last, then the last point itself. The chart spaces points evenly, so one per month
 * keeps time even along the axis, and a valuation shows as a step in its month rather than as a
 * ramp between two far-apart dates.
 */
export function monthlyChartPoints(history: readonly ValuePoint[]): ValuePoint[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return sorted
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const points: ValuePoint[] = []
  let index = 0
  let year = Number(first.date.slice(0, 4))
  let month = Number(first.date.slice(5, 7)) - 1
  for (let end = monthEnd(year, month); end < last.date; end = monthEnd(year, month)) {
    while (index + 1 < sorted.length && sorted[index + 1].date <= end) index += 1
    points.push({ date: end, value: sorted[index].value })
    month += 1
    if (month === 12) { month = 0; year += 1 }
  }
  points.push(last)
  // Both ends in one month: draw the two points as they are.
  return points.length < 2 ? [first, last] : points
}

/** A calendar day (`YYYY-MM-DD`) in the reader's language, never shifted by their time zone. */
export function formatDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}

/** Today as the `YYYY-MM-DD` of the reader's own calendar. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
