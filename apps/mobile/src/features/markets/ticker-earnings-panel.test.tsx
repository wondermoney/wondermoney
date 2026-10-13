import { render } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { TickerEarningsPanel, type TickerEarningsState } from './ticker-earnings-panel'

const palette = themeTokens.colors.light

// Real CartesianChart/Scatter render onto a Skia canvas, unavailable in this project's jest
// environment (same reasoning as asset-price-chart.test.tsx). This suite only asserts on this
// component's own state-to-UI logic and its accessible text summary.
let capturedChartData: unknown = null
jest.mock('victory-native', () => ({
  CartesianChart: (props: { data: unknown; children: (args: { points: { actual: unknown; estimated: unknown } }) => ReactNode }) => {
    capturedChartData = props.data
    return props.children({ points: { actual: [], estimated: [] } })
  },
  Scatter: () => null,
}))

async function renderPanel(state: TickerEarningsState) {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <TickerEarningsPanel state={state} palette={palette} />
    </I18nextProvider>,
  )
}

describe('TickerEarningsPanel', () => {
  it('shows a loading indicator while earnings load', async () => {
    const view = await renderPanel({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an alert when earnings failed to load', async () => {
    const view = await renderPanel({ status: 'error' })
    expect(view.getByRole('alert')).toHaveTextContent('Could not load earnings')
  })

  it('shows an empty-data message rather than a blank chart', async () => {
    const view = await renderPanel({ status: 'loaded', points: [] })
    expect(view.getByText('No earnings data available')).toBeOnTheScreen()
    expect(view.queryByTestId('ticker-earnings-chart')).not.toBeOnTheScreen()
  })

  it('renders the chart and an accessible text summary of every quarter', async () => {
    const points = [
      { quarter: 'Q3 25', actual: 1.64, estimated: 1.6 },
      { quarter: 'Q2 25', actual: null, estimated: null },
    ]
    const view = await renderPanel({ status: 'loaded', points })
    expect(view.getByTestId('ticker-earnings-chart')).toBeOnTheScreen()
    expect(capturedChartData).toEqual(points)
    expect(view.getByText('Q3 25: actual $1.64, estimated $1.60')).toBeOnTheScreen()
    expect(view.getByText('Q2 25: actual Unavailable, estimated Unavailable')).toBeOnTheScreen()
  })
})
