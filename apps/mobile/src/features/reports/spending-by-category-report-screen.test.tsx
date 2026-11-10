import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { mapSpendingByCategoryReport } from './spending-by-category-report-view-model'
import { SpendingByCategoryReportScreen } from './spending-by-category-report-screen'
import { useReportFilters } from './use-report-filters'

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof SpendingByCategoryReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <SpendingByCategoryReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const row = (categoryKey: string, totalAmount: number, name = categoryKey) => ({
  categoryKey, parentKey: null, name, color: '#111111', totalAmount, transactionCount: 1, percentOfTotal: 0,
})

describe('SpendingByCategoryReportScreen', () => {
  it('shows the total, each bar, and a trend once the prior period is ready', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 150, 'Groceries')] }, { data: [row('a', 100)] }, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('Total spent, €150.00')).toBeTruthy()
    expect(view.getByLabelText('Groceries, €150.00')).toBeTruthy()
    expect(view.getByText('vs. prior period')).toBeOnTheScreen()
  })

  it('signs a rise in spending and marks it destructive', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 150, 'Groceries')] }, { data: [row('a', 100)] }, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('vs. prior period +50%')).toBeTruthy()
    expect(view.getByText('vs. prior period')).toHaveStyle({ color: themeTokens.colors.light.destructiveText })
  })

  it('signs a fall in spending and marks it as success', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 75, 'Groceries')] }, { data: [row('a', 100)] }, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('vs. prior period \u221225%')).toBeTruthy()
    expect(view.getByText('vs. prior period')).toHaveStyle({ color: themeTokens.colors.light.successText })
  })

  it('hides the trend line until the prior period has actually loaded', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 150, 'Groceries')] }, undefined, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: false }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.queryByText(/vs\. prior period/)).toBeNull()
  })

  it('shows an honest empty state with no spending', async () => {
    const report = mapSpendingByCategoryReport({ data: [] }, undefined, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByText('No spending in this period')).toBeOnTheScreen()
  })

  it('says when spending in a currency with no exchange rate was left out, even of an empty period', async () => {
    const report = mapSpendingByCategoryReport({ data: [] }, undefined, 'Other')
    const completeness = { currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 1, unconvertedCurrencies: ['CHF'] }
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true, completeness }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByTestId('spending-by-category-report-unconverted')).toHaveTextContent(/1 transaction in CHF is left out/)
  })

  it('switches presets and renders loading/error states', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 100)] }, undefined, 'Other')
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Date range, Last 3 months' }))
    await fireEvent.press(view.getByRole('radio', { name: 'This month' }))
    expect(onSelectPreset).toHaveBeenCalledWith('thisMonth')

    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows the export button', async () => {
    const report = mapSpendingByCategoryReport({ data: [row('a', 100)] }, undefined, 'Other')
    const view = await renderWithI18n({ state: { status: 'loaded', report, trendReady: true }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
