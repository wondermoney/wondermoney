import { fireEvent, render, renderHook } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ReportsHubScreen, type ReportsHubScreenProps } from './reports-hub-screen'
import { useReportFilters } from './use-report-filters'

// Real CartesianChart/Line render onto a Skia canvas, unavailable in this project's jest
// environment — same rationale/mock as portfolio-performance-chart.test.tsx.
jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: { income: unknown; expenses: unknown; net: unknown; value: unknown } }) => React.ReactNode }) => props.children({ points: { income: [], expenses: [], net: [], value: [] } }),
  Line: () => null,
}))

const filterOptions = { accounts: [], categories: [], merchants: [], currencies: [] }

async function renderWithI18n(overrides: Partial<ReportsHubScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const filterStateHook = await renderHook(() => useReportFilters())
  const loading = { state: { status: 'loading' as const }, currencyCode: 'EUR', exportState: { status: 'idle' as const }, onExport: jest.fn(), onRefresh: jest.fn() }
  const props: ReportsHubScreenProps = {
    preset: 'last3Months',
    filterState: filterStateHook.result.current,
    filterOptions,
    onSelectPreset: jest.fn(),
    refreshing: false,
    onRefreshAll: jest.fn(),
    onBack: jest.fn(),
    sankey: loading,
    cashflow: loading,
    spendingByCategory: { ...loading, state: { status: 'loading' } },
    netWorthHistory: loading,
    budgetVsActual: loading,
    portfolioPerformance: loading,
    ...overrides,
  }
  return render(<I18nextProvider i18n={i18n}><ReportsHubScreen {...props} /></I18nextProvider>)
}

describe('ReportsHubScreen', () => {
  it('composes all six reports inline on one page, each showing its own title', async () => {
    const view = await renderWithI18n()
    expect(view.getByText('Cash flow Sankey')).toBeOnTheScreen()
    expect(view.getByText('Cash flow')).toBeOnTheScreen()
    expect(view.getByText('Spending by category')).toBeOnTheScreen()
    expect(view.getByText('Net worth over time')).toBeOnTheScreen()
    expect(view.getByText('Budget vs actual')).toBeOnTheScreen()
    expect(view.getByText('Portfolio performance')).toBeOnTheScreen()
  })

  it('shares one preset/filter bar across every section rather than one per report', async () => {
    const view = await renderWithI18n()
    // The date-range preset chip appears exactly once, not once per section — this is the
    // hub's whole point versus the standalone per-report screens, which each have their own.
    expect(view.getAllByText('Last 3 months').length).toBe(1)
  })

  it('navigates back', async () => {
    const onBack = jest.fn()
    const view = await renderWithI18n({ onBack })
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
