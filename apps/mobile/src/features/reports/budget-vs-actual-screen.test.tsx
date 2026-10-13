import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapBudgetVsActualReport } from './budget-vs-actual-view-model'
import { BudgetVsActualScreen } from './budget-vs-actual-screen'
import { useReportFilters } from './use-report-filters'

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof BudgetVsActualScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <BudgetVsActualScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapBudgetVsActualReport({
  data: [
    { categoryKey: 'groceries', name: 'Groceries', color: '#22c55e', budgeted: 400, actual: 320, variance: 80, percentUsed: 80 },
    { categoryKey: 'dining', name: 'Dining out', color: '#ef4444', budgeted: 100, actual: 150, variance: -50, percentUsed: 150 },
  ],
  generatedAt: '2026-08-11T00:00:00.000Z',
})

describe('BudgetVsActualScreen', () => {
  it('shows rows with an honest over-budget cue and the selected date preset', async () => {
    const view = await renderWithI18n(
      { state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() },
    )
    expect(view.getByRole('button', { name: 'Last 3 months' }).props.accessibilityState.selected).toBe(true)
    expect(view.getByRole('button', { name: 'This month' }).props.accessibilityState.selected).toBe(false)
    expect(view.getByLabelText(/Dining out.*Over budget/)).toBeTruthy()
    expect(view.queryAllByText('Over budget').length).toBeGreaterThan(0)
  })

  it('switches presets on press', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n(
      { state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() },
    )
    await fireEvent.press(view.getByRole('button', { name: 'Last 12 months' }))
    expect(onSelectPreset).toHaveBeenCalledWith('last12Months')
  })

  it('shows the filter panel trigger', async () => {
    const view = await renderWithI18n(
      { state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() },
    )
    expect(view.getByRole('button', { name: 'Filters' })).toBeTruthy()
  })

  it('shows the export button and triggers onExport on press', async () => {
    const i18n = await initMobileI18n('en')
    const filterStateHook = await renderHook(() => useReportFilters())
    const onExport = jest.fn()
    const view = await render(
      <I18nextProvider i18n={i18n}>
        <BudgetVsActualScreen
          state={{ status: 'loaded', report }}
          preset="last3Months"
          currencyCode="EUR"
          filterState={filterStateHook.result.current}
          filterOptions={filterOptions}
          exportState={{ status: 'idle' }}
          onSelectPreset={jest.fn()}
          onExport={onExport}
          onRefresh={jest.fn()}
          onBack={jest.fn()}
        />
      </I18nextProvider>,
    )
    await fireEvent.press(view.getByRole('button', { name: 'Export CSV' }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('shows an honest empty state with no rows', async () => {
    const view = await renderWithI18n(
      { state: { status: 'loaded', report: { rows: [], generatedAt: '2026-08-11T00:00:00.000Z' } }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() },
    )
    expect(view.getByText('No budgeted categories in range')).toBeOnTheScreen()
  })

  it('renders loading, error, invalid-response, and access-transition states distinctly', async () => {
    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()

    const error = await renderWithI18n({ state: { status: 'error' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(error.getByText('Check your connection and try again')).toBeOnTheScreen()

    const invalid = await renderWithI18n({ state: { status: 'invalid-response' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(invalid.getByText('The report data received could not be verified')).toBeOnTheScreen()

    const accessTransition = await renderWithI18n({ state: { status: 'access-transition' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(accessTransition.toJSON()).toBeNull()
  })

  it('retries from the error state and navigates back', async () => {
    const onRetry = jest.fn()
    const onBack = jest.fn()
    const view = await renderWithI18n({ state: { status: 'error' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: onRetry, onBack })
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
