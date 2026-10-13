import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { WatchlistScreen, type WatchlistScreenProps } from './watchlist-screen'

const loadedQuote = {
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

const rows = [
  { symbol: 'AAPL', quote: loadedQuote, quoteStatus: 'loaded' as const },
  { symbol: 'ZZZZ', quote: null, quoteStatus: 'error' as const },
  { symbol: 'MSFT', quote: null, quoteStatus: 'loading' as const },
]

async function setup(overrides: Partial<WatchlistScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: WatchlistScreenProps = {
    state: { status: 'loaded', rows },
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onSelectSymbol: jest.fn(),
    onRemove: jest.fn(),
    removingSymbol: null,
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><WatchlistScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('WatchlistScreen', () => {
  it('renders nothing during an access transition', async () => {
    const { view } = await setup({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('shows a loading state', async () => {
    const { view } = await setup({ state: { status: 'loading' } })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows a scoped error state with a working retry action', async () => {
    const { view, props } = await setup({ state: { status: 'error' } })
    expect(view.getByRole('header', { name: 'Could not load watchlist' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows an invalid-response state with a working retry action', async () => {
    const { view } = await setup({ state: { status: 'invalid-response' } })
    expect(view.getByRole('header', { name: 'Could not verify watchlist data' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()
  })

  it('shows a distinct, friendly empty state (not error copy)', async () => {
    const { view } = await setup({ state: { status: 'empty' } })
    expect(view.getByText('Your watchlist is empty')).toBeOnTheScreen()
    expect(view.getByText(/Search for a ticker/)).toBeOnTheScreen()
    expect(view.queryByText('Could not load watchlist')).not.toBeOnTheScreen()
  })

  it('lists every watchlisted symbol when loaded, with a loaded row showing price and signed change', async () => {
    const { view } = await setup()
    const appleRow = view.getByRole('button', { name: /AAPL.*\$232\.50.*\+\$1\.23/ })
    expect(appleRow).toBeOnTheScreen()
  })

  it('keeps a symbol visible and tappable even when its quote failed to load (degraded row)', async () => {
    const { view } = await setup()
    expect(view.getByRole('button', { name: /ZZZZ/ })).toBeOnTheScreen()
    expect(view.getByText('Quote unavailable')).toBeOnTheScreen()
  })

  it('keeps a symbol visible while its quote is still loading, without showing stale or error copy', async () => {
    const { view } = await setup()
    expect(view.getByRole('button', { name: 'MSFT' })).toBeOnTheScreen()
    expect(view.queryByText(/MSFT.*Quote unavailable/)).not.toBeOnTheScreen()
  })

  it('selects a symbol when its row is pressed', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: /AAPL/ }))
    expect(props.onSelectSymbol).toHaveBeenCalledWith('AAPL')
  })

  it('removes a symbol when its remove action is pressed, independently of navigating that row', async () => {
    const { view, props } = await setup()
    const row = view.getByTestId('watchlist-row-AAPL')
    await fireEvent.press(within(row).getByRole('button', { name: 'Remove' }))
    expect(props.onRemove).toHaveBeenCalledWith('AAPL')
    expect(props.onSelectSymbol).not.toHaveBeenCalled()
  })

  it('shows a busy, disabled remove action only for the symbol currently being removed', async () => {
    const { view } = await setup({ removingSymbol: 'AAPL' })
    const appleRow = view.getByTestId('watchlist-row-AAPL')
    const zzzzRow = view.getByTestId('watchlist-row-ZZZZ')
    expect(within(appleRow).getByRole('button', { name: 'Removing…' })).toBeDisabled()
    expect(within(zzzzRow).getByRole('button', { name: 'Remove' })).toBeEnabled()
  })

  it('invokes onBack from the back action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('keeps allowFontScaling on the title and row text', async () => {
    const { view } = await setup()
    expect(view.getByText('Watchlist').props.allowFontScaling).not.toBe(false)
    expect(view.getByText('AAPL').props.allowFontScaling).not.toBe(false)
  })
})
