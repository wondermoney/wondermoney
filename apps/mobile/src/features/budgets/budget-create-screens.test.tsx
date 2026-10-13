import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetAddCategoryScreen } from './budget-add-category-screen'
import { BudgetCreateScreen } from './budget-create-screen'

const renderI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('budget creation screens', () => {
  it('enforces household bounds and reviews adults, dependents, and monthly total before submit', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const view = await renderI18n(<BudgetCreateScreen pending={false} failure={null} candidates={null} reconciliationFailed={false} onBack={jest.fn()} onSubmit={submit} onCreateAnother={jest.fn()} />)
    expect(view.getByLabelText('Household size: 1')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: '− Household size' }).props.accessibilityState.disabled).toBe(true)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    expect(view.getByRole('header', { name: 'Income' })).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    expect(view.getByRole('header', { name: 'Review budget' })).toBeOnTheScreen()
    expect(view.getByText('Adults')).toBeOnTheScreen()
    expect(view.getByText('No income rows will be submitted')).toBeOnTheScreen()
    expect(view.getByLabelText(/Total monthly-equivalent income/)).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Create budget' })) })
    expect(submit).toHaveBeenCalledWith({ houseHoldSize: 1, dependentsNum: 0, incomes: [] })
  })

  it('shows a per-field error under an income row with a blank name and clears it once fixed', async () => {
    const view = await renderI18n(<BudgetCreateScreen pending={false} failure={null} candidates={null} reconciliationFailed={false} onBack={jest.fn()} onSubmit={jest.fn()} onCreateAnother={jest.fn()} />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add income' })) })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '1000') })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    expect(view.getByText('Enter a name up to 100 characters.')).toBeOnTheScreen()
    expect(view.getByRole('header', { name: 'Income' })).toBeOnTheScreen()
    await act(async () => { fireEvent.changeText(view.getByLabelText('Income name'), 'Salary') })
    expect(view.queryByText('Enter a name up to 100 characters.')).not.toBeOnTheScreen()
  })

  it('locks navigation and submit while pending and offers no retry on unknown outcomes', async () => {
    const pending = await renderI18n(<BudgetCreateScreen pending failure={null} candidates={null} reconciliationFailed={false} onBack={jest.fn()} onSubmit={jest.fn()} onCreateAnother={jest.fn()} />)
    expect(pending.getByRole('button', { name: 'Back' }).props.accessibilityState.disabled).toBe(true)
    pending.unmount()
    const createAnother = jest.fn()
    const unknown = await renderI18n(<BudgetCreateScreen pending={false} failure="unknown" candidates={[{ id: 9, name: 'Budget' }]} reconciliationFailed={false} onBack={jest.fn()} onSubmit={jest.fn()} onCreateAnother={createAnother} />)
    expect(unknown.getByRole('alert')).toHaveTextContent(/One new budget candidate/)
    expect(unknown.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    await act(async () => { fireEvent.press(unknown.getByRole('button', { name: 'Create another budget' })) })
    expect(createAnother).toHaveBeenCalled()
  })

  it('retains the reviewed create payload and blocks resubmit while reconciliation is pending', async () => {
    const Harness = () => {
      const React = jest.requireActual<typeof import('react')>('react')
      const Native = jest.requireActual<typeof import('react-native')>('react-native')
      const [unknown, setUnknown] = React.useState(false)
      return <><BudgetCreateScreen pending={false} failure={unknown ? 'unknown' : null} candidates={null} reconciliationFailed={false} onBack={jest.fn()} onSubmit={jest.fn()} onCreateAnother={jest.fn()} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Set unknown" onPress={() => setUnknown(true)} /></>
    }
    const view = await renderI18n(<Harness />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(view.getByRole('button', { name: 'Add income' })).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add income' })) })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Income name'), 'Salary') })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '1200') })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(view.getByText('Salary')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Set unknown' })) })
    expect(view.getByText('Salary')).toBeOnTheScreen()
    expect(view.getAllByText('€1,200.00')).toHaveLength(2)
    expect(view.getByRole('button', { name: 'Create budget' }).props.accessibilityState.disabled).toBe(true)
  })
})

describe('existing category add screen', () => {
  it('reviews leaf category, amount, recurrence, and the server current-year 12-month scope', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const view = await renderI18n(<BudgetAddCategoryScreen status="ready" categories={[{ id: 12, name: 'Power' }]} currency="EUR" year={2026} pending={false} failure={null} reconciliation={null} onBack={jest.fn()} onRefresh={jest.fn()} onSubmit={submit} onNewAttempt={jest.fn()} />)
    await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Power' })) })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '80') })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Review category' })) })
    await waitFor(() => expect(view.getByText(/all 12 months of 2026/)).toBeOnTheScreen())
    expect(view.getByText('€80.00')).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add category' })) })
    expect(submit).toHaveBeenCalledWith({ categoryKey: 12, amountBudgeted: 80, recurrency: 'MONTHLY' })
  })

  it('keeps duplicate-unknown locked with retained review values and outcome-neutral accessible copy', async () => {
    const next = jest.fn()
    const Harness = () => {
      const React = jest.requireActual<typeof import('react')>('react')
      const Native = jest.requireActual<typeof import('react-native')>('react-native')
      const [reconciliation, setReconciliation] = React.useState<'duplicate-unknown' | null>(null)
      return <><BudgetAddCategoryScreen status="ready" categories={[{ id: 12, name: 'Power' }]} currency="EUR" year={2026} pending={false} failure={reconciliation ? 'duplicate' : null} reconciliation={reconciliation} onBack={jest.fn()} onRefresh={jest.fn()} onSubmit={async () => setReconciliation('duplicate-unknown')} onNewAttempt={next} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Inspect retained review" onPress={() => setReconciliation(null)} /></>
    }
    const view = await renderI18n(<Harness />)
    await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Power' })) })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '80') })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Review category' })) })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add category' })) })
    const alert = view.getByRole('alert')
    expect(alert).toHaveTextContent('The category state could not be confirmed. Refresh the current month again before starting any new attempt')
    expect(alert.props.accessibilityLiveRegion).toBe('assertive')
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Start a new attempt' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Add category' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen()
    expect(next).not.toHaveBeenCalled()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Inspect retained review' })) })
    expect(view.getByText('Power')).toBeOnTheScreen()
    expect(view.getByText('€80.00')).toBeOnTheScreen()
  })

  it('retains the reviewed category payload until absence permits an explicit new attempt', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const Harness = () => {
      const React = jest.requireActual<typeof import('react')>('react')
      const [reconciliation, setReconciliation] = React.useState<'absent' | null>(null)
      return <BudgetAddCategoryScreen status="ready" categories={[{ id: 12, name: 'Power' }]} currency="EUR" year={2026} pending={false} failure={reconciliation ? 'unknown' : null} reconciliation={reconciliation} onBack={jest.fn()} onRefresh={jest.fn()} onSubmit={async (value) => { await submit(value); setReconciliation('absent') }} onNewAttempt={() => setReconciliation(null)} />
    }
    const view = await renderI18n(<Harness />)
    await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Power' })) })
    await act(async () => { fireEvent.changeText(view.getByLabelText('Amount per occurrence'), '80') })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Review category' })) })
    await waitFor(() => expect(view.getByRole('button', { name: 'Add category' })).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add category' })) })
    expect(view.getByRole('alert')).toHaveTextContent(/absent/)
    expect(view.queryByRole('button', { name: 'Add category' })).not.toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Start a new attempt' })) })
    await waitFor(() => expect(view.getByText('€80.00')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Add category' })) })
    expect(submit).toHaveBeenNthCalledWith(2, { categoryKey: 12, amountBudgeted: 80, recurrency: 'MONTHLY' })
  })

  it('keeps a failed category refresh locked with no new-attempt action', async () => {
    const view = await renderI18n(<BudgetAddCategoryScreen status="ready" categories={[]} currency="EUR" year={2026} pending={false} failure="unknown" reconciliation="refresh-failed" onBack={jest.fn()} onRefresh={jest.fn()} onSubmit={jest.fn()} onNewAttempt={jest.fn()} />)
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/result remains unknown/))
    expect(view.queryByRole('button', { name: 'Start a new attempt' })).not.toBeOnTheScreen()
  })
})
