import { budgetsResponseSchema, type BudgetRecurrence } from './budgets-contract'
import { adjacentBudgetPeriod, budgetPeriodLabel, budgetYearToDateMonth, mapBudget, mapBudgetYear, normalizePlannedMonthly } from './budgets-view-model'
import { budgetFixture, budgetYearFixture, childRow, parentRow, rolloverChildRow } from './test-fixtures'

const child = (
  id: number,
  parentName: string,
  rawPlanned: number,
  recurrence: BudgetRecurrence | null,
  spent: number,
) => ({
  ...childRow,
  category_key: id,
  parent_category_name: parentName,
  child_category_name: `Child ${id}`,
  category_budgeted_amount: rawPlanned,
  category_recurrency: recurrence,
  category_amount: spent,
})

describe('budget recurrence normalization', () => {
  it.each([
    ['MONTHLY_14', 140],
    ['MONTHLY', 120],
    ['QUARTERLY', 40],
    ['BI_ANNUALLY', 20],
    ['ANNUALLY', 10],
    [null, 10],
  ] as const)('normalizes %s using the API occurrence semantics', (recurrence, expected) => {
    expect(normalizePlannedMonthly(120, recurrence)).toBe(expected)
  })
})

describe('budget view model', () => {
  it('derives mixed group plans from normalized children and uses parent spent once', () => {
    const categories = [
      { ...parentRow, category_amount: 100, category_budgeted_amount: 1_000 },
      child(11, 'Home', 120, 'MONTHLY', 60),
      child(12, 'Home', 120, 'QUARTERLY', 30),
      child(13, 'Home', 120, 'ANNUALLY', 10),
    ]
    const value = mapBudget({ ...budgetFixture, categories })
    expect(value.categories[0]).toMatchObject({ planned: 170, spent: 100, remaining: 70, progressPercentage: 100 / 1.7 })
    expect(value.categories[0].children.map(({ planned, remaining }) => ({ planned, remaining }))).toEqual([
      { planned: 120, remaining: 60 },
      { planned: 40, remaining: 10 },
      { planned: 10, remaining: 0 },
    ])
    expect(value.totals).toMatchObject({ planned: 170, spent: 100, remaining: 70 })
  })

  it('measures remaining, progress and over against the available amount when rollover carries', () => {
    const surplus = mapBudget({ ...budgetFixture, categories: [{ ...parentRow, category_amount: 120 }, rolloverChildRow(40, { category_amount: 120 })] })
    const [rent] = surplus.categories[0].children
    expect(rent).toMatchObject({ budgeted: 100, rolledOver: 40, planned: 140, remaining: 20, overspent: false, rolloverEnabled: true, rolloverIncomplete: false })
    expect(rent.progressPercentage).toBeCloseTo(120 / 1.4)
    expect(surplus.categories[0]).toMatchObject({ budgeted: 100, rolledOver: 40, planned: 140, remaining: 20, overspent: false, rolloverEnabled: true })
    expect(surplus.totals).toMatchObject({ planned: 140, spent: 120, remaining: 20, overspent: false })

    const overspent = mapBudget({ ...budgetFixture, categories: [{ ...parentRow, category_amount: 80 }, { ...rolloverChildRow(-25, { category_amount: 80 }), category_rollover_incomplete: true }] })
    expect(overspent.categories[0].children[0]).toMatchObject({ budgeted: 100, rolledOver: -25, planned: 75, remaining: -5, overspent: true, rolloverIncomplete: true })
    expect(overspent.categories[0]).toMatchObject({ rolledOver: -25, planned: 75, overspent: true, rolloverIncomplete: true })
  })

  it('adds the rollover to the recurrence-normalized plan, not the raw amount', () => {
    const value = mapBudget({ ...budgetFixture, categories: [parentRow, rolloverChildRow(15, { category_budgeted_amount: 120, category_recurrency: 'QUARTERLY', category_amount: 0 })] })
    expect(value.categories[0].children[0]).toMatchObject({ rawAmount: 120, budgeted: 40, rolledOver: 15, planned: 55 })
  })

  it('reads a budget without rollover exactly as before', () => {
    const value = mapBudget(budgetFixture)
    expect(value.rolloverCarriesOverspend).toBe(true)
    expect(value.categories[0].children[0]).toMatchObject({ budgeted: 100, rolledOver: 0, planned: 100, remaining: -20, rolloverEnabled: false })
  })

  it('produces consistent list and detail plans despite different API parent values', () => {
    const children = [child(11, 'Home', 120, 'MONTHLY', 50), child(12, 'Home', 120, 'QUARTERLY', 20)]
    const full = mapBudget({ ...budgetFixture, categories: [{ ...parentRow, category_budgeted_amount: 240, category_amount: 70 }, ...children] })
    const detail = mapBudget({ ...budgetFixture, categories: [{ ...parentRow, category_budgeted_amount: 160, category_amount: 70 }, ...children] }, { year: 2026, month: 7 })
    expect(full.totals).toEqual(detail.totals)
    expect(full.categories[0].planned).toBe(160)
    expect(detail.categories[0].planned).toBe(160)
  })

  it('retains raw per-occurrence child amounts separately and never marks parent aggregates as editable children', () => {
    const value = mapBudget({ ...budgetFixture, categories: [{ ...parentRow, category_budgeted_amount: 999 }, child(11, 'Home', 120, 'QUARTERLY', 30), child(12, 'Home', 75, null, 10)] })
    expect(value.categories[0].children.map(({ id, rawAmount, planned, recurrence }) => ({ id, rawAmount, planned, recurrence }))).toEqual([
      { id: 11, rawAmount: 120, planned: 40, recurrence: 'QUARTERLY' },
      { id: 12, rawAmount: 75, planned: 6.25, recurrence: null },
    ])
    expect(value.categories[0]).not.toHaveProperty('rawAmount')
  })

  it('keeps zero normalized plans unavailable while preserving overspend and negative remaining', () => {
    const value = mapBudget({
      ...budgetFixture,
      categories: [
        { ...parentRow, category_amount: 4, category_budgeted_amount: 999 },
        child(11, 'Home', 0, 'MONTHLY_14', 4),
      ],
    })
    expect(value.totals).toMatchObject({ planned: 0, spent: 4, remaining: -4, progressPercentage: null, meterPercentage: 0, overspent: true })
    expect(value.categories[0].children[0]).toMatchObject({ planned: 0, spent: 4, remaining: -4, progressPercentage: null, meterPercentage: 0, overspent: true })
  })

  it('keeps positive overspend progress honest while clamping only the meter', () => {
    const value = mapBudget(budgetFixture)
    expect(value.totals).toMatchObject({ remaining: -20, overspent: true, progressPercentage: 120, meterPercentage: 100 })
    expect(value.categories[0].children[0]).toMatchObject({ remaining: -20, progressPercentage: 120, meterPercentage: 100 })
  })

  it('uses requested detail period over inconsistent response metadata and deduplicates account context', () => {
    const value = mapBudget({ ...budgetFixture, year: 2022, month: 2, accounts: [...budgetFixture.accounts, ...budgetFixture.accounts] }, { year: 2027, month: 9 })
    expect(value).toMatchObject({ year: 2027, month: 9 })
    expect(value.accounts).toHaveLength(1)
  })

  it('rolls month navigation across years', () => {
    expect(adjacentBudgetPeriod(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(adjacentBudgetPeriod(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(adjacentBudgetPeriod(2026, 7, 1)).toEqual({ year: 2026, month: 8 })
  })
})

describe('budget year view model', () => {
  it('reuses month recurrence normalization unchanged on pre-summed category rows', () => {
    const value = mapBudgetYear(budgetYearFixture)
    // A category budgeted at 1200/year (already summed across 12 monthly rows of 100 each) with
    // MONTHLY recurrence normalizes back to 1200 for the year, matching the true annual total.
    expect(value.categories[0].children[0]).toMatchObject({ planned: 1200, spent: 1200, remaining: 0, overspent: false })
    expect(value.totals).toMatchObject({ planned: 1200, spent: 1200 })
  })

  it('annualizes each already-monthly-equivalent income without reapplying recurrence', () => {
    const value = mapBudgetYear(budgetYearFixture)
    expect(value.totalIncome).toBe(24_000)
    const value2 = mapBudgetYear({ ...budgetYearFixture, incomes: [{ amount: 2000, name: 'Salary', recurrency: 'MONTHLY' }, { amount: 500, name: 'Freelance', recurrency: 'MONTHLY' }] })
    expect(value2.totalIncome).toBe(30_000)
  })

  it('has no month field, uses the requested year over inconsistent response metadata, and deduplicates accounts', () => {
    const value = mapBudgetYear({ ...budgetYearFixture, year: 2020, accounts: [...budgetYearFixture.accounts, ...budgetYearFixture.accounts] }, 2027)
    expect(value).not.toHaveProperty('month')
    expect(value.year).toBe(2027)
    expect(value.accounts).toHaveLength(1)
  })

  it('falls back to response year when no authoritative year is given', () => {
    expect(mapBudgetYear(budgetYearFixture).year).toBe(2026)
  })
})

describe('budgetYearToDateMonth', () => {
  const november2026 = new Date(2026, 10, 5)

  it('stops the current year at the current month', () => {
    expect(budgetYearToDateMonth(2026, november2026)).toBe(11)
  })

  it('covers every month of a past year', () => {
    expect(budgetYearToDateMonth(2025, november2026)).toBe(12)
  })

  it('has no year to date for a year that has not started', () => {
    expect(budgetYearToDateMonth(2027, november2026)).toBeNull()
  })
})

describe('budget period label', () => {
  // Intl puts thin and narrow spaces in some locales; compare the words.
  const label = (...args: Parameters<typeof budgetPeriodLabel>) => budgetPeriodLabel(...args)?.replace(/\s/gu, ' ') ?? null

  it('shows the days of a month that starts on payday', () => {
    expect(label({ period: { firstDay: '2026-10-25', lastDay: '2026-11-24' }, periodStartDay: 25 }, 'en')).toBe('Oct 25 – Nov 24')
    // Each locale writes the days its own way (ICU versions differ too); the two days are there.
    expect(label({ period: { firstDay: '2026-10-25', lastDay: '2026-11-24' }, periodStartDay: 25 }, 'pt-PT')).toMatch(/^25\D.* – 24\D/u)
  })

  it('names both years for a month across the new year', () => {
    expect(label({ period: { firstDay: '2026-12-25', lastDay: '2027-01-24' }, periodStartDay: 25 }, 'es')).toBe('25 dic 2026 – 24 ene 2027')
  })

  it('says nothing for a calendar month, or when the server does not send the days', () => {
    expect(label({ period: { firstDay: '2026-11-01', lastDay: '2026-11-30' }, periodStartDay: 1 }, 'en')).toBeNull()
    expect(label({ period: null, periodStartDay: 25 }, 'en')).toBeNull()
  })

  it('maps the start day and days from the API, the calendar month when a server sends neither', () => {
    expect(mapBudget({ ...budgetFixture, period: { firstDay: '2026-06-25', lastDay: '2026-07-24' }, periodStartDay: 25 })).toMatchObject({ period: { firstDay: '2026-06-25', lastDay: '2026-07-24' }, periodStartDay: 25 })
    const { period: _period, ...older } = budgetFixture
    expect(mapBudget(budgetsResponseSchema.parse({ budgets: [{ ...older, periodStartDay: undefined }] }).budgets[0]!)).toMatchObject({ period: null, periodStartDay: 1 })
  })
})
