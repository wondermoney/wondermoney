import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { BudgetCategoryEditor, parseRawBudgetAmount } from './budget-category-editor'
import { mapBudget } from './budgets-view-model'
import { budgetFixture, childRow, parentRow, rolloverChildRow } from './test-fixtures'

const child = mapBudget(budgetFixture).categories[0].children[0]

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof BudgetCategoryEditor>> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof BudgetCategoryEditor> = { child, currency: 'EUR', year: 2026, month: 4, locale: 'en', pending: false, palette: themeTokens.colors.light, onSave: jest.fn().mockResolvedValue(undefined), onCancel: jest.fn(), ...overrides }
  return { props, i18n, view: await render(<I18nextProvider i18n={i18n}><BudgetCategoryEditor {...props} /></I18nextProvider>) }
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

  it('saves the rollover switch with rolloverEnabled, and leaves it out when unchanged', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSave: save })
    const toggle = view.getByRole('switch', { name: 'Roll over leftover to next month' })
    expect(toggle.props.value).toBe(false)
    await fireEvent(toggle, 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ amount: 100, recurrency: 'MONTHLY', applyToFollowingMonths: false, rolloverEnabled: true }))

    const unchanged = jest.fn().mockResolvedValue(undefined)
    const enabled = mapBudget({ ...budgetFixture, categories: [parentRow, rolloverChildRow(0)] }).categories[0].children[0]
    const second = await renderEditor({ child: enabled, onSave: unchanged })
    expect(second.view.getByRole('switch', { name: 'Roll over leftover to next month' }).props.value).toBe(true)
    await fireEvent.press(second.view.getByRole('button', { name: 'Save category budget' }))
    await waitFor(() => expect(unchanged).toHaveBeenCalledWith({ amount: 100, recurrency: 'MONTHLY', applyToFollowingMonths: false }))
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

  it('confirms applying the change from the selected month onward', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view, i18n } = await renderEditor({ onSave: save })
    await fireEvent.press(view.getByRole('radio', { name: i18n.t('budgetCategory.scopeForward') }))
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ amount: 100, recurrency: 'MONTHLY', applyToFollowingMonths: true }))
    expect(alert.mock.calls[0][1]).toContain('April 2026')
  })

  it('retains December input on ambiguous failure after confirming forward scope', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const { view, i18n } = await renderEditor({ month: 12, onSave: save })
    await fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '77,5')
    await fireEvent.press(view.getByRole('radio', { name: i18n.t('budgetCategory.scopeForward') }))
    await fireEvent.press(view.getByRole('button', { name: 'Save category budget' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('77,5')
    expect(alert.mock.calls[0][1]).toContain('December 2026')
  })

  it('locks amount, recurrence, scope, save and cancel while pending and rejects unsafe amounts', async () => {
    const { view } = await renderEditor({ pending: true })
    expect(view.getByLabelText('Amount per occurrence').props.editable).toBe(false)
    expect(view.getByRole('radio', { name: 'Monthly' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('radio', { name: 'Selected month only' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
    expect(parseRawBudgetAmount('0', 'en')).toBeNull()
    expect(parseRawBudgetAmount('-2', 'en')).toBeNull()
    expect(parseRawBudgetAmount('Infinity', 'en')).toBeNull()
    expect(parseRawBudgetAmount('1.2.3', 'pt-PT')).toBeNull()
    expect(parseRawBudgetAmount('1.25', 'en')).toBe(1.25)
    expect(parseRawBudgetAmount('1.234,56', 'pt-PT')).toBe(1234.56)
    expect(parseRawBudgetAmount('1.000', 'es')).toBe(1000)
    expect(parseRawBudgetAmount('1.000', 'en')).toBe(1)
  })

  it('shows the spending suggestion and applies it to the amount', async () => {
    const { view } = await renderEditor({ suggestion: { average: 100, categoryKey: child.id, categoryName: child.name, hasEnoughData: true, median: 100, monthsWithData: 3, suggested: 105 } })

    expect(view.getByText(/Suggested from your spending/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('105')
  })

  it('says when there is not enough history for a suggestion', async () => {
    const { view } = await renderEditor({ suggestion: { average: 100, categoryKey: child.id, categoryName: child.name, hasEnoughData: false, median: 100, monthsWithData: 1, suggested: null } })

    expect(view.getByText(/Not enough history yet for a suggestion/)).toBeOnTheScreen()
  })
})
