import { render } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { TickerFinancialsPanel, type TickerFinancialsState } from './ticker-financials-panel'

const palette = themeTokens.colors.light

// Real CartesianChart/BarGroup render onto a Skia canvas, unavailable in this project's jest
// environment (same reasoning as asset-price-chart.test.tsx). This suite only asserts on this
// component's own state-to-UI logic and its accessible text summary.
let capturedChartData: unknown = null
jest.mock('victory-native', () => {
  const BarGroup = function BarGroup({ children }: { children: ReactNode }) { return children }
  BarGroup.Bar = function BarGroupBar() { return null }
  return {
    CartesianChart: (props: { data: unknown; children: (args: { points: { revenue: unknown; netIncome: unknown }; chartBounds: unknown }) => ReactNode }) => {
      capturedChartData = props.data
      return props.children({ points: { revenue: [], netIncome: [] }, chartBounds: {} })
    },
    BarGroup,
  }
})

async function renderPanel(state: TickerFinancialsState) {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <TickerFinancialsPanel state={state} palette={palette} />
    </I18nextProvider>,
  )
}

describe('TickerFinancialsPanel', () => {
  it('shows a loading indicator while financials load', async () => {
    const view = await renderPanel({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an alert when financials failed to load', async () => {
    const view = await renderPanel({ status: 'error' })
    expect(view.getByRole('alert')).toHaveTextContent('Could not load financials')
  })

  it('shows an empty-data message rather than a blank chart', async () => {
    const view = await renderPanel({ status: 'loaded', points: [] })
    expect(view.getByText('No financials data available')).toBeOnTheScreen()
    expect(view.queryByTestId('ticker-financials-chart')).not.toBeOnTheScreen()
  })

  it('renders the chart and an accessible text summary of every period', async () => {
    const points = [
      { period: 'FY2024', revenue: 391_035_000_000, netIncome: 93_736_000_000 },
      { period: 'FY2025', revenue: null, netIncome: null },
    ]
    const view = await renderPanel({ status: 'loaded', points })
    expect(view.getByTestId('ticker-financials-chart')).toBeOnTheScreen()
    expect(capturedChartData).toEqual(points)
    expect(view.getByText(/FY2024: revenue \$391.*B, net income \$93.*B/)).toBeOnTheScreen()
    expect(view.getByText(/FY2025: revenue Unavailable, net income Unavailable/)).toBeOnTheScreen()
  })
})
