import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PortfolioPerformanceChart, type PortfolioPerformanceState } from './portfolio-performance-chart'

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
}))

async function renderChart(state: PortfolioPerformanceState, onSelectPeriod = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <PortfolioPerformanceChart state={state} period="YTD" onSelectPeriod={onSelectPeriod} palette={palette} />
    </I18nextProvider>,
  )
  return { view, onSelectPeriod }
}

describe('PortfolioPerformanceChart', () => {
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
      data: { points: [], totalReturnPercent: null, startDate: null, endDate: null, historyStatus: 'empty' },
    })
    expect(view.getByText(/no performance history is available yet/i)).toBeOnTheScreen()
    expect(view.queryByTestId('portfolio-performance-chart')).not.toBeOnTheScreen()
  })

  it('shows an insufficient-history message when there are fewer than two points', async () => {
    const { view } = await renderChart({
      status: 'loaded',
      data: { points: [{ x: 0, value: 100 }], totalReturnPercent: null, startDate: '2026-08-01', endDate: '2026-08-01', historyStatus: 'insufficient_history' },
    })
    expect(view.getByText(/not enough history yet/i)).toBeOnTheScreen()
    expect(view.queryByTestId('portfolio-performance-chart')).not.toBeOnTheScreen()
  })

  it('renders the chart, total return, and date range once real history is ready', async () => {
    const points = [{ x: 0, value: 1000 }, { x: 1, value: 1100 }]
    const { view } = await renderChart({
      status: 'loaded',
      data: { points, totalReturnPercent: 10, startDate: '2026-07-01', endDate: '2026-08-01', historyStatus: 'ready' },
    })
    expect(view.getByTestId('portfolio-performance-chart')).toBeOnTheScreen()
    expect(capturedChartData).toEqual(points)
    expect(view.getByText('10.0%')).toBeOnTheScreen()
    expect(view.getByText(/2026-07-01.*2026-08-01/)).toBeOnTheScreen()
  })

  it('lets the user switch periods', async () => {
    const { view, onSelectPeriod } = await renderChart({ status: 'loading' })
    await fireEvent.press(view.getByRole('tab', { name: '1M' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('1M')
    await fireEvent.press(view.getByRole('tab', { name: 'All' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('ALL')
  })
})
