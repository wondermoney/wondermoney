import { parseSafeCategoryColor } from '@/features/categories/categories-view-model'
import { formatCategoryName } from '@/lib/formatters/category-name'
import type { BudgetCategoryRowDto, BudgetDto, BudgetPeriodDto, BudgetRecurrence, BudgetVisibility, BudgetYearDto } from './budgets-contract'

export type BudgetTotals = Readonly<{
  planned: number
  spent: number
  remaining: number
  progressPercentage: number | null
  meterPercentage: number
  overspent: boolean
}>

export type BudgetCategoryViewModel = Readonly<{
  id: number
  name: string
  /**
   * What the line may spend: its monthly plan plus what last month rolled over. Remaining, the
   * share of the plan and "over" all measure against this. Without rollover it is the plan.
   */
  planned: number
  /** The line's own monthly plan, before any rollover. */
  budgeted: number
  /** What last month left over (negative when it overspent); 0 when nothing carries. */
  rolledOver: number
  /** Rollover is on for the line (a parent: for any of its subcategories). */
  rolloverEnabled: boolean
  /** The carried amount rests on spending that could not be converted, so it may be too high. */
  rolloverIncomplete: boolean
  spent: number
  remaining: number
  recurrence: BudgetRecurrence | null
  progressPercentage: number | null
  meterPercentage: number
  overspent: boolean
  /** The category's icon name and swatch colours, as web's category chip draws them. */
  icon: string | null
  bgColor: string | null
  textColor: string | null
}>

export type BudgetCategoryGroupViewModel = BudgetCategoryViewModel & Readonly<{
  children: readonly BudgetCategoryChildViewModel[]
}>

export type BudgetCategoryChildViewModel = BudgetCategoryViewModel & Readonly<{
  rawAmount: number
}>

export type BudgetViewModel = Readonly<{
  id: number
  name: string
  description: string | null
  currencyCode: string
  year: number
  month: number
  totals: BudgetTotals
  categories: readonly BudgetCategoryGroupViewModel[]
  accounts: readonly Readonly<{ id: number; name: string | null }>[]
  incomes: readonly Readonly<{ name: string; amount: number }>[]
  /** The day of the month the budget's months start on (1: the calendar month). */
  periodStartDay: number
  /** The days this month covers; null when the server does not say. */
  period: BudgetPeriodDto | null
  /** Off: only unspent money rolls over, an overspend is dropped. */
  rolloverCarriesOverspend: boolean
  /** Personal: only the member who created it sees it. */
  visibility: BudgetVisibility
}>

export type BudgetYearViewModel = Readonly<{
  id: number
  name: string
  description: string | null
  currencyCode: string
  year: number
  totalIncome: number
  totals: BudgetTotals
  categories: readonly BudgetCategoryGroupViewModel[]
  accounts: readonly Readonly<{ id: number; name: string | null }>[]
  visibility: BudgetVisibility
}>

const occurrencesPerYear: Readonly<Record<BudgetRecurrence, number>> = {
  MONTHLY_14: 14,
  MONTHLY: 12,
  QUARTERLY: 4,
  BI_ANNUALLY: 2,
  ANNUALLY: 1,
}

/**
 * Matches the month-detail API's recurrence CASE expression. A null recurrence
 * reaches its ELSE branch and is therefore treated as one occurrence per year.
 */
export const normalizePlannedMonthly = (rawAmount: number, recurrence: BudgetRecurrence | null): number => (
  rawAmount * (recurrence === null ? 1 : occurrencesPerYear[recurrence]) / 12
)

const metrics = (planned: number, spent: number): BudgetTotals => {
  const progressPercentage = planned > 0 ? (spent / planned) * 100 : null
  return {
    planned,
    spent,
    remaining: planned - spent,
    progressPercentage,
    meterPercentage: progressPercentage === null ? 0 : Math.min(100, Math.max(0, progressPercentage)),
    overspent: spent > planned,
  }
}

const swatch = (row: BudgetCategoryRowDto) => ({
  icon: row.category_icon,
  bgColor: parseSafeCategoryColor(row.category_bg_color),
  textColor: parseSafeCategoryColor(row.category_text_color),
})

/**
 * A subcategory's plan is its recurrence-normalized monthly amount (as web shows it), and what it
 * may spend adds last month's rollover on top. The API's `category_available` adds the rollover to
 * the raw amount instead; the two agree for monthly lines, and this keeps the shown plan, the
 * carried line and the remaining figure adding up for the others.
 */
const mapChildRow = (row: BudgetCategoryRowDto, name: string): BudgetCategoryChildViewModel => {
  const budgeted = normalizePlannedMonthly(row.category_budgeted_amount, row.category_recurrency)
  return {
    id: row.category_key,
    name,
    ...swatch(row),
    rawAmount: row.category_budgeted_amount,
    recurrence: row.category_recurrency,
    budgeted,
    rolledOver: row.category_rolled_over,
    rolloverEnabled: row.category_rollover_enabled,
    rolloverIncomplete: row.category_rollover_incomplete,
    ...metrics(budgeted + row.category_rolled_over, row.category_amount),
  }
}

/** Shared by month and year mapping — the year endpoints return pre-aggregated (summed-across-
 * months) category rows using the exact same field shape, so the same recurrence-normalized
 * planned/spent math applies unchanged. */
function mapBudgetCategories(rows: readonly BudgetCategoryRowDto[]): Readonly<{ categories: readonly BudgetCategoryGroupViewModel[]; totals: BudgetTotals }> {
  const parentRows = rows.filter((row) => row.child_category_name === null)
  const childRows = rows.filter((row) => row.child_category_name !== null)
  const categories = parentRows.map((parent): BudgetCategoryGroupViewModel => {
    const children = childRows
      .filter((child) => child.parent_category_name === parent.parent_category_name)
      .map((child) => mapChildRow(child, formatCategoryName(child.child_category_name!)))
    const planned = children.reduce((sum, child) => sum + child.planned, 0)
    return {
      id: parent.category_key,
      name: formatCategoryName(parent.parent_category_name),
      recurrence: null,
      ...swatch(parent),
      children,
      budgeted: children.reduce((sum, child) => sum + child.budgeted, 0),
      // A parent's rollover is its subcategories' (the API sums them the same way).
      rolledOver: children.reduce((sum, child) => sum + child.rolledOver, 0),
      rolloverEnabled: children.some((child) => child.rolloverEnabled),
      rolloverIncomplete: children.some((child) => child.rolloverIncomplete),
      ...metrics(planned, parent.category_amount),
    }
  })
  const planned = categories.reduce((sum, category) => sum + category.planned, 0)
  // Parent spent values already aggregate their children. Never sum both levels.
  const spent = parentRows.reduce((sum, parent) => sum + parent.category_amount, 0)
  return { categories, totals: metrics(planned, spent) }
}

const mapBudgetAccounts = (accounts: readonly { accountKey: number; accountName: string | null | undefined }[]) => Array.from(
  new Map(accounts.map((account) => [account.accountKey, {
    id: account.accountKey,
    name: account.accountName ?? null,
  }])).values(),
)

export function mapBudget(dto: BudgetDto, authoritativePeriod?: { year: number; month: number }): BudgetViewModel {
  const { categories, totals } = mapBudgetCategories(dto.categories)
  return {
    id: dto.budgetKey,
    name: dto.name,
    description: dto.description ?? null,
    currencyCode: dto.currencyCode,
    year: authoritativePeriod?.year ?? dto.year,
    month: authoritativePeriod?.month ?? dto.month,
    totals,
    categories,
    accounts: mapBudgetAccounts(dto.accounts),
    incomes: dto.incomes.map((income) => ({ name: income.name, amount: income.amount })),
    periodStartDay: dto.periodStartDay,
    period: dto.period ?? null,
    rolloverCarriesOverspend: dto.rolloverCarriesOverspend,
    visibility: dto.visibility,
  }
}

export const mapBudgets = (response: { budgets: BudgetDto[] }): BudgetViewModel[] => (
  response.budgets.map((budget) => mapBudget(budget))
)

/** Each stored income amount is already the monthly-equivalent value (submitted normalized by
 * the create wizard), so recurrence is not applied again here — just annualized. */
const calculateAnnualIncome = (incomes: readonly { amount: number }[]): number => (
  incomes.reduce((sum, income) => sum + income.amount * 12, 0)
)

export function mapBudgetYear(dto: BudgetYearDto, authoritativeYear?: number): BudgetYearViewModel {
  const { categories, totals } = mapBudgetCategories(dto.categories)
  return {
    id: dto.budgetKey,
    name: dto.name,
    description: dto.description ?? null,
    currencyCode: dto.currencyCode,
    year: authoritativeYear ?? dto.year,
    totalIncome: calculateAnnualIncome(dto.incomes),
    totals,
    categories,
    accounts: mapBudgetAccounts(dto.accounts),
    visibility: dto.visibility,
  }
}

export type BudgetGroup = Readonly<{
  /** The group's heading; null when every budget is the same kind and the list needs none. */
  visibility: BudgetVisibility | null
  budgets: readonly BudgetViewModel[]
}>

/**
 * The budgets list in a Household group then a Personal one, each in the API's order, when both
 * kinds exist. With one kind the list is a single group without a heading (each personal row
 * still carries its own label).
 */
export function groupBudgetsByVisibility(budgets: readonly BudgetViewModel[]): readonly BudgetGroup[] {
  if (budgets.length === 0) return []
  const household = budgets.filter((budget) => budget.visibility !== 'personal')
  const personal = budgets.filter((budget) => budget.visibility === 'personal')
  if (household.length === 0 || personal.length === 0) return [{ visibility: null, budgets }]
  return [{ visibility: 'household', budgets: household }, { visibility: 'personal', budgets: personal }]
}

/**
 * The accounts a budget may link: a household budget only accounts the household shares (the API
 * refuses a private one), a personal budget every account the member sees, their private ones too.
 */
export const linkableBudgetAccounts = <Account extends Readonly<{ isPrivate: boolean }>>(accounts: readonly Account[], visibility: BudgetVisibility): Account[] => (
  visibility === 'personal' ? [...accounts] : accounts.filter((account) => !account.isPrivate)
)

/**
 * The last month the "Year to date" comparison covers for a budget year, read in the device's
 * calendar: every month of a past year, the months through the current one in the current year,
 * and none of a year that has not started (`null`: there is no year to date to show).
 */
export function budgetYearToDateMonth(year: number, today: Date = new Date()): number | null {
  const currentYear = today.getFullYear()
  if (year < currentYear) return 12
  if (year > currentYear) return null
  return today.getMonth() + 1
}

export function adjacentBudgetPeriod(year: number, month: number, direction: -1 | 1) {
  if (direction === -1 && month === 1) return { year: year - 1, month: 12 }
  if (direction === 1 && month === 12) return { year: year + 1, month: 1 }
  return { year, month: month + direction }
}

/** Web's `OVER_PLAN_TOLERANCE` (`lib/home/month-overview.ts`): half a cent is not over. */
const OVER_PLAN_TOLERANCE = 0.005
const isOver = (spent: number, planned: number) => spent - planned > OVER_PLAN_TOLERANCE

/**
 * Web's `overPlanLines(rows).length`: the most specific lines that spent past their plan. A
 * subcategory counts on its own; a parent counts only when none of its children is over.
 */
export function overPlanLineCount(categories: readonly BudgetCategoryGroupViewModel[]): number {
  return categories.reduce((count, category) => {
    const overChildren = category.children.filter((child) => isOver(child.spent, child.planned)).length
    if (overChildren > 0) return count + overChildren
    return count + (isOver(category.spent, category.planned) ? 1 : 0)
  }, 0)
}

/** Web's `countBudgetedCategories`: a leaf where a parent has children, the parent where it has none. */
export const budgetedLineCount = (categories: readonly BudgetCategoryGroupViewModel[]): number => (
  categories.reduce((total, category) => total + (category.children.length > 0 ? category.children.length : 1), 0)
)

/** Stored income amounts are already monthly equivalents (see `calculateAnnualIncome`). */
export const monthlyIncome = (incomes: readonly { amount: number }[]): number => (
  incomes.reduce((total, income) => total + income.amount, 0)
)

/**
 * Web's `measureScale` (`components/budget/BudgetTable.tsx`): the largest plan or spend among the
 * categories and their subcategories, so every bar on the page reads on one scale.
 */
export function budgetMeasureScale(categories: readonly BudgetCategoryGroupViewModel[]): number {
  return Math.max(0, ...categories.flatMap((category) => [
    category.planned,
    category.spent,
    ...category.children.flatMap((child) => [child.planned, child.spent]),
  ]))
}

export type MeasureGeometry = Readonly<{ plan: number; fill: number; over: number }>

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/** Web's `measureGeometry` (`lib/home/month-overview.ts`), in percentages of the shared scale. */
export function measureGeometry(spent: number, planned: number, scaleMax: number): MeasureGeometry {
  if (!(scaleMax > 0)) return { plan: 0, fill: 0, over: 0 }
  const safeSpent = Math.max(0, spent)
  const safePlanned = Math.max(0, planned)
  const plan = clampPercent((safePlanned / scaleMax) * 100)
  const fill = clampPercent((Math.min(safeSpent, safePlanned) / scaleMax) * 100)
  const over = Math.min(100 - plan, clampPercent((Math.max(0, safeSpent - safePlanned) / scaleMax) * 100))
  return { plan, fill, over }
}

/**
 * The days a budget month covers, for under its name ("Oct 25 – Nov 24"), or null when it is its
 * calendar month (start day 1) and the name says it all. The year shows only when the month spans
 * two. The days are calendar days, read in UTC so no time zone moves them.
 */
export function budgetPeriodLabel(budget: Pick<BudgetViewModel, 'period' | 'periodStartDay'>, locale: string): string | null {
  if (budget.periodStartDay === 1 || !budget.period) return null
  const first = new Date(`${budget.period.firstDay}T00:00:00Z`)
  const last = new Date(`${budget.period.lastDay}T00:00:00Z`)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null
  const spansYears = first.getUTCFullYear() !== last.getUTCFullYear()
  // Each day on its own: Hermes's Intl has no formatRange.
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(spansYears ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  return `${format.format(first)} – ${format.format(last)}`
}
