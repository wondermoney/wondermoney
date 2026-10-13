import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { AssetPriceChart, type AssetPriceChartState } from './asset-price-chart'

const palette = themeTokens.colors.light

// Real CartesianChart/Line render onto a Skia canvas, which needs a native (or WASM CanvasKit)
// backend unavailable in this project's jest environment (same reasoning as
// portfolio-performance-chart.test.tsx). This suite only asserts on this component's own
// state-to-UI logic.
let capturedChartData: unknown = null
jest.mock('victory-native', () => ({
  CartesianChart: (props: { data: unknown; children: (args: { points: { value: unknown } }) => React.ReactNode }) => {
    capturedChartData = props.data
    return props.children({ points: { value: [] } })
  },
  Line: () => null,
}))

async function renderChart(state: AssetPriceChartState, onSelectPeriod = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <AssetPriceChart state={state} period="1Y" onSelectPeriod={onSelectPeriod} palette={palette} />
    </I18nextProvider>,
  )
  return { view, onSelectPeriod }
}

describe('AssetPriceChart', () => {
  it('shows a loading indicator while the history loads', async () => {
    const { view } = await renderChart({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an alert when the history failed to load', async () => {
    const { view } = await renderChart({ status: 'error' })
    expect(view.getByRole('alert')).toHaveTextContent(/could not load price history/i)
  })

  it('shows an empty-history message rather than a blank chart', async () => {
    const { view } = await renderChart({ status: 'loaded', points: [] })
    expect(view.getByText(/not enough price history/i)).toBeOnTheScreen()
    expect(view.queryByTestId('asset-price-chart')).not.toBeOnTheScreen()
  })

  it('renders the chart once there are at least two points', async () => {
    const points = [{ x: 0, value: 100 }, { x: 1, value: 110 }]
    const { view } = await renderChart({ status: 'loaded', points })
    expect(view.getByTestId('asset-price-chart')).toBeOnTheScreen()
    expect(capturedChartData).toEqual(points)
  })

  it('lets the user switch periods', async () => {
    const { view, onSelectPeriod } = await renderChart({ status: 'loading' })
    await fireEvent.press(view.getByRole('tab', { name: '1M' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('1M')
    await fireEvent.press(view.getByRole('tab', { name: 'All' }))
    expect(onSelectPeriod).toHaveBeenCalledWith('ALL')
  })
})
