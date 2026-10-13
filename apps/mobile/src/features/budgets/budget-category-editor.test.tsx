import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { BudgetCategoryEditor, monthsInCategoryScope, parseRawBudgetAmount } from './budget-category-editor'
import { mapBudget } from './budgets-view-model'
import { budgetFixture, childRow } from './test-fixtures'

const child = mapBudget(budgetFixture).categories[0].children[0]

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof BudgetCategoryEditor>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof BudgetCategoryEditor> = { child, year: 2026, month: 4, locale: 'en', pending: false, palette: themeTokens.colors.light, onSave: jest.fn().mockResolvedValue(undefined), onCancel: jest.fn(), ...overrides }
  return { props, view: await render(<I18nextProvider i18n={i18n}><BudgetCategoryEditor {...props} /></I18nextProvider>) }
}

describe('budget child-category editor', () => {
  afterEach(() => jest.restoreAllMocks())

  it('defaults safely to one month and submits raw amount with exact recurrence and explicit false', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const alert = jest.spyOn(Alert, 'alert')
    const { view } = await renderEditor({ onSave: save })
    expect(view.getByRole('radio', { name: 'Selected month only' }).props.accessibilityState.checked).toBe(true)
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('100')
    await fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '125.50')
    await fireEvent.press(view.getByRole('radio', { name: 'Quarterly' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ amount: 125.5, recurrency: 'QUARTERLY', applyToFollowingMonths: false }))
    expect(alert).not.toHaveBeenCalled()
  })

  it('requires an explicit recurrence for legacy null rows and exposes every exact recurrence', async () => {
    const legacy = mapBudget({ ...budgetFixture, categories: [budgetFixture.categories[0], { ...childRow, category_recurrency: null }] }).categories[0].children[0]
    const { view } = await renderEditor({ child: legacy })
    expect(view.getByText(/no saved recurrence/i)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save category budget' }).props.accessibilityState.disabled).toBe(true)
    for (const label of ['14 times a year', 'Monthly', 'Quarterly', 'Twice a year', 'Yearly']) expect(view.getByRole('radio', { name: label })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('radio', { name: 'Yearly' }))
    expect(view.getByRole('button', { name: 'Save category budget' }).props.accessibilityState.disabled).toBe(false)
  })

  it('confirms the route-year forward range/count and states protected data does not change', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderEditor({ onSave: save })
    await fireEvent.press(view.getByRole('radio', { name: 'Selected month through December (9 months)' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ amount: 100, recurrency: 'MONTHLY', applyToFollowingMonths: true }))
    expect(alert.mock.calls[0][1]).toMatch(/April 2026 through December 2026 \(9 months\)/)
    expect(alert.mock.calls[0][1]).toMatch(/Earlier months, future years, account balances, and spending transactions will not change/)
  })

  it('counts December as one forward month and retains input on ambiguous failure', async () => {
    expect(monthsInCategoryScope(12, 'through-december')).toBe(1)
    expect(monthsInCategoryScope(7, 'month')).toBe(1)
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const { view } = await renderEditor({ month: 12, onSave: save })
    await fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '77,5')
    await fireEvent.press(view.getByRole('radio', { name: 'Selected month through December (1 month)' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('77,5')
    expect(alert.mock.calls[0][1]).toMatch(/December 2026 through December 2026 \(1 month\)/)
  })

  it('locks amount, recurrence, scope, save and cancel while pending and rejects unsafe amounts', async () => {
    const { view } = await renderEditor({ pending: true })
    expect(view.getByLabelText('Amount per occurrence').props.editable).toBe(false)
    expect(view.getByRole('radio', { name: 'Monthly' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('radio', { name: 'Selected month only' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
    expect(parseRawBudgetAmount('0')).toBeNull()
    expect(parseRawBudgetAmount('-2')).toBeNull()
    expect(parseRawBudgetAmount('Infinity')).toBeNull()
    expect(parseRawBudgetAmount('1.25')).toBe(1.25)
  })
})
