import { formatCategoryName } from '@/lib/formatters/category-name'
import type { BudgetCategoryRowDto, BudgetDto, BudgetRecurrence, BudgetYearDto } from './budgets-contract'

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
  planned: number
  spent: number
  remaining: number
  recurrence: BudgetRecurrence | null
  progressPercentage: number | null
  meterPercentage: number
  overspent: boolean
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

const mapChildRow = (row: BudgetCategoryRowDto, name: string): BudgetCategoryChildViewModel => {
  const planned = normalizePlannedMonthly(row.category_budgeted_amount, row.category_recurrency)
  return {
    id: row.category_key,
    name,
    rawAmount: row.category_budgeted_amount,
    recurrence: row.category_recurrency,
    ...metrics(planned, row.category_amount),
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
      children,
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
  }
}

export function adjacentBudgetPeriod(year: number, month: number, direction: -1 | 1) {
  if (direction === -1 && month === 1) return { year: year - 1, month: 12 }
  if (direction === 1 && month === 12) return { year: year + 1, month: 1 }
  return { year, month: month + direction }
}
