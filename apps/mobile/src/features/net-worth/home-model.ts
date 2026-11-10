import type { AccountSummaryDto } from '@/features/accounts/accounts-contract'
import type { BudgetViewModel } from '@/features/budgets/budgets-view-model'
import type { CashflowDto } from '@/features/account-insights/insights-contract'
import type { LoanDto } from '@/features/loans/loans-contract'

import type { NetWorthRowDto } from './net-worth-contract'

/**
 * The arithmetic behind Home, ported from web's `lib/home/month-overview.ts`
 * so both halves headline the same figures: how net worth has moved, the
 * balance sheet behind it, each budget's month, cash flow and loan payments.
 * Pure functions over the responses the screens already read.
 */

/** Half a cent: spending this close to the plan is on plan, not over it. */
const OVER_PLAN_TOLERANCE = 0.005

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/**
 * Home reads several responses that can arrive partial (a cache entry written
 * by an older build, a section still loading); every function here treats a
 * missing list as empty and skips entries without a usable number, so a gap
 * costs a figure, never the screen.
 */
const listOf = <T,>(items: readonly T[] | null | undefined): readonly T[] => (Array.isArray(items) ? items : [])
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// ── Net worth changes ──────────────────────────────────────────────────────

export type NetWorthChange = Readonly<{
  /** Net worth now less net worth at the close of `since`'s month. */
  delta: number
  /** The history point's date (YYYY-MM-DD) the change is measured from. */
  since: string
}>

export type NetWorthChanges = Readonly<{
  lastMonth: NetWorthChange | null
  /** From the oldest month in the history, when that is older than last month. */
  overHistory: NetWorthChange | null
}>

export type ResolvedHistoryPoint = Readonly<{ date: string; value: number }>

const monthKey = (iso: string) => iso.slice(0, 7)

/**
 * How far net worth has moved since the close of last month and since the
 * close of the oldest month in the history. `current` is today's figure, so
 * the change ends on the number the screen headlines.
 */
export function netWorthChanges(points: readonly ResolvedHistoryPoint[] | null | undefined, current: number, today: Date): NetWorthChanges {
  if (!isFiniteNumber(current)) return { lastMonth: null, overHistory: null }
  const last = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthKey = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`
  const sorted = listOf(points)
    .filter((point) => typeof point?.date === 'string' && isFiniteNumber(point.value))
    .sort((a, b) => a.date.localeCompare(b.date))
  const change = (point: ResolvedHistoryPoint): NetWorthChange => ({ delta: current - point.value, since: point.date })
  const lastMonth = [...sorted].reverse().find((point) => monthKey(point.date) === lastMonthKey)
  const oldest = sorted[0]
  return {
    lastMonth: lastMonth ? change(lastMonth) : null,
    overHistory: oldest && monthKey(oldest.date) < lastMonthKey ? change(oldest) : null,
  }
}

// ── Chart scale ────────────────────────────────────────────────────────────

/** A "nice" step: two significant digits, rounded up (34.1K → 35K, as web's axis reads). */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1)
  return Math.ceil(raw / magnitude) * magnitude
}

export type ChartScale = Readonly<{ min: number; max: number; ticks: readonly number[] }>

/** The y-axis for the net-worth area: always includes zero, four even steps. */
export function chartScale(values: readonly number[] | null | undefined, intervals = 4): ChartScale {
  const finite = listOf(values).filter(isFiniteNumber)
  const low = Math.min(0, ...finite)
  const high = Math.max(0, ...finite)
  const step = niceStep((high - low) / intervals || 1)
  const min = Math.floor(low / step) * step
  let max = min + step * intervals
  while (max < high) max += step
  const ticks: number[] = []
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick)
  return { min, max, ticks }
}

// ── Balance sheet ──────────────────────────────────────────────────────────

export type BalanceSheetType = 'accounts' | 'portfolios' | 'manualAssets' | 'loans'

/**
 * `id` is the account, portfolio or loan key when the API sends it, so the row can wear its record's mark.
 * `countedInAccountId` marks a portfolio already inside that account's balance: listed, never added.
 */
export type BalanceSheetRow = Readonly<{ key: string; label: string; amount: number; id?: number; countedInAccountId?: number }>

const totalOf = (rows: readonly BalanceSheetRow[]) => rows.filter((row) => row.countedInAccountId === undefined).reduce((sum, row) => sum + row.amount, 0)
export type BalanceSheetGroup = Readonly<{ type: BalanceSheetType; rows: readonly BalanceSheetRow[]; total: number }>

export type BalanceSheet = Readonly<{
  own: readonly BalanceSheetGroup[]
  owe: readonly BalanceSheetGroup[]
  ownTotal: number
  /** Positive: what is owed, not a negative balance. */
  oweTotal: number
}>

const GROUP_ORDER: readonly BalanceSheetType[] = ['accounts', 'portfolios', 'manualAssets', 'loans']

function groupRows(rows: readonly (BalanceSheetRow & { type: BalanceSheetType })[]): BalanceSheetGroup[] {
  return GROUP_ORDER.flatMap((type) => {
    const members = rows.filter((row) => row.type === type).map(({ key, label, amount, id, countedInAccountId }) => ({
      key,
      label,
      amount,
      ...(id === undefined ? {} : { id }),
      ...(countedInAccountId === undefined ? {} : { countedInAccountId }),
    }))
    if (members.length === 0) return []
    return [{ type, rows: members, total: totalOf(members) }]
  })
}

/**
 * Net worth as two sides. A loan is always owed; a negative account balance
 * (a credit card entered as negative) is debt too, so it moves to the owed side.
 */
export function balanceSheet(rows: readonly NetWorthRowDto[] | null | undefined): BalanceSheet {
  const keyed = listOf(rows).filter((row) => row != null && GROUP_ORDER.includes(row.type) && isFiniteNumber(row.balance)).map((row, index) => ({
    key: `${row.type}:${index}`,
    type: row.type,
    label: row.name ?? '',
    amount: row.balance,
    id: row.id,
    countedInAccountId: row.countedInAccountId,
    isLiability: row.type === 'loans' || row.balance < 0,
  }))
  const owned = keyed.filter((row) => !row.isLiability)
  const owed = keyed.filter((row) => row.isLiability).map((row) => ({ ...row, amount: Math.abs(row.amount) }))
  return {
    own: groupRows(owned),
    owe: groupRows(owed),
    ownTotal: totalOf(owned),
    oweTotal: totalOf(owed),
  }
}

// ── This month ─────────────────────────────────────────────────────────────

export type MonthSummary = Readonly<{
  planned: number
  spent: number
  /** Planned minus spent; negative once the month is overspent. */
  left: number
  isOverspent: boolean
  /** The most specific category lines spent past their plan. */
  overPlanCount: number
}>

const isOver = (spent: number, planned: number) => spent - planned > OVER_PLAN_TOLERANCE

/**
 * The month's plan and spending from the budget month screen's own totals, and
 * how many lines are over plan: a subcategory over its own plan counts itself,
 * and a parent counts only when it is over and none of its subcategories is.
 */
export function monthSummary(budget: BudgetViewModel): MonthSummary {
  const planned = isFiniteNumber(budget?.totals?.planned) ? budget.totals.planned : 0
  const spent = isFiniteNumber(budget?.totals?.spent) ? budget.totals.spent : 0
  const left = planned - spent
  let overPlanCount = 0
  for (const category of listOf(budget?.categories)) {
    const overChildren = listOf(category.children).filter((child) => isOver(child.spent, child.planned)).length
    overPlanCount += overChildren
    if (overChildren === 0 && isOver(category.spent, category.planned)) overPlanCount += 1
  }
  return { planned, spent, left, isOverspent: left < -OVER_PLAN_TOLERANCE, overPlanCount }
}

export type MeasureGeometry = Readonly<{ plan: number; fill: number; over: number }>

/** Spending against its plan on a scale of `max(spent, planned)`, as web's Measure draws it. */
export function measureGeometry(spent: number, planned: number): MeasureGeometry {
  const safeSpent = Math.max(0, spent)
  const safePlanned = Math.max(0, planned)
  const scaleMax = Math.max(safeSpent, safePlanned)
  if (!(scaleMax > 0)) return { plan: 0, fill: 0, over: 0 }
  const plan = clampPercent((safePlanned / scaleMax) * 100)
  const fill = clampPercent((Math.min(safeSpent, safePlanned) / scaleMax) * 100)
  const over = Math.min(100 - plan, clampPercent((Math.max(0, safeSpent - safePlanned) / scaleMax) * 100))
  return { plan, fill, over }
}

/** Days after today in this month; today itself counts as gone. */
export function daysLeftInMonth(today: Date): number {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return daysInMonth - today.getDate()
}

// ── Cash flow ──────────────────────────────────────────────────────────────

export type CashflowBar = Readonly<{ date: string; amount: number; width: number }>
export type CashflowScale = Readonly<{ zero: number; bars: readonly CashflowBar[] }>
export type CashflowView = CashflowScale & Readonly<{ summary?: SavingsSummary | null }>

/** The API dates each row at the first of its UTC month; read it back in UTC. */
export function isCurrentCashflowMonth(iso: string, today: Date): boolean {
  const date = new Date(iso)
  return date.getUTCFullYear() === today.getFullYear() && date.getUTCMonth() === today.getMonth()
}

/** Monthly net cash flow as bars diverging from one zero line, oldest month first. */
export function cashflowScale(points: readonly CashflowDto[] | null | undefined): CashflowScale {
  const sorted = listOf(points).filter((point) => typeof point?.date === 'string' && isFiniteNumber(point.amount)).sort((a, b) => a.date.localeCompare(b.date))
  const mostOut = Math.max(0, ...sorted.map((point) => -point.amount))
  const mostIn = Math.max(0, ...sorted.map((point) => point.amount))
  const span = mostOut + mostIn
  return {
    zero: span > 0 ? (mostOut / span) * 100 : 0,
    bars: sorted.map((point) => ({
      date: point.date,
      amount: point.amount,
      width: span > 0 ? (Math.abs(point.amount) / span) * 100 : 0,
    })),
  }
}

/** The first of the month `count - 1` months before today: the window the cash-flow list shows. */
export function cashflowFromDate(today: Date, count: number): Date {
  return new Date(today.getFullYear(), today.getMonth() - (count - 1), 1)
}

// ── Savings rate and the comparison period ────────────────────────────────

export type MonthTotals = Readonly<{
  income: number
  expenses: number
  savingsRate: number | null
}>

/**
 * A cash-flow row as month totals. Older APIs send only the net, so a row
 * without income and expenses has no summary rather than a fake zero.
 */
export function monthTotalsOf(row: CashflowDto | null | undefined): MonthTotals | null {
  if (!row || !isFiniteNumber(row.income) || !isFiniteNumber(row.expenses)) return null
  return {
    income: row.income,
    expenses: row.expenses,
    savingsRate: isFiniteNumber(row.savingsRate) ? row.savingsRate : null,
  }
}

export type MonthComparisonRange = Readonly<{
  /** First day of the previous month, local. */
  from: Date
  /** End of the comparison day, local. */
  to: Date
  /** The previous month's first day, for the label. */
  month: Date
  /** True when the range ends on the same day of the month, not the month's end. */
  samePoint: boolean
}>

/**
 * The period to compare this month against. While the month is still running,
 * a full previous month would compare a part with a whole, so the range ends
 * on the same day of the previous month (clamped to its length). On the last
 * day it is the whole previous month. Web's `monthComparisonRange`.
 */
export function monthComparisonRange(today: Date): MonthComparisonRange {
  const month = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const daysInPreviousMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate()
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const samePoint = today.getDate() < daysInCurrentMonth
  const day = samePoint ? Math.min(today.getDate(), daysInPreviousMonth) : daysInPreviousMonth
  return {
    from: month,
    month,
    samePoint,
    to: new Date(today.getFullYear(), today.getMonth() - 1, day, 23, 59, 59, 999),
  }
}

export type SavingsSummary = Readonly<{
  income: number
  spending: number
  savingsRate: number | null
  comparison: (MonthTotals & Readonly<{ month: Date; samePoint: boolean }>) | null
  incomeDelta: number | null
  spendingDelta: number | null
  /** Percentage points, e.g. 3 for +3 pts. */
  savingsRateDelta: number | null
}>

/** This month's figures beside the comparison period's, with no delta where it has no data. */
export function savingsSummary(
  current: MonthTotals | null | undefined,
  previous: MonthTotals | null | undefined,
  range: MonthComparisonRange,
): SavingsSummary | null {
  if (!current) return null
  const currentRate = isFiniteNumber(current.savingsRate) ? current.savingsRate : null
  const previousRate = previous && isFiniteNumber(previous.savingsRate) ? previous.savingsRate : null
  return {
    income: current.income,
    spending: current.expenses,
    savingsRate: currentRate,
    comparison: previous ? { ...previous, month: range.month, samePoint: range.samePoint } : null,
    incomeDelta: previous ? current.income - previous.income : null,
    spendingDelta: previous ? current.expenses - previous.expenses : null,
    savingsRateDelta:
      previous && currentRate !== null && previousRate !== null
        ? (currentRate - previousRate) * 100
        : null,
  }
}

/** A signed number of percentage points, without the percent sign Intl adds. */
export function formatPercentagePoints(points: number, locale: string): string {
  const magnitude = Math.abs(points)
  let formatted: string
  try {
    formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(magnitude)
  } catch {
    formatted = magnitude.toFixed(1)
  }
  // Written here rather than with `signDisplay`, which Hermes does not
  // implement on every runtime the app supports.
  return points > 0 ? `+${formatted}` : points < 0 ? `-${formatted}` : formatted
}

/** A savings rate as a whole percentage, or the em dash when there is no rate. */
export function formatSavingsRate(rate: number | null, locale: string): string {
  if (rate === null) return '—'
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(rate)
  } catch {
    return `${Math.round(rate * 100)}%`
  }
}

// ── Loans ──────────────────────────────────────────────────────────────────

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Active loans with a payment due today or later, soonest first. */
export function upcomingLoanPayments(loans: readonly LoanDto[] | null | undefined, today: Date): LoanDto[] {
  const todayKey = localDateKey(today)
  return listOf(loans)
    .filter((loan) => loan?.status === 'ACTIVE' && typeof loan.nextPaymentDate === 'string' && loan.nextPaymentDate.slice(0, 10) >= todayKey)
    .sort((a, b) => (a.nextPaymentDate ?? '').localeCompare(b.nextPaymentDate ?? ''))
}

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
export function calendarDay(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

// ── Freshness ──────────────────────────────────────────────────────────────

/**
 * The oldest refresh among the accounts that sync: the weakest link is the
 * honest freshness of a total built from all of them. Manual accounts never
 * refresh, so they don't count; with none, there's nothing to say.
 */
export function oldestRefresh(accounts: readonly Pick<AccountSummaryDto, 'refreshedAt'>[] | null | undefined, now: Date): Date | null {
  const times = listOf(accounts)
    .map((account) => (account?.refreshedAt ? Date.parse(account.refreshedAt) : Number.NaN))
    .filter((value) => Number.isFinite(value))
    // A clock running ahead must not read as "in 3 minutes".
    .map((value) => Math.min(value, now.getTime()))
  return times.length ? new Date(Math.min(...times)) : null
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function formatMonthName(date: Date, locale: string, options: { withYear?: boolean; short?: boolean; utc?: boolean } = {}): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: options.short ? 'short' : 'long',
      ...(options.withYear ? { year: 'numeric' } : {}),
      ...(options.utc ? { timeZone: 'UTC' } : {}),
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 7)
  }
}

/** "Dec 25": the chart's x-axis label. */
export function formatAxisMonth(iso: string, locale: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date)
  } catch {
    return iso.slice(0, 7)
  }
}

/**
 * "€140K": compact axis money. Built by hand rather than with
 * `notation: 'compact'`, which Hermes doesn't implement on every runtime: the
 * scaled number is formatted with its currency and the suffix goes straight
 * after the digits, wherever the locale puts the symbol.
 */
export function formatCompactMoney(value: number, currency: string, locale: string): string {
  const magnitude = Math.abs(value)
  const [divisor, suffix] = magnitude >= 1e6 ? [1e6, 'M'] : magnitude >= 1e3 ? [1e3, 'K'] : [1, '']
  const scaled = Math.round((value / divisor) * 10) / 10
  try {
    const digits = Number.isInteger(scaled) ? 0 : 1
    const full = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(scaled)
    const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(scaled))
    const at = full.indexOf(number)
    return at < 0 ? `${full}${suffix}` : `${full.slice(0, at + number.length)}${suffix}${full.slice(at + number.length)}`
  } catch {
    return `${scaled}${suffix}`
  }
}

export function formatShortDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  } catch {
    return localDateKey(date)
  }
}
