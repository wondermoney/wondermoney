import { budgetAccountsResponseSchema, budgetAccountsWriteSchema, budgetAddCategoryWriteSchema, budgetCreateResponseSchema, budgetCreateWriteSchema, budgetCategoryWriteSchema, budgetDetailResponseSchema, budgetInventoryEndpoint, budgetMetadataWriteSchema, budgetMonthResponseSchema, budgetsEndpoint, budgetsResponseSchema, budgetYearResponseSchema, createBudgetAccountsEndpoint, createBudgetAddCategoryEndpoint, createBudgetCategoryEndpoint, createBudgetDetailEndpoint, createBudgetEndpoint, createBudgetMetadataEndpoint, createBudgetMonthEndpoint, createBudgetYearEndpoint, createBudgetYearUntilMonthEndpoint, createDeleteBudgetCategoryForMonthEndpoint, createDeleteBudgetEndpoint, createRemoveBudgetCategoryEndpoint, createUpdateBudgetAccountsEndpoint, parseBudgetId } from './budgets-contract'
import { budgetFixture, childRow, parentRow } from './test-fixtures'

describe('budgets contracts', () => {
  it('pins both read-only endpoints and accepts documented nullable fields and raw income extras', () => {
    expect(budgetsEndpoint).toMatchObject({ method: 'GET', path: '/v1/budget/full' })
    expect(createBudgetMonthEndpoint(7, 2026, 1)).toMatchObject({ method: 'GET', path: '/v1/budget/7/2026/1' })
    const parsed = budgetsResponseSchema.parse({ budgets: [{ ...budgetFixture, incomes: [{ ...budgetFixture.incomes[0], budgetKey: { budgetKey: 7 } }] }] })
    expect(parsed.budgets[0].categories[0]).toMatchObject({ child_category_name: null, category_recurrency: null })
  })

  it.each([
    ['unsafe id', { ...budgetFixture, budgetKey: Number.MAX_SAFE_INTEGER + 1 }],
    ['bad month', { ...budgetFixture, month: 13 }],
    ['impractical year', { ...budgetFixture, year: 9999 }],
    ['lowercase currency', { ...budgetFixture, currencyCode: 'eur' }],
    ['nonfinite money', { ...budgetFixture, categories: [{ ...parentRow, category_amount: Infinity }] }],
    ['missing parent name', { ...budgetFixture, categories: [{ ...parentRow, parent_category_name: undefined }] }],
    ['bad recurrence', { ...budgetFixture, categories: [{ ...childRow, category_recurrency: 'WEEKLY' }] }],
    ['parent recurrence', { ...budgetFixture, categories: [{ ...parentRow, category_recurrency: 'MONTHLY' }] }],
    ['unexpected budget field', { ...budgetFixture, hidden: true }],
    ['unexpected category field', { ...budgetFixture, categories: [{ ...parentRow, hidden: true }] }],
  ])('rejects %s', (_label, candidate) => {
    expect(budgetsResponseSchema.safeParse({ budgets: [candidate] }).success).toBe(false)
  })

  it('requires strict navigation flags for month detail', () => {
    expect(budgetMonthResponseSchema.safeParse({ budget: budgetFixture, hasPreviousMonth: true, hasNextMonth: false }).success).toBe(true)
    expect(budgetMonthResponseSchema.safeParse({ budget: budgetFixture, hasPreviousMonth: true }).success).toBe(false)
  })

  it('accepts only positive safe route ids', () => {
    expect(parseBudgetId('42')).toBe(42)
    for (const value of ['0', '-1', '1.2', String(Number.MAX_SAFE_INTEGER + 1), ['2']]) expect(parseBudgetId(value)).toBeNull()
    expect(() => createBudgetMonthEndpoint(7, 2026, 0)).toThrow()
  })

  it('pins the authoritative detail GET and strict metadata-only PATCH', () => {
    expect(createBudgetDetailEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/budget/7' })
    expect(createBudgetMetadataEndpoint(7)).toMatchObject({ method: 'PATCH', path: '/v1/budget/7' })
    expect(createBudgetMetadataEndpoint(7).schema.safeParse(undefined).success).toBe(true)
    expect(createBudgetMetadataEndpoint(7).schema.safeParse({}).success).toBe(false)
    expect(budgetDetailResponseSchema.parse({ budget: { budgetKey: 7, name: 'Plan', description: null } })).toEqual({ budget: { budgetKey: 7, name: 'Plan', description: null } })
    expect(budgetDetailResponseSchema.safeParse({ budget: { budgetKey: 7, name: 'Plan' } }).success).toBe(true)
    expect(budgetDetailResponseSchema.safeParse({ budget: { budgetKey: 7, name: 'Plan', accounts: [] } }).success).toBe(false)
    expect(budgetMetadataWriteSchema.safeParse({ name: '', extra: true }).success).toBe(false)
    expect(budgetMetadataWriteSchema.safeParse({ name: 'n'.repeat(100), description: 'd'.repeat(500) }).success).toBe(true)
    expect(budgetMetadataWriteSchema.safeParse({ name: 'n'.repeat(101), description: '' }).success).toBe(false)
    expect(budgetMetadataWriteSchema.safeParse({ name: 'Plan', description: 'd'.repeat(501) }).success).toBe(false)
    expect(() => createBudgetDetailEndpoint(0)).toThrow()
    expect(() => createBudgetMetadataEndpoint(0)).toThrow()
  })

  it('pins the category PATCH path, required exact body, and undefined 200', () => {
    const endpoint = createBudgetCategoryEndpoint(7, 2026, 4, 11)
    expect(endpoint).toMatchObject({ method: 'PATCH', path: '/v1/budget/7/2026/4/11' })
    expect(endpoint.schema.safeParse(undefined).success).toBe(true)
    expect(endpoint.schema.safeParse({}).success).toBe(false)
    expect(budgetCategoryWriteSchema.parse({ amount: 120.5, recurrency: 'QUARTERLY', applyToFollowingMonths: false })).toEqual({ amount: 120.5, recurrency: 'QUARTERLY', applyToFollowingMonths: false })
    for (const body of [
      {},
      { amount: 0, recurrency: 'MONTHLY', applyToFollowingMonths: false },
      { amount: Infinity, recurrency: 'MONTHLY', applyToFollowingMonths: false },
      { amount: 1, recurrency: null, applyToFollowingMonths: false },
      { amount: 1, recurrency: 'WEEKLY', applyToFollowingMonths: false },
      { amount: 1, recurrency: 'MONTHLY' },
      { amount: 1, recurrency: 'MONTHLY', applyToFollowingMonths: false, extra: true },
    ]) expect(budgetCategoryWriteSchema.safeParse(body).success).toBe(false)
    for (const [budgetId, year, month, categoryId] of [[0, 2026, 4, 11], [7, 2026, 13, 11], [7, 2026, 4, 0]] as const) expect(() => createBudgetCategoryEndpoint(budgetId, year, month, categoryId)).toThrow()
  })

  it('pins strict budget creation, household bounds, and its key response', () => {
    expect(createBudgetEndpoint).toMatchObject({ method: 'POST', path: '/v1/budget' })
    expect(budgetInventoryEndpoint).toMatchObject({ method: 'GET', path: '/v1/budget' })
    const valid = { houseHoldSize: 4, dependentsNum: 2, incomes: [{ name: 'Salary', amount: 3000, isRecurrent: true, recurrency: 'MONTHLY' }] }
    expect(budgetCreateWriteSchema.safeParse(valid).success).toBe(true)
    expect(budgetCreateResponseSchema.parse({ budgetKey: 7 })).toEqual({ budgetKey: 7 })
    for (const body of [
      { ...valid, houseHoldSize: 0 }, { ...valid, houseHoldSize: 11 }, { ...valid, dependentsNum: 4 },
      { ...valid, incomes: [{ name: '', amount: 1, isRecurrent: true, recurrency: 'MONTHLY' }] },
      { ...valid, incomes: [{ name: 'Salary', amount: -1, isRecurrent: true, recurrency: 'MONTHLY' }] },
      { ...valid, incomes: [{ name: 'Salary', amount: 1, isRecurrent: true }] },
      { ...valid, extra: true },
    ]) expect(budgetCreateWriteSchema.safeParse(body).success).toBe(false)
    expect(budgetCreateResponseSchema.safeParse({ budgetKey: 7, extra: true }).success).toBe(false)
  })

  it('pins strict existing-category POST and undefined 201 body parsing', () => {
    const endpoint = createBudgetAddCategoryEndpoint(7)
    expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/budget/7/category' })
    expect(endpoint.schema.safeParse(undefined).success).toBe(true)
    expect(endpoint.schema.safeParse({}).success).toBe(false)
    expect(budgetAddCategoryWriteSchema.parse({ categoryKey: 12, amountBudgeted: 80, recurrency: 'QUARTERLY' })).toEqual({ categoryKey: 12, amountBudgeted: 80, recurrency: 'QUARTERLY' })
    for (const body of [{ categoryKey: 0, amountBudgeted: 1, recurrency: 'MONTHLY' }, { categoryKey: 1, amountBudgeted: 0, recurrency: 'MONTHLY' }, { categoryKey: 1, amountBudgeted: 1 }, { categoryKey: 1, amountBudgeted: 1, recurrency: 'WEEKLY' }]) expect(budgetAddCategoryWriteSchema.safeParse(body).success).toBe(false)
  })

  it('pins the whole-budget DELETE and rejects an invalid id', () => {
    const endpoint = createDeleteBudgetEndpoint(7)
    expect(endpoint).toMatchObject({ method: 'DELETE', path: '/v1/budget/7' })
    expect(endpoint.schema.safeParse(undefined).success).toBe(true)
    expect(endpoint.schema.safeParse({}).success).toBe(false)
    for (const id of [0, -1, 1.5]) expect(() => createDeleteBudgetEndpoint(id)).toThrow()
  })

  it('pins the single-month category DELETE distinct from the template PATCH', () => {
    const endpoint = createDeleteBudgetCategoryForMonthEndpoint(7, 2026, 4, 11)
    expect(endpoint).toMatchObject({ method: 'DELETE', path: '/v1/budget/7/2026/4/11' })
    for (const [budgetId, year, month, categoryId] of [[0, 2026, 4, 11], [7, 2026, 13, 11], [7, 2026, 4, 0]] as const) {
      expect(() => createDeleteBudgetCategoryForMonthEndpoint(budgetId, year, month, categoryId)).toThrow()
    }
  })

  it('pins the forward-only template category removal, never full history', () => {
    const endpoint = createRemoveBudgetCategoryEndpoint(7, 11)
    expect(endpoint).toMatchObject({ method: 'DELETE', path: '/v1/budget/7/category/11?deletePreviousMonths=false' })
    for (const [budgetId, categoryId] of [[0, 11], [7, 0]] as const) expect(() => createRemoveBudgetCategoryEndpoint(budgetId, categoryId)).toThrow()
  })

  it('pins the linked-accounts GET/PATCH pair and tolerates MikroORM relation metadata', () => {
    expect(createBudgetAccountsEndpoint(7)).toMatchObject({ method: 'GET', path: '/v1/budget/7/accounts' })
    expect(createUpdateBudgetAccountsEndpoint(7)).toMatchObject({ method: 'PATCH', path: '/v1/budget/7/accounts' })
    expect(() => createBudgetAccountsEndpoint(0)).toThrow()
    expect(() => createUpdateBudgetAccountsEndpoint(0)).toThrow()
    const parsed = budgetAccountsResponseSchema.parse({ accounts: [{ accountKey: 9, accountName: 'Daily account', extraRelationField: { odd: true } }, { accountKey: 10, accountName: null }] })
    expect(parsed.accounts).toEqual([
      { accountKey: 9, accountName: 'Daily account', extraRelationField: { odd: true } },
      { accountKey: 10, accountName: null },
    ])
    expect(budgetAccountsResponseSchema.safeParse({ accounts: [{ accountKey: 0, accountName: 'Bad' }] }).success).toBe(false)
  })

  it('pins the year and year-until-month GET paths and accepts the month-less budget shape', () => {
    expect(createBudgetYearEndpoint(7, 2026)).toMatchObject({ method: 'GET', path: '/v1/budget/7/2026' })
    expect(createBudgetYearUntilMonthEndpoint(7, 2026, 4)).toMatchObject({ method: 'GET', path: '/v1/budget/7/2026/until/4' })
    for (const [budgetId, year] of [[0, 2026], [7, 999]] as const) expect(() => createBudgetYearEndpoint(budgetId, year)).toThrow()
    for (const [budgetId, year, month] of [[0, 2026, 4], [7, 2026, 13]] as const) expect(() => createBudgetYearUntilMonthEndpoint(budgetId, year, month)).toThrow()
    const { month: _month, ...yearFixture } = budgetFixture
    const parsed = budgetYearResponseSchema.parse({ budget: { ...yearFixture, categories: [parentRow], accounts: [] } })
    expect(parsed.budget).not.toHaveProperty('month')
    expect(budgetYearResponseSchema.safeParse({ budget: { ...budgetFixture, categories: [parentRow], accounts: [] } }).success).toBe(false)
  })

  it('pins the strict account-keys write body', () => {
    expect(budgetAccountsWriteSchema.parse({ accountKeys: [9, 10] })).toEqual({ accountKeys: [9, 10] })
    expect(budgetAccountsWriteSchema.safeParse({ accountKeys: [] }).success).toBe(true)
    expect(budgetAccountsWriteSchema.safeParse({ accountKeys: [0] }).success).toBe(false)
    expect(budgetAccountsWriteSchema.safeParse({ accountKeys: [9], extra: true }).success).toBe(false)
  })
})
