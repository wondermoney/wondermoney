import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapNetWorthHistoryReport } from './net-worth-history-report-view-model'
import { NetWorthHistoryReportScreen } from './net-worth-history-report-screen'
import { useReportFilters } from './use-report-filters'

// Real CartesianChart/Line render onto a Skia canvas, which needs a native (or WASM CanvasKit)
// backend unavailable in this project's jest environment — same rationale/mock as
// portfolio-performance-chart.test.tsx. This suite only asserts on this screen's own
// state-to-UI logic, not victory-native's chart internals.
jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: { value: unknown } }) => React.ReactNode }) => props.children({ points: { value: [] } }),
  Line: () => null,
}))

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof NetWorthHistoryReportScreen>, 'filterState' | 'filterOptions' | 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  return render(
    <I18nextProvider i18n={i18n}>
      <NetWorthHistoryReportScreen {...props} filterState={filterStateHook.result.current} filterOptions={filterOptions} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapNetWorthHistoryReport({
  data: [
    { date: '2026-06-01', netWorth: 1000, breakdown: { assets: 1200, liabilities: 200 } },
    { date: '2026-07-01', netWorth: 1200, breakdown: { assets: 1500, liabilities: 300 } },
  ],
})

describe('NetWorthHistoryReportScreen', () => {
  it('shows the chart region label, trend, and latest breakdown', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByLabelText('Net worth over time')).toBeTruthy()
    expect(view.getByLabelText(/€200\.00.*20%.*since last month/)).toBeTruthy()
    expect(view.getByLabelText('Assets, €1,500.00')).toBeTruthy()
    expect(view.getByLabelText('Liabilities, €300.00')).toBeTruthy()
  })

  it('omits the trend line with fewer than two points but still shows the breakdown', async () => {
    const singlePoint = mapNetWorthHistoryReport({ data: [{ date: '2026-07-01', netWorth: 1200, breakdown: { assets: 1500, liabilities: 300 } }] })
    const view = await renderWithI18n({ state: { status: 'loaded', report: singlePoint }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.queryByLabelText(/since last month/)).toBeNull()
    expect(view.getByLabelText('Assets, €1,500.00')).toBeTruthy()
  })

  it('shows an honest empty state with no history', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report: { points: [], dates: [], trend: { delta: 0, percent: 0 }, latestBreakdown: null } }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByText('No history yet')).toBeOnTheScreen()
  })

  it('switches presets on press', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset, onRefresh: jest.fn(), onBack: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Last 6 months' }))
    expect(onSelectPreset).toHaveBeenCalledWith('last6Months')
  })

  it('shows the export button', async () => {
    const view = await renderWithI18n({ state: { status: 'loaded', report }, preset: 'last3Months', currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
