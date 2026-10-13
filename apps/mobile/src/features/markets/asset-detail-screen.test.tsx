import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { AssetDetailScreen, type AssetDetailScreenProps } from './asset-detail-screen'

const quote = {
  change: 1.23,
  changePercent: 0.45,
  currency: 'USD',
  marketState: 'open' as const,
  name: 'Apple Inc',
  price: 232.5,
  source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' as const },
  symbol: 'AAPL',
  timestamp: '2026-08-10T10:00:00.000Z',
  volume: 1_000_000,
}

async function setup(overrides: Partial<AssetDetailScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: AssetDetailScreenProps = {
    state: { status: 'loaded', data: quote },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    watchlistToggle: { status: 'unknown' },
    onToggleWatchlist: jest.fn(),
    isTogglingWatchlist: false,
    priceChart: { state: { status: 'loading' }, period: '1Y', onSelectPeriod: jest.fn() },
    fundamentals: { status: 'loading' },
    financials: { status: 'loading' },
    earnings: { status: 'loading' },
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><AssetDetailScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('AssetDetailScreen', () => {
  it('renders nothing during an access transition', async () => {
    const { view } = await setup({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('shows a loading state', async () => {
    const { view } = await setup({ state: { status: 'loading' } })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows a not-found state without a retry action', async () => {
    const { view } = await setup({ state: { status: 'not-found' } })
    expect(view.getByRole('header', { name: 'Ticker not found' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
  })

  it('shows an invalid-id state without a retry action', async () => {
    const { view } = await setup({ state: { status: 'invalid-id' } })
    expect(view.getByRole('header', { name: 'Ticker not available' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
  })

  it('shows an error state with a working retry action', async () => {
    const { view, props } = await setup({ state: { status: 'error' } })
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows an invalid-response state with a working retry action', async () => {
    const { view } = await setup({ state: { status: 'invalid-response' } })
    expect(view.getByRole('header', { name: 'Could not verify quote data' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()
  })

  it('shows symbol, name, price, market state, and as-of time when loaded', async () => {
    const { view } = await setup()
    expect(view.getByText('AAPL')).toBeOnTheScreen()
    expect(view.getByText('Apple Inc')).toBeOnTheScreen()
    expect(view.getByLabelText(/Price, \$232\.50/)).toBeOnTheScreen()
    expect(view.getByLabelText('Market, Open')).toBeOnTheScreen()
    expect(view.getByText(/As of/)).toBeOnTheScreen()
  })

  it('signs a positive change with a plus prefix, alongside color, not color alone', async () => {
    const { view } = await setup()
    expect(view.getByLabelText(/Change, \+\$1\.23/)).toBeOnTheScreen()
  })

  it('signs a negative change using the native minus sign', async () => {
    const { view } = await setup({
      state: { status: 'loaded', data: { ...quote, change: -1.23, changePercent: -0.45 } },
    })
    expect(view.getByLabelText(/Change, -\$1\.23/)).toBeOnTheScreen()
  })

  it('formats price and change with a locale-aware plain number when currency is null', async () => {
    const { view } = await setup({
      state: { status: 'loaded', data: { ...quote, currency: null } },
    })
    expect(view.queryByText(/\$/)).not.toBeOnTheScreen()
    expect(view.getByLabelText(/Price, 232\.5/)).toBeOnTheScreen()
  })

  it('shows unavailable for a null price, change, or volume without crashing', async () => {
    const { view } = await setup({
      state: { status: 'loaded', data: { ...quote, price: null, change: null, changePercent: null, volume: null } },
    })
    expect(view.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  it('shows a stale banner on refresh-error while keeping loaded data visible', async () => {
    const { view } = await setup({ state: { status: 'refresh-error', data: quote } })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByText('AAPL')).toBeOnTheScreen()
  })

  it('invokes onBack from the back action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: /back/i }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('hides the watchlist toggle while membership status is unknown', async () => {
    const { view } = await setup({ watchlistToggle: { status: 'unknown' } })
    expect(view.queryByRole('button', { name: 'Add to watchlist' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Remove from watchlist' })).not.toBeOnTheScreen()
  })

  it('shows "Add to watchlist" when the symbol is not on the list, and calls onToggleWatchlist on press', async () => {
    const { view, props } = await setup({ watchlistToggle: { status: 'known', isWatchlisted: false } })
    const toggle = view.getByRole('button', { name: 'Add to watchlist' })
    await fireEvent.press(toggle)
    expect(props.onToggleWatchlist).toHaveBeenCalledTimes(1)
  })

  it('shows "Remove from watchlist" when the symbol is already on the list, and calls onToggleWatchlist on press', async () => {
    const { view, props } = await setup({ watchlistToggle: { status: 'known', isWatchlisted: true } })
    const toggle = view.getByRole('button', { name: 'Remove from watchlist' })
    await fireEvent.press(toggle)
    expect(props.onToggleWatchlist).toHaveBeenCalledTimes(1)
  })

  it('shows a busy, disabled toggle while the mutation is pending and does not call onToggleWatchlist', async () => {
    const { view, props } = await setup({ watchlistToggle: { status: 'known', isWatchlisted: false }, isTogglingWatchlist: true })
    const toggle = view.getByRole('button', { name: 'Updating…' })
    expect(toggle).toBeDisabled()
    await fireEvent.press(toggle)
    expect(props.onToggleWatchlist).not.toHaveBeenCalled()
  })

  it('does not render the watchlist toggle outside the loaded/refresh-error data states', async () => {
    const { view } = await setup({ state: { status: 'loading' }, watchlistToggle: { status: 'known', isWatchlisted: false } })
    expect(view.queryByRole('button', { name: 'Add to watchlist' })).not.toBeOnTheScreen()
  })

  it('keeps the watchlist toggle visible alongside the stale banner on refresh-error', async () => {
    const { view } = await setup({ state: { status: 'refresh-error', data: quote }, watchlistToggle: { status: 'known', isWatchlisted: true } })
    expect(view.getByRole('button', { name: 'Remove from watchlist' })).toBeOnTheScreen()
  })

  it('renders the fundamentals panel with the fetched data', async () => {
    const { view } = await setup({
      fundamentals: {
        status: 'loaded',
        data: {
          avgVolume: 50_000_000,
          beta: 1.2,
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
          source: { asOf: '2026-08-10T10:00:00.000Z', provider: 'eodhd' },
          symbol: 'AAPL',
        },
      },
    })
    expect(view.getByRole('header', { name: 'Fundamentals' })).toBeOnTheScreen()
    expect(view.getByLabelText(/P\/E \(TTM\), 30\.50/)).toBeOnTheScreen()
  })

  it('shows the fundamentals panel loading and error states', async () => {
    const loading = await setup({ fundamentals: { status: 'loading' } })
    expect(loading.view.getByLabelText('Loading fundamentals…')).toBeOnTheScreen()

    const failed = await setup({ fundamentals: { status: 'error' } })
    expect(failed.view.getByText('Could not load fundamentals')).toBeOnTheScreen()
  })

  it('shows the financials panel loading, empty, and error states', async () => {
    const loading = await setup({ financials: { status: 'loading' } })
    expect(loading.view.getByLabelText('Loading financials…')).toBeOnTheScreen()

    const empty = await setup({ financials: { status: 'loaded', points: [] } })
    expect(empty.view.getByText('No financials data available')).toBeOnTheScreen()

    const failed = await setup({ financials: { status: 'error' } })
    expect(failed.view.getByText('Could not load financials')).toBeOnTheScreen()
  })

  it('shows the earnings panel loading, empty, and error states', async () => {
    const loading = await setup({ earnings: { status: 'loading' } })
    expect(loading.view.getByLabelText('Loading earnings…')).toBeOnTheScreen()

    const empty = await setup({ earnings: { status: 'loaded', points: [] } })
    expect(empty.view.getByText('No earnings data available')).toBeOnTheScreen()

    const failed = await setup({ earnings: { status: 'error' } })
    expect(failed.view.getByText('Could not load earnings')).toBeOnTheScreen()
  })
})
