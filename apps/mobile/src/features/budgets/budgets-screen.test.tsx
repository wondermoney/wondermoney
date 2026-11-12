import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert, StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetMonthScreen } from './budget-month-screen'
import { BudgetsScreen } from './budgets-screen'
import { mapBudget } from './budgets-view-model'
import { budgetFixture, childRow, parentRow, rolloverChildRow } from './test-fixtures'

const renderWithI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

/** Chooses the Alert button at `index` — the row's "…" menu, then the removal scope. */
const pressAlertButtons = (...indexes: number[]) => {
  const spy = jest.spyOn(Alert, 'alert')
  indexes.forEach((index) => spy.mockImplementationOnce((_title, _message, buttons) => { buttons?.[index]?.onPress?.() }))
  return spy
}

describe('budget screens', () => {
  afterEach(() => jest.restoreAllMocks())

  it('lists budgets as flat rows: name, progress and the facts that tell them apart; opens the month', async () => {
    const onOpenBudget = jest.fn()
    const view = await renderWithI18n(<BudgetsScreen state={{ status: 'loaded', budgets: [mapBudget(budgetFixture)] }} onOpenBudget={onOpenBudget} onRefresh={jest.fn()} onBack={jest.fn()} onCreateBudget={jest.fn()} />)
    expect(view.getByRole('header', { name: 'Budgets overview' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create budget' })).toBeOnTheScreen()
    expect(view.queryByText('Name')).not.toBeOnTheScreen()
    expect(view.getByText(/€2,000\.00 a month from Salary/)).toBeOnTheScreen()
    expect(view.getByText('120%')).toBeOnTheScreen()
    expect(StyleSheet.flatten(view.getByTestId('budget-progress-7').props.style).width).toBe('100%')
    const row = view.getByRole('button', { name: /Household plan.*Planned.*Spent.*Over budget/ })
    await fireEvent.press(row)
    expect(onOpenBudget).toHaveBeenCalledWith(7, 2026, 7)
  })

  it('exposes the editor from the list row menu and from month detail with named buttons', async () => {
    const editList = jest.fn()
    pressAlertButtons(0)
    const list = await renderWithI18n(<BudgetsScreen state={{ status: 'loaded', budgets: [mapBudget(budgetFixture)] }} onOpenBudget={jest.fn()} onEditBudget={editList} onRefresh={jest.fn()} onBack={jest.fn()} />)
    await fireEvent.press(list.getByRole('button', { name: 'Actions for Household plan' }))
    expect(editList).toHaveBeenCalledWith(7)
    list.unmount()
    const editMonth = jest.fn()
    const month = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(budgetFixture), hasPrevious: false, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} onEdit={editMonth} />)
    await fireEvent.press(month.getByRole('button', { name: 'Edit budget details' }))
    expect(editMonth).toHaveBeenCalled()
  })

  it('provides a guarded creation action in the empty state', async () => {
    const create = jest.fn()
    const view = await renderWithI18n(<BudgetsScreen state={{ status: 'loaded', budgets: [] }} onOpenBudget={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateBudget={create} />)
    expect(view.getByText('Budget with the envelope method')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create your first budget' }))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('shows stale data as an alert and exposes a retryable invalid response', async () => {
    const stale = await renderWithI18n(<BudgetsScreen state={{ status: 'refresh-error', budgets: [mapBudget(budgetFixture)] }} onOpenBudget={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} />)
    expect(stale.getByRole('alert', { name: /previously loaded budgets/ })).toBeOnTheScreen()
    stale.unmount()
    const invalid = await renderWithI18n(<BudgetsScreen state={{ status: 'invalid-response' }} onOpenBudget={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} />)
    expect(invalid.getByRole('header', { name: 'Could not verify budget data' })).toBeOnTheScreen()
    expect(invalid.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()
  })

  it('leads the month with what is left (or over), then spent, planned and over-plan lines', async () => {
    const value = mapBudget(budgetFixture, { year: 2026, month: 7 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: false, hasNext: true }} yearTotals={{ planned: 1200, spent: 600 }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByLabelText('Over plan in July by, €20.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Over plan, 1 line')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Previous month' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Next month' }).props.accessibilityState.disabled).toBe(false)
    expect(view.getByText('Overview')).toBeOnTheScreen()
    expect(view.getByText('Year')).toBeOnTheScreen()
  })

  it('shows every subcategory directly with its figures, recurrence and measure', async () => {
    const value = mapBudget(budgetFixture, { year: 2026, month: 7 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: false, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByText('Rent')).toBeOnTheScreen()
    expect(view.getByText(/of .* spent · 12x per year/)).toBeOnTheScreen()
    expect(view.getAllByText('120%').length).toBeGreaterThan(0)
    expect(view.getAllByText(/-€20\.00/).length).toBeGreaterThan(0)
    expect(view.getByTestId('budget-child-progress-11-over')).toBeOnTheScreen()
    expect(view.getByText(/may not be exhaustive/)).toBeOnTheScreen()
  })

  it('shows normalized child planned, remaining, and progress values', async () => {
    const quarterly = {
      ...budgetFixture,
      categories: [
        { ...parentRow, category_amount: 50 },
        { ...childRow, category_budgeted_amount: 120, category_amount: 50, category_recurrency: 'QUARTERLY' as const },
      ],
    }
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(quarterly), hasPrevious: false, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByText(/4x per year/)).toBeOnTheScreen()
    expect(view.getAllByText(/€40\.00/).length).toBeGreaterThan(0)
    expect(view.getAllByText(/-€10\.00/).length).toBeGreaterThan(0)
    expect(view.getAllByText('125%').length).toBeGreaterThan(0)
  })

  it('shows what last month carried under each line and measures against it', async () => {
    const carried = { ...budgetFixture, categories: [{ ...parentRow, category_amount: 120 }, rolloverChildRow(40, { category_amount: 120 })] }
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(carried), hasPrevious: true, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByTestId('budget-rollover-11')).toHaveTextContent('+€40.00 from last month')
    expect(view.getByTestId('budget-rollover-10')).toHaveTextContent('+€40.00 from last month')
    expect(view.getAllByText('€120.00 of €140.00 spent · 12x per year').length).toBe(1)
    expect(view.getByLabelText('Left in July, €20.00')).toBeOnTheScreen()

    const overspent = { ...budgetFixture, categories: [{ ...parentRow, category_amount: 0 }, { ...rolloverChildRow(-25, { category_amount: 0 }), category_rollover_incomplete: true }] }
    const second = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(overspent), hasPrevious: true, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    const line = second.getByTestId('budget-rollover-11')
    expect(line).toHaveTextContent(/−€25\.00 overspent last month/)
    expect(line.props.accessibilityLabel).toMatch(/^−€25\.00 overspent last month\. May be too high/)
  })

  it('prints no carried line when nothing rolled over', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(budgetFixture), hasPrevious: false, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByTestId('budget-rollover-11')).toBeNull()
    expect(view.queryByText(/from last month/)).toBeNull()
  })

  it('shows the days under the month name when the budget month starts on a later day', async () => {
    const payday = mapBudget({ ...budgetFixture, period: { firstDay: '2026-06-25', lastDay: '2026-07-24' }, periodStartDay: 25 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: payday, hasPrevious: false, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByText(/^Jun 25\s–\sJul 24$/u)).toBeOnTheScreen()
    expect(view.getByRole('header', { name: /^Budget period, July 2026, Jun 25\s–\sJul 24$/u })).toBeOnTheScreen()
  })

  it('shows only the month name for a calendar month', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(budgetFixture), hasPrevious: false, hasNext: false }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByText(/Jul 1\s–\sJul 31/u)).toBeNull()
    expect(view.getByRole('header', { name: 'Budget period, July 2026' })).toBeOnTheScreen()
  })

  it('offers category editing only on child rows, never parent aggregate ids', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} categoryPending={false} onSaveCategory={save} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Actions for Home' })).not.toBeOnTheScreen()
    const alert = pressAlertButtons(0)
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Rent' }))
    expect(alert.mock.calls[0]?.[2]?.[0]?.text).toBe('Edit Rent budget')
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('100')
    expect(view.getByText(/raw amount for one occurrence/i)).toBeOnTheScreen()
  })

  it('locks month navigation, back, view switching, metadata editing, and category rows during category save', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(budgetFixture), hasPrevious: true, hasNext: true }} categoryPending onSaveCategory={jest.fn()} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} onEdit={jest.fn()} onManageAccounts={jest.fn()} onAddCategory={jest.fn()} />)
    expect(view.getByRole('button', { name: 'Back' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Previous month' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Next month' }).props.accessibilityState.disabled).toBe(true)
    // Edit and the linked accounts share the title row's overflow menu, locked as a whole.
    expect(view.getByRole('button', { name: 'More actions' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByTestId('budget-add-category').props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Actions for Rent' }).props.accessibilityState.disabled).toBe(true)
  })

  it('offers linked-account management only when a handler is provided, with the editable note', async () => {
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const readOnly = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(readOnly.queryByRole('button', { name: 'Account linked' })).not.toBeOnTheScreen()
    expect(readOnly.getByText(/cannot be changed here/)).toBeOnTheScreen()
    readOnly.unmount()

    const manage = jest.fn()
    const editable = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onManageAccounts={manage} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(editable.queryByText(/cannot be changed here/)).not.toBeOnTheScreen()
    expect(editable.getByText(/feed this budget across every month/)).toBeOnTheScreen()
    await fireEvent.press(editable.getByRole('button', { name: 'Account linked' }))
    expect(manage).toHaveBeenCalledTimes(1)
  })

  it('lists editing and the linked accounts behind one overflow menu when both are offered, and adds a category from the floating "+"', async () => {
    const edit = jest.fn()
    const manage = jest.fn()
    const add = jest.fn()
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onEdit={edit} onManageAccounts={manage} onAddCategory={add} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Edit budget details' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Edit budget details' }))
    expect(edit).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Account linked' }))
    expect(manage).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Add existing category' }))
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('says "Link account" when no account feeds the budget', async () => {
    const value = mapBudget({ ...budgetFixture, accounts: [] }, { year: 2028, month: 4 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onManageAccounts={jest.fn()} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getByRole('button', { name: 'Link account' })).toBeOnTheScreen()
  })

  it('offers the Month | Year control only when a year handler is provided', async () => {
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const readOnly = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(readOnly.queryByRole('tab', { name: 'Year' })).not.toBeOnTheScreen()
    readOnly.unmount()

    const viewYear = jest.fn()
    const withYear = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onViewYear={viewYear} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(withYear.getByRole('tab', { name: 'Month' }).props.accessibilityState.selected).toBe(true)
    await fireEvent.press(withYear.getByRole('tab', { name: 'Month' }))
    expect(viewYear).not.toHaveBeenCalled()
    await fireEvent.press(withYear.getByRole('tab', { name: 'Year' }))
    expect(viewYear).toHaveBeenCalledTimes(1)
  })

  it('does not show a dead retry for an invalid route', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'invalid-route' }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back to Budgets' })).toBeOnTheScreen()
  })

  describe('category removal', () => {
    it('does not offer removal when no handler is provided', async () => {
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      expect(view.queryByRole('button', { name: 'Actions for Rent' })).not.toBeOnTheScreen()
    })

    it('removes for this month only when that scope is chosen', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      const alert = pressAlertButtons(0, 1)
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Rent' }))
      expect(alert.mock.calls[0]?.[2]?.[0]?.text).toBe('Remove Rent')
      expect(remove).toHaveBeenCalledWith(11, 'month')
    })

    it('removes going forward when that scope is chosen', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      pressAlertButtons(0, 2)
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Rent' }))
      expect(remove).toHaveBeenCalledWith(11, 'forward')
    })

    it('does not remove when the confirmation is cancelled', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      pressAlertButtons(0, 0)
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Rent' }))
      expect(remove).not.toHaveBeenCalled()
    })

    it('shows a scoped failure message for a rejected removal, without disturbing edit', async () => {
      const remove = jest.fn().mockRejectedValue(new Error('boom'))
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onSaveCategory={jest.fn()} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      pressAlertButtons(1, 1)
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Rent' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be removed/i)
      expect(view.getByRole('button', { name: 'Actions for Rent' })).toBeOnTheScreen()
    })
  })
})
