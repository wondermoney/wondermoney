import type { SpendingByCategoryRow } from './reports-contract'

const TOP_CATEGORY_COUNT = 12
const OTHER_COLOR = '#8b8b8b'

export type SpendingByCategoryBar = Readonly<{
  key: string
  name: string
  amount: number
  color: string
  /** 0-100, relative to the largest bar in this list — drives the proportional bar width. */
  widthPercent: number
}>

export type SpendingByCategoryReportViewModel = Readonly<{
  bars: readonly SpendingByCategoryBar[]
  total: number
  trend: Readonly<{ delta: number; percent: number | null }>
}>

/** Mirrors web's SpendingByCategoryReport.tsx: top-12 categories by amount, the rest folded into
 * a single "Other" bucket (only when it has a nonzero total), sorted descending. `otherLabel` is
 * passed in from the screen (translated) rather than hardcoded here. */
export function mapSpendingByCategoryReport(
  current: { data: readonly SpendingByCategoryRow[] },
  prior: { data: readonly SpendingByCategoryRow[] } | undefined,
  otherLabel: string,
): SpendingByCategoryReportViewModel {
  const sorted = [...current.data].sort((a, b) => b.totalAmount - a.totalAmount)
  const top = sorted.slice(0, TOP_CATEGORY_COUNT)
  const rest = sorted.slice(TOP_CATEGORY_COUNT)
  const otherTotal = rest.reduce((sum, row) => sum + row.totalAmount, 0)

  const rows: Readonly<{ key: string; name: string; amount: number; color: string }>[] = top.map((row) => ({
    key: row.categoryKey, name: row.name, amount: row.totalAmount, color: row.color,
  }))
  if (otherTotal > 0) rows.push({ key: '__other__', name: otherLabel, amount: otherTotal, color: OTHER_COLOR })

  const maxAmount = rows.reduce((max, row) => Math.max(max, row.amount), 0)
  const bars = rows.map((row) => ({ ...row, widthPercent: maxAmount > 0 ? (row.amount / maxAmount) * 100 : 0 }))

  const total = current.data.reduce((sum, row) => sum + row.totalAmount, 0)
  const priorTotal = prior?.data.reduce((sum, row) => sum + row.totalAmount, 0) ?? 0
  const delta = total - priorTotal
  // `null` where there is no prior period to compare against: a 0% change is
  // a measurement, and this is an absence.
  const percent = priorTotal !== 0 ? Number(((delta / Math.abs(priorTotal)) * 100).toFixed(1)) : null

  return { bars, total, trend: { delta, percent } }
}
