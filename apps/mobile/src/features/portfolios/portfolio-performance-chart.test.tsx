import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { formatDay, PortfolioBenchmarkChart, PortfolioPerformanceChart, type PortfolioPerformanceState } from './portfolio-performance-chart'

const palette = themeTokens.colors.light

// Real CartesianChart/Line render onto a Skia canvas, which needs a native (or WASM CanvasKit)
// backend unavailable in this project's jest environment. This suite only asserts on this
// component's own state-to-UI logic (loading/error/empty/ready branches, the summary text, the
// period selector), so a lightweight stand-in is enough — chart internals are victory-native's
// own responsibility, not this feature's.
let capturedChartData: unknown = null
jest.mock('victory-native', () => ({
  CartesianChart: (props: { data: unknown; children: (args: { points: { value: unknown } }) => React.ReactNode }) => {
    capturedChartData = props.data
    return props.children({ points: { value: [] } })
  },
  Line: () => null,
  Scatter: () => null,
}))

async function renderChart(state: PortfolioPerformanceState, onSelectPeriod = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <PortfolioPerformanceChart currency="EUR" state={state} period="YTD" onSelectPeriod={onSelectPeriod} palette={palette} />
    </I18nextProvider>,
  )
  return { view, onSelectPeriod, t: i18n.t.bind(i18n) }
}

describe('PortfolioPerformanceChart', () => {
  it.each(['en', 'pt-PT', 'es'] as const)('shows the selected benchmark and both numeric returns in %s', async (locale) => {
    const i18n = await initMobileI18n(locale)
    const view = await render(<I18nextProvider i18n={i18n}><PortfolioBenchmarkChart palette={palette} state={{ status: 'loaded', data: {
      points: [], totalReturnPercent: 10, returnEndDate: '2026-08-01', startDate: '2026-07-01', endDate: '2026-08-01', historyStatus: 'ready', flows: [],
      benchmark: { symbol: 'QQQ', status: 'ready', points: [{ x: 0, portfolio: 0, benchmark: 0 }, { x: 1, portfolio: 10, benchmark: 12 }] },
    } }} /></I18nextProvider>)
    expect(view.getByLabelText(/10\s*%.*QQQ.*12\s*%/)).toBeOnTheScreen()
  })
  it('shows a loading indicator while the history loads', async () => {
    const { view } = await renderChart({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an alert when the history failed to load', async () => {
    const { view } = await renderChart({ status: 'error' })
    expect(view.getByRole('alert')).toHaveTextContent(/could not load performance history/i)
  })

  it('shows an empty-history message rather than a blank chart', async () => {
    const { view } = await renderChart({
      status: 'loaded',
      data: { points: [], totalReturnPercent: null, returnEndDate: null, startDate: null, endDate: null, historyStatus: 'empty', flows: [] },
    })
    expect(view.getByText(/no performance history is available yet/i)).toBeOnTheScreen()
    expect(view.queryByTestId('portfolio-performance-chart')).not.toBeOnTheScreen()
  })

  it('shows an insufficient-history message when there are fewer than two points', async () => {
    const { view } = await renderChart({
      status: 'loaded',
      data: { points: [{ x: 0, value: 100, flow: null }], totalReturnPercent: null, returnEndDate: null, startDate: '2026-08-01', endDate: '2026-08-01', historyStatus: 'insufficient_history', flows: [] },
    })
    expect(view.getByText(/not enough history yet/i)).toBeOnTheScreen()
    expect(view.queryByTestId('portfolio-performance-chart')).not.toBeOnTheScreen()
  })

  it('renders the chart, total return, and date range once real history is ready', async () => {
    const points = [{ x: 0, value: 1000, flow: null }, { x: 1, value: 1100, flow: null }]
    const { view } = await renderChart({
      status: 'loaded',
      data: { points, totalReturnPercent: 10, returnEndDate: '2026-08-01', startDate: '2026-07-01', endDate: '2026-08-01', historyStatus: 'ready', flows: [] },
    })
    expect(view.getByTestId('portfolio-performance-chart')).toBeOnTheScreen()
    expect(capturedChartData).toEqual(points)
    expect(view.getByText('10.0%')).toBeOnTheScreen()
    expect(view.getByText(/2026-07-01.*2026-08-01/)).toBeOnTheScreen()
  })

  it('says when some days left out a portfolio it could not convert', async () => {
    const points = [{ x: 0, value: 1000, flow: null }, { x: 1, value: 1100, flow: null }]
    const ready = { points, totalReturnPercent: 10, returnEndDate: '2026-08-01', startDate: '2026-07-01', endDate: '2026-08-01', historyStatus: 'ready' as const, flows: [] }
    const { view } = await renderChart({ status: 'loaded', data: { ...ready, currencyIncomplete: true } })
    expect(view.getByText(/no exchange rate/i)).toBeOnTheScreen()
    view.unmount()

    const complete = await renderChart({ status: 'loaded', data: { ...ready, currencyIncomplete: false } })
    expect(complete.view.queryByText(/no exchange rate/i)).not.toBeOnTheScreen()
  })

  it('names the return as time-weighted and says as of when, if its latest days were not measured', async () => {
    const points = [{ x: 0, value: 1000, flow: null }, { x: 1, value: 1500, flow: 1500 }, { x: 2, value: 1500, flow: null }]
    const data = { points, totalReturnPercent: 0, returnEndDate: '2026-07-03', startDate: '2026-07-01', endDate: '2026-07-03', historyStatus: 'ready' as const, flows: [] }
    const current = await renderChart({ status: 'loaded', data })
    expect(current.view.getByText(current.t('portfolioDetail.performance.returnLabel'))).toBeOnTheScreen()
    expect(current.view.queryByText(current.t('portfolioDetail.performance.returnAsOf', { date: formatDay('2026-07-02', 'en') }))).not.toBeOnTheScreen()
    current.view.unmount()

    const lagging = await renderChart({ status: 'loaded', data: { ...data, returnEndDate: '2026-07-02' } })
    expect(lagging.view.getByText(lagging.t('portfolioDetail.performance.returnAsOf', { date: formatDay('2026-07-02', 'en') }))).toBeOnTheScreen()
  })

  it('lists the latest deposits and withdrawals with their amounts, newest first, and how many more there are', async () => {
    const flows = [
      { date: '2026-07-02', kind: 'deposit' as const, amount: 500 },
      { date: '2026-07-03', kind: 'withdrawal' as const, amount: 200 },
      { date: '2026-07-04', kind: 'unknown' as const, amount: null },
      { date: '2026-07-05', kind: 'deposit' as const, amount: 1 },
      { date: '2026-07-06', kind: 'deposit' as const, amount: 2 },
      { date: '2026-07-07', kind: 'deposit' as const, amount: 3 },
    ]
    const points = [{ x: 0, value: 1000, flow: null }, { x: 1, value: 1500, flow: 1500 }]
    const { view, t } = await renderChart({ status: 'loaded', data: { points, totalReturnPercent: 0, returnEndDate: '2026-07-07', startDate: '2026-07-01', endDate: '2026-07-07', historyStatus: 'ready', flows } })
    expect(capturedChartData).toEqual(points)
    const rows = view.getAllByTestId('portfolio-performance-flow')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent(t('portfolioDetail.performance.deposit', { amount: '€3.00' }), { exact: false })
    expect(view.getByLabelText(new RegExp(`${formatDay('2026-07-03', 'en')}, ${t('portfolioDetail.performance.withdrawal', { amount: '€200.00' })}`))).toBeOnTheScreen()
    expect(view.getByLabelText(new RegExp(`${formatDay('2026-07-04', 'en')}, ${t('portfolioDetail.performance.flowUnknown')}`))).toBeOnTheScreen()
    expect(view.queryByText(/€500\.00/)).not.toBeOnTheScreen()
    expect(view.getByText(t('portfolioDetail.performance.flowsMore', { count: 1 }))).toBeOnTheScreen()
  })

  it('shows no flow list when no money went in or out', async () => {
    const points = [{ x: 0, value: 1000, flow: null }, { x: 1, value: 1100, flow: null }]
    const { view } = await renderChart({ status: 'loaded', data: { points, totalReturnPercent: 10, returnEndDate: '2026-08-01', startDate: '2026-07-01', endDate: '2026-08-01', historyStatus: 'ready', flows: [] } })
    expect(view.queryByTestId('portfolio-performance-flows')).not.toBeOnTheScreen()
  })

  it('lets the user switch periods', async () => {
    const { view, onSelectPeriod } = await renderChart({ status: 'loading' })
    await fireEvent.press(view.getByRole('tab', { name: '1M' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('1M')
    await fireEvent.press(view.getByRole('tab', { name: 'All' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('ALL')
  })
})
