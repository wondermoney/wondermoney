import { budgetCreateWriteSchema, type BudgetCreateIncome, type BudgetCreateWrite, type BudgetInventoryResponseDto, type BudgetRecurrence } from './budgets-contract'

const occurrences: Record<BudgetRecurrence, number> = {
  MONTHLY_14: 14,
  MONTHLY: 12,
  QUARTERLY: 4,
  BI_ANNUALLY: 2,
  ANNUALLY: 1,
}

export type EditableIncome = Readonly<{
  id: string
  name: string
  amount: string
  isRecurrent: boolean
  recurrency: BudgetRecurrence
}>

export const monthlyEquivalent = (amount: number, isRecurrent: boolean, recurrency: BudgetRecurrence): number => (
  amount * (isRecurrent ? occurrences[recurrency] : 1) / 12
)

export const toCreateIncome = (income: EditableIncome): BudgetCreateIncome => {
  const amount = monthlyEquivalent(Number(income.amount), income.isRecurrent, income.recurrency)
  return income.isRecurrent
    ? { name: income.name.trim(), amount, isRecurrent: true, recurrency: income.recurrency }
    : { name: income.name.trim(), amount, isRecurrent: false }
}

export const createBudgetPayload = (houseHoldSize: number, dependentsNum: number, incomes: readonly EditableIncome[]): BudgetCreateWrite => ({
  houseHoldSize,
  dependentsNum,
  incomes: incomes.map(toCreateIncome),
})

export const monthlyEquivalentTotal = (incomes: readonly EditableIncome[]): number => incomes.reduce(
  (total, income) => total + monthlyEquivalent(Number(income.amount) || 0, income.isRecurrent, income.recurrency),
  0,
)

export const newBudgetCandidates = (inventory: BudgetInventoryResponseDto, before: ReadonlySet<number>) => inventory.budgets
  .filter((budget) => !before.has(budget.budgetKey))
  .map((budget) => ({ id: budget.budgetKey, name: budget.name }))

export type HouseholdField = 'household' | 'dependents'

export function invalidHouseholdFields(household: number, dependents: number): ReadonlySet<HouseholdField> {
  const fields = new Set<HouseholdField>()
  if (household < 1 || household > 10) fields.add('household')
  if (dependents < 0 || dependents >= household) fields.add('dependents')
  return fields
}

export type IncomeField = 'name' | 'amount'

/** Keyed by `EditableIncome.id`, not array index — ids are stable as rows are
 * added and removed, indices aren't. */
export function invalidIncomeFields(household: number, dependents: number, incomes: readonly EditableIncome[]): ReadonlyMap<string, ReadonlySet<IncomeField>> {
  const result = new Map<string, Set<IncomeField>>()
  const parsed = budgetCreateWriteSchema.safeParse(createBudgetPayload(household, dependents, incomes))
  if (parsed.success) return result

  for (const issue of parsed.error.issues) {
    const [rootKey, index, fieldKey] = issue.path
    if (rootKey !== 'incomes' || typeof index !== 'number' || (fieldKey !== 'name' && fieldKey !== 'amount')) continue
    const income = incomes[index]
    if (!income) continue
    const fields = result.get(income.id) ?? new Set<IncomeField>()
    fields.add(fieldKey)
    result.set(income.id, fields)
  }
  return result
}
