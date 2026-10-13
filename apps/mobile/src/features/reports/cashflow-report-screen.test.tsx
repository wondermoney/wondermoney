import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapCashflowReport } from './cashflow-report-view-model'
import { CashflowReportScreen } from './cashflow-report-screen'
import { useReportFilters } from './use-report-filters'

// Real CartesianChart/Line render onto a Skia canvas, unavailable in this project's jest
// environment — same rationale/mock as portfolio-performance-chart.test.tsx.
jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: { income: unknown; expenses: unknown; net: unknown } }) => React.ReactNode }) => props.children({ points: { income: [], expenses: [], net: [] } }),
  Line: () => null,
}))

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof CashflowReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <CashflowReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapCashflowReport({
  data: [
    { month: '2026-06-01', income: 2000, expenses: 1500, net: 500 },
    { month: '2026-07-01', income: 2200, expenses: 1900, net: 300 },
  ],
})

describe('CashflowReportScreen', () => {
  it('shows the chart region label, legend, and trailing net average', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('Cash flow')).toBeTruthy()
    expect(view.getByText('Income')).toBeOnTheScreen()
    expect(view.getByText('Expenses')).toBeOnTheScreen()
    expect(view.getByText('Net')).toBeOnTheScreen()
    expect(view.getByLabelText('+€400.00 trailing 3-month net average')).toBeTruthy()
  })

  it('shows an honest empty state with no cashflow data', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report: { points: [], months: [], trailingNetAverage: 0 } }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByText('No cash flow yet')).toBeOnTheScreen()
  })

  it('switches presets and renders loading/error states', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Last 6 months' }))
    expect(onSelectPreset).toHaveBeenCalledWith('last6Months')

    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows the export button', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
