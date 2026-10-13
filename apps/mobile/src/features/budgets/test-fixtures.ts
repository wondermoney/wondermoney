import type { BudgetDto, BudgetYearDto } from './budgets-contract'

export const parentRow = {
  category_amount: 120,
  category_bg_color: '#fff',
  category_budgeted_amount: 100,
  category_icon: null,
  category_is_system_category: true,
  category_key: 10,
  category_recurrency: null,
  category_text_color: '#000',
  child_category_name: null,
  parent_category_name: 'Home',
} as const

export const childRow = {
  ...parentRow,
  category_amount: 120,
  category_budgeted_amount: 100,
  category_key: 11,
  category_recurrency: 'MONTHLY' as const,
  child_category_name: 'Rent',
}

export const budgetFixture: BudgetDto = {
  accounts: [{ accountKey: 4, accountName: 'Daily account' }],
  budgetKey: 7,
  categories: [parentRow, childRow],
  currencyCode: 'EUR',
  description: null,
  incomes: [{ amount: 2000, budgetTemplateIncomeKey: 2, name: 'Salary', recurrency: 'MONTHLY' }],
  month: 7,
  name: 'Household plan',
  year: 2026,
}

export const budgetYearFixture: BudgetYearDto = {
  accounts: [{ accountKey: 4, accountName: 'Daily account' }],
  budgetKey: 7,
  categories: [
    { ...parentRow, category_amount: 1_200, category_budgeted_amount: 1_200 },
    { ...childRow, category_amount: 1_200, category_budgeted_amount: 1_200 },
  ],
  currencyCode: 'EUR',
  description: null,
  incomes: [{ amount: 2000, budgetTemplateIncomeKey: 2, name: 'Salary', recurrency: 'MONTHLY' }],
  name: 'Household plan',
  year: 2026,
}
