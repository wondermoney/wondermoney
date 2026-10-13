import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert, StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetMonthScreen } from './budget-month-screen'
import { BudgetsScreen } from './budgets-screen'
import { mapBudget } from './budgets-view-model'
import { budgetFixture, childRow, parentRow } from './test-fixtures'

const renderWithI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('budget screens', () => {
  it('shows an honest overspent list summary and opens its month', async () => {
    const onOpenBudget = jest.fn()
    const view = await renderWithI18n(<BudgetsScreen state={{ status: 'loaded', budgets: [mapBudget(budgetFixture)] }} onOpenBudget={onOpenBudget} onRefresh={jest.fn()} onBack={jest.fn()} />)
    const row = view.getByRole('button', { name: /Household plan.*Planned.*Spent.*Remaining.*Over budget/ })
    expect(view.getByText('Over budget')).toBeOnTheScreen()
    expect(StyleSheet.flatten(row.props.style).borderRadius).toBeGreaterThan(0)
    // Categories show directly on the list, matching web's Budgets screen —
    // not only behind the per-budget detail drill-in. See DESIGN_HISTORY.md.
    expect(view.getByText('Home')).toBeOnTheScreen()
    await fireEvent.press(row)
    expect(onOpenBudget).toHaveBeenCalledWith(7, 2026, 7)
  })

  it('exposes the editor from both the list and month detail with named buttons', async () => {
    const editList = jest.fn()
    const list = await renderWithI18n(<BudgetsScreen state={{ status: 'loaded', budgets: [mapBudget(budgetFixture)] }} onOpenBudget={jest.fn()} onEditBudget={editList} onRefresh={jest.fn()} onBack={jest.fn()} />)
    await fireEvent.press(list.getByRole('button', { name: 'Edit budget' }))
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
    expect(view.getByText('No current budget')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create budget' }))
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

  it('expands category details, preserves negative values, and labels account context as partial', async () => {
    const value = mapBudget(budgetFixture, { year: 2026, month: 7 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: false, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.getAllByText('-€20.00').length).toBeGreaterThan(0)
    expect(view.getByRole('button', { name: 'Previous' }).props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
    expect(view.getByText('Rent')).toBeOnTheScreen()
    expect(view.getByText('Monthly')).toBeOnTheScreen()
    expect(view.getByText('120% spent')).toBeOnTheScreen()
    expect(StyleSheet.flatten(view.getByTestId('budget-child-progress-11').props.style).width).toBe('100%')
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
    await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
    expect(view.getByText('Quarterly')).toBeOnTheScreen()
    expect(view.getAllByText('€40.00').length).toBeGreaterThan(0)
    expect(view.getAllByText('-€10.00').length).toBeGreaterThan(0)
    expect(view.getByText('125% spent')).toBeOnTheScreen()
  })

  it('offers category editing only on expanded child rows, never parent aggregate ids', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} categoryPending={false} onSaveCategory={save} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Edit Home budget' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
    await fireEvent.press(view.getByRole('button', { name: 'Edit Rent budget' }))
    expect(view.getByLabelText('Amount per occurrence').props.value).toBe('100')
    expect(view.getByText(/raw amount for one occurrence/i)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Edit Home budget' })).not.toBeOnTheScreen()
  })

  it('locks month navigation, back, metadata editing, and category rows during category save', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: mapBudget(budgetFixture), hasPrevious: true, hasNext: true }} categoryPending onSaveCategory={jest.fn()} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} onEdit={jest.fn()} />)
    expect(view.getByRole('button', { name: 'Back' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Previous' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Edit budget details' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Show subcategories for Home' }).props.accessibilityState.disabled).toBe(true)
  })

  it('offers linked-account management only when a handler is provided, with the editable note', async () => {
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const readOnly = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(readOnly.queryByRole('button', { name: 'Manage linked accounts' })).not.toBeOnTheScreen()
    expect(readOnly.getByText(/cannot be changed here/)).toBeOnTheScreen()
    readOnly.unmount()

    const manage = jest.fn()
    const editable = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onManageAccounts={manage} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(editable.queryByText(/cannot be changed here/)).not.toBeOnTheScreen()
    expect(editable.getByText(/feed this budget across every month/)).toBeOnTheScreen()
    await fireEvent.press(editable.getByRole('button', { name: 'Manage linked accounts' }))
    expect(manage).toHaveBeenCalledTimes(1)
  })

  it('offers a year-view entry point only when a handler is provided', async () => {
    const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
    const readOnly = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(readOnly.queryByRole('button', { name: 'View year' })).not.toBeOnTheScreen()
    readOnly.unmount()

    const viewYear = jest.fn()
    const withYear = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onViewYear={viewYear} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    await fireEvent.press(withYear.getByRole('button', { name: 'View year' }))
    expect(viewYear).toHaveBeenCalledTimes(1)
  })

  it('does not show a dead retry for an invalid route', async () => {
    const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'invalid-route' }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back to Budgets' })).toBeOnTheScreen()
  })

  describe('category removal', () => {
    afterEach(() => jest.restoreAllMocks())

    it('does not offer removal when no handler is provided', async () => {
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
      expect(view.queryByRole('button', { name: 'Remove Rent' })).not.toBeOnTheScreen()
    })

    it('removes for this month only when that scope is chosen', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
      await fireEvent.press(view.getByRole('button', { name: 'Remove Rent' }))
      expect(remove).toHaveBeenCalledWith(11, 'month')
    })

    it('removes going forward when that scope is chosen', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[2]?.onPress?.() })
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
      await fireEvent.press(view.getByRole('button', { name: 'Remove Rent' }))
      expect(remove).toHaveBeenCalledWith(11, 'forward')
    })

    it('does not remove when the confirmation is cancelled', async () => {
      const remove = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
      await fireEvent.press(view.getByRole('button', { name: 'Remove Rent' }))
      expect(remove).not.toHaveBeenCalled()
    })

    it('shows a scoped failure message for a rejected removal, without disturbing edit', async () => {
      const remove = jest.fn().mockRejectedValue(new Error('boom'))
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const value = mapBudget(budgetFixture, { year: 2028, month: 4 })
      const view = await renderWithI18n(<BudgetMonthScreen state={{ status: 'loaded', budget: value, hasPrevious: true, hasNext: true }} onRemoveCategory={remove} onSaveCategory={jest.fn()} onBack={jest.fn()} onRetry={jest.fn()} onPrevious={jest.fn()} onNext={jest.fn()} />)
      await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
      await fireEvent.press(view.getByRole('button', { name: 'Remove Rent' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be removed/i)
      expect(view.getByRole('button', { name: 'Edit Rent budget' })).toBeOnTheScreen()
    })
  })
})
