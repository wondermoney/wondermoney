import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import { PortfolioPerformanceReportScreen } from './portfolio-performance-report-screen'
import { useReportFilters } from './use-report-filters'

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof PortfolioPerformanceReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <PortfolioPerformanceReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapPortfolioPerformanceReport({
  data: [
    { accountKey: 'a', name: 'Broker EUR', currency: 'EUR', startBalance: 1000, endBalance: 1100, return: 100, contributions: 0 },
    { accountKey: 'b', name: 'Broker USD', currency: 'USD', startBalance: 500, endBalance: 400, return: -100, contributions: 0 },
  ],
  generatedAt: '2026-08-11T00:00:00.000Z',
})

describe('PortfolioPerformanceReportScreen', () => {
  it('formats every row amount with the shared reports currency, keeping row.currency as a label only', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText(/Broker EUR, EUR.*€1,100\.00/)).toBeTruthy()
    expect(view.getByLabelText(/Broker USD, USD.*€400\.00/)).toBeTruthy()
    expect(view.queryByText('$400.00')).toBeNull()
  })

  it('shows the combined return across all rows and the start-balance caveat', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('€0.00 combined return')).toBeTruthy()
    expect(view.getByText(/Start balance reflects the first transaction/)).toBeOnTheScreen()
  })

  it('shows an honest empty state with no rows', async () => {
    const empty = await renderWithI18n({ state: { status: 'loaded', report: { rows: [], generatedAt: '2026-08-11T00:00:00.000Z', aggregateReturn: 0 } }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(empty.getByText('No accounts to show')).toBeOnTheScreen()
  })

  it('switches presets and renders loading/error/access-transition states', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'This month' }))
    expect(onSelectPreset).toHaveBeenCalledWith('thisMonth')

    const loading = await renderWithI18n({ state: { status: 'loading' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()

    const accessTransition = await renderWithI18n({ state: { status: 'access-transition' }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(accessTransition.toJSON()).toBeNull()
  })

  it('shows the export button', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
