import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapPortfolioPerformanceReport } from './portfolio-performance-report-view-model'
import { PortfolioPerformanceReportScreen } from './portfolio-performance-report-screen'

const renderWithI18n = async (props: Omit<React.ComponentProps<typeof PortfolioPerformanceReportScreen>, 'exportState' | 'onExport'>) => {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <PortfolioPerformanceReportScreen {...props} exportState={{ status: 'idle' }} onExport={jest.fn()} />
    </I18nextProvider>,
  )
}

const report = mapPortfolioPerformanceReport({
  data: [
    { portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: 10000, netContributions: 500, change: 2035.86, changePercent: 19.39, dividends: 12.5, endValue: 12535.86 },
    { portfolioKey: '8', name: 'Tech picks', currency: 'EUR', startValue: 2000, netContributions: 0, change: -100, changePercent: -5, dividends: 0, endValue: 1900 },
  ],
  generatedAt: '2026-08-11T00:00:00.000Z',
})

const baseProps = { preset: 'last3Months' as const, currencyCode: 'EUR', onSelectPreset: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn() }

describe('PortfolioPerformanceReportScreen', () => {
  it('shows each portfolio with its start value, net contributions, change and end value', async () => {
    const view = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report } })
    expect(view.getByLabelText(/^Long-term, Start value, €10,000\.00, Net contributions, €500\.00, Change, \+€2,035\.86 \(\+19\.39%\), Dividends, €12\.50, End value, €12,535\.86$/)).toBeTruthy()
    expect(view.getByLabelText(/^Tech picks, .*Change, -€100\.00/)).toBeTruthy()
  })

  it('shows a Total row with the combined change across portfolios', async () => {
    const view = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report } })
    expect(view.getByText('Total')).toBeOnTheScreen()
    expect(view.getByLabelText(/^Total, Start value, €12,000\.00, .*Change, \+€1,935\.86 \(\+15\.49%\)/)).toBeTruthy()
  })

  it('shows an unknown start as a dash, never as zero, and leaves the combined change out', async () => {
    const unknown = mapPortfolioPerformanceReport({
      data: [{ portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: null, netContributions: 0, change: null, changePercent: null, dividends: 0, endValue: 900 }],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    const view = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report: unknown } })
    expect(view.getByLabelText(/Start value, No value recorded, .*Change, No value recorded/)).toBeTruthy()
    expect(view.getAllByText('—').length).toBeGreaterThan(0)
    expect(view.queryByText('Total')).toBeNull()
  })

  it('says when contributions and dividends have no exchange rate yet, never showing them as zero', async () => {
    const unconverted = mapPortfolioPerformanceReport({
      data: [{ portfolioKey: '7', name: 'Long-term', currency: 'EUR', startValue: 1000, netContributions: null, change: null, changePercent: null, dividends: null, endValue: 1100 }],
      generatedAt: '2026-08-11T00:00:00.000Z',
    })
    const view = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report: unconverted } })
    expect(view.getByLabelText(/Net contributions, No exchange rate yet, .*Dividends, No exchange rate yet,/)).toBeTruthy()
  })

  it('shows an honest empty state with no portfolios', async () => {
    const empty = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report: { rows: [], generatedAt: '2026-08-11T00:00:00.000Z', aggregateChange: 0, totals: { startValue: 0, netContributions: 0, change: 0, changePercent: null, dividends: 0, endValue: 0 } } } })
    expect(empty.getByText('No portfolios to show')).toBeOnTheScreen()
  })

  it('switches presets and renders loading/error/access-transition states', async () => {
    const onSelectPreset = jest.fn()
    const view = await renderWithI18n({ ...baseProps, onSelectPreset, state: { status: 'loaded', report } })
    await fireEvent.press(view.getByRole('button', { name: 'Date range, Last 3 months' }))
    await fireEvent.press(view.getByRole('radio', { name: 'This month' }))
    expect(onSelectPreset).toHaveBeenCalledWith('thisMonth')

    const loading = await renderWithI18n({ ...baseProps, state: { status: 'loading' } })
    expect(loading.getByRole('progressbar')).toBeOnTheScreen()

    const accessTransition = await renderWithI18n({ ...baseProps, state: { status: 'access-transition' } })
    expect(accessTransition.toJSON()).toBeNull()
  })

  it('shows the export button', async () => {
    const view = await renderWithI18n({ ...baseProps, state: { status: 'loaded', report } })
    expect(view.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
