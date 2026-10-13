import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { TickerFundamentalsPanel, type TickerFundamentalsState } from './ticker-fundamentals-panel'

const palette = themeTokens.colors.light

const data = {
  avgVolume: 50_000_000,
  beta: 1.234,
  dividendYield: 0.005,
  earningsPerShare: 6.1,
  fiftyTwoWeekHigh: 250,
  fiftyTwoWeekLow: 150,
  marketCap: 3_000_000_000_000,
  nextEarningsDate: '2026-09-15',
  pegRatio: 2.1,
  peRatio: 30.5,
  priceToBook: 40,
  priceToSales: 8,
  roe: 1.5,
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const },
  symbol: 'AAPL',
}

async function renderPanel(state: TickerFundamentalsState, currency: string | null = 'USD') {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <TickerFundamentalsPanel state={state} currency={currency} palette={palette} />
    </I18nextProvider>,
  )
}

describe('TickerFundamentalsPanel', () => {
  it('shows a loading indicator while fundamentals load', async () => {
    const view = await renderPanel({ status: 'loading' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an alert when fundamentals failed to load', async () => {
    const view = await renderPanel({ status: 'error' })
    expect(view.getByRole('alert')).toHaveTextContent('Could not load fundamentals')
  })

  it('renders every metric row with currency-aware formatting', async () => {
    const view = await renderPanel({ status: 'loaded', data })
    expect(view.getByLabelText('Market cap, 3T')).toBeOnTheScreen()
    expect(view.getByLabelText('52-week range, $150.00 – $250.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Avg. volume, 50,000,000')).toBeOnTheScreen()
    expect(view.getByLabelText('P/E (TTM), 30.50')).toBeOnTheScreen()
    expect(view.getByLabelText('EPS (TTM), $6.10')).toBeOnTheScreen()
    expect(view.getByLabelText('Dividend yield, 0.5%')).toBeOnTheScreen()
    expect(view.getByLabelText('Beta, 1.23')).toBeOnTheScreen()
    expect(view.getByLabelText('Next earnings, Sep 15, 2026')).toBeOnTheScreen()
  })

  it('falls back to a plain formatted number when currency is null', async () => {
    const view = await renderPanel({ status: 'loaded', data }, null)
    expect(view.getByLabelText('52-week range, 150.00 – 250.00')).toBeOnTheScreen()
    expect(view.getByLabelText('EPS (TTM), 6.10')).toBeOnTheScreen()
  })

  it('shows "Unavailable" for every null metric without crashing', async () => {
    const allNull = {
      ...data,
      avgVolume: null,
      beta: null,
      dividendYield: null,
      earningsPerShare: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      marketCap: null,
      nextEarningsDate: null,
      peRatio: null,
    }
    const view = await renderPanel({ status: 'loaded', data: allNull })
    expect(view.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })
})
