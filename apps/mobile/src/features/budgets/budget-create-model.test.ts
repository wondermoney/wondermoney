import { createBudgetPayload, monthlyEquivalent, monthlyEquivalentTotal, newBudgetCandidates, type EditableIncome } from './budget-create-model'

const income = (patch: Partial<EditableIncome> = {}): EditableIncome => ({ id: '1', name: 'Salary', amount: '1200', isRecurrent: true, recurrency: 'MONTHLY', ...patch })

describe('budget creation income math', () => {
  it.each([
    ['MONTHLY', 1200], ['MONTHLY_14', 1400], ['QUARTERLY', 400], ['BI_ANNUALLY', 200], ['ANNUALLY', 100],
  ] as const)('submits one monthly-equivalent value for %s without double normalization', (recurrency, expected) => {
    expect(monthlyEquivalent(1200, true, recurrency)).toBe(expected)
    expect(createBudgetPayload(2, 0, [income({ recurrency })]).incomes[0].amount).toBe(expected)
  })

  it('annualizes one-time income over twelve months and totals the review values', () => {
    const rows = [income(), income({ id: '2', name: 'Bonus', isRecurrent: false, recurrency: 'ANNUALLY' })]
    expect(monthlyEquivalentTotal(rows)).toBe(1300)
    expect(createBudgetPayload(3, 1, rows)).toEqual({ houseHoldSize: 3, dependentsNum: 1, incomes: [{ name: 'Salary', amount: 1200, isRecurrent: true, recurrency: 'MONTHLY' }, { name: 'Bonus', amount: 100, isRecurrent: false }] })
  })

  it.each([[[], 0], [[8], 1], [[8, 9], 2]] as const)('reports zero, one, or multiple new candidates without inferring success: %j', (ids, count) => {
    const budgets = [7, ...ids].map((budgetKey) => ({ budgetKey, name: `Budget ${budgetKey}`, budgetTemplates: [] }))
    expect(newBudgetCandidates({ budgets }, new Set([7]))).toHaveLength(count)
  })
})
