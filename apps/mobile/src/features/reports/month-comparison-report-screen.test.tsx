import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { formatMonthLabel, monthKeyOf, shiftMonthKey } from './month-comparison-months'
import { mapMonthComparisonReport } from './month-comparison-report-view-model'
import { MonthComparisonReportScreen } from './month-comparison-report-screen'
import { useReportFilters } from './use-report-filters'

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const THIS_MONTH = monthKeyOf(new Date())
const LAST_MONTH = shiftMonthKey(THIS_MONTH, -1)

const report = mapMonthComparisonReport({
  data: {
    base: { expenses: 1150, income: 2020, month: THIS_MONTH, net: 870, savingsRate: 0.43 },
    categories: [
      { base: 1000, categoryKey: '11', color: '#222222', compare: 900, delta: 100, deltaPct: 11.11, name: 'Rent' },
      { base: 150, categoryKey: '10', color: '#f3f3f3', compare: 100, delta: 50, deltaPct: 50, name: 'Groceries' },
    ],
    compare: { expenses: 1000, income: 2000, month: LAST_MONTH, net: 1000, savingsRate: 0.5 },
  },
})

function monthsState(overrides: Partial<{ base: string; compare: string }> = {}) {
  return {
    base: overrides.base ?? THIS_MONTH,
    compare: overrides.compare ?? LAST_MONTH,
    setBase: jest.fn(),
    setCompare: jest.fn(),
  }
}

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof MonthComparisonReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <MonthComparisonReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

describe('MonthComparisonReportScreen', () => {
  it('shows both months and the category changes', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', months: monthsState(), onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })

    expect(view.getByText('Compare months')).toBeOnTheScreen()
    expect(view.getByText('Rent')).toBeOnTheScreen()
    expect(view.getByText('Groceries')).toBeOnTheScreen()
    // The totals table names both months as column headers.
    expect(view.getAllByText(formatMonthLabel(THIS_MONTH, 'en')).length).toBeGreaterThan(0)
    expect(view.getAllByText(formatMonthLabel(LAST_MONTH, 'en')).length).toBeGreaterThan(0)
  })

  it('offers a picker for each month and reports a change', async () => {
    const months = monthsState()
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', months, onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })

    await fireEvent.press(view.getByRole('button', { name: `Month, ${formatMonthLabel(THIS_MONTH, 'en')}` }))
    const previous = shiftMonthKey(THIS_MONTH, -2)
    await fireEvent.press(view.getByRole('radio', { name: formatMonthLabel(previous, 'en') }))

    expect(months.setBase).toHaveBeenCalledWith(previous)
  })

  it('shows an honest empty state when neither month has spending', async () => {
    const empty = mapMonthComparisonReport({
      data: {
        base: { expenses: 0, income: 0, month: THIS_MONTH, net: 0, savingsRate: null },
        categories: [],
        compare: { expenses: 0, income: 0, month: LAST_MONTH, net: 0, savingsRate: null },
      },
    })
    const view = await renderWithI18n({ state: { status: 'loaded', report: empty }, preset: 'last3Months', currencyCode: 'EUR', months: monthsState(), onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })

    expect(view.getByText('No spending in either month')).toBeOnTheScreen()
  })

  it('shows the export button and the loading state', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', months: monthsState(), onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()

    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', months: monthsState(), onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()
  })
})
