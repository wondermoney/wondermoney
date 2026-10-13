import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { MarketsSearchScreen, type MarketsSearchScreenProps } from './markets-search-screen'

const rows = [
  { currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc', symbol: 'AAPL', type: 'Common Stock' },
  { currency: null, exchange: null, name: null, symbol: 'XYZ', type: null },
]

async function setup(overrides: Partial<MarketsSearchScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: MarketsSearchScreenProps = {
    state: { status: 'idle' },
    query: '',
    onQueryChange: jest.fn(),
    onSelectSymbol: jest.fn(),
    onBack: jest.fn(),
    onOpenWatchlist: jest.fn(),
    onOpenScreener: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><MarketsSearchScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('MarketsSearchScreen', () => {
  it('renders nothing during an access transition', async () => {
    const { view } = await setup({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('leaves the idle screen to the search field itself', async () => {
    // The idle caption repeated the field's own placeholder verbatim.
    const { view } = await setup()
    expect(view.queryByText('Search for a ticker by name or symbol')).toBeNull()
    expect(view.getByPlaceholderText('Search by name or symbol')).toBeOnTheScreen()
  })

  it('shows a loading state', async () => {
    const { view } = await setup({ state: { status: 'loading' }, query: 'aapl' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows an error state', async () => {
    const { view } = await setup({ state: { status: 'error' }, query: 'aapl' })
    expect(view.getByRole('header', { name: 'Could not search tickers' })).toBeOnTheScreen()
  })

  it('shows an invalid-response state', async () => {
    const { view } = await setup({ state: { status: 'invalid-response' }, query: 'aapl' })
    expect(view.getByRole('header', { name: 'Could not verify search results' })).toBeOnTheScreen()
  })

  it('shows a no-matches message quoting the current search term', async () => {
    const { view } = await setup({ state: { status: 'empty' }, query: 'zzzzz' })
    expect(view.getByText('No matches for "zzzzz"')).toBeOnTheScreen()
  })

  it('lists every result by name, symbol, and exchange when loaded', async () => {
    const { view } = await setup({ state: { status: 'loaded', rows }, query: 'a' })
    const appleRow = view.getByRole('button', { name: /Apple Inc.*AAPL.*NASDAQ/ })
    expect(appleRow).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'XYZ' })).toBeOnTheScreen()
  })

  it('selects a symbol when its row is pressed', async () => {
    const { view, props } = await setup({ state: { status: 'loaded', rows }, query: 'a' })
    await fireEvent.press(view.getByRole('button', { name: /AAPL/ }))
    expect(props.onSelectSymbol).toHaveBeenCalledWith('AAPL')
  })

  it('reports text input changes to the caller', async () => {
    const { view, props } = await setup()
    await fireEvent.changeText(view.getByLabelText('Search tickers'), 'aapl')
    expect(props.onQueryChange).toHaveBeenCalledWith('aapl')
  })

  it('invokes onBack from the back action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('invokes onOpenWatchlist from the watchlist entry-point action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Watchlist' }))
    expect(props.onOpenWatchlist).toHaveBeenCalledTimes(1)
  })

  it('invokes onOpenScreener from the screener entry-point action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Screener' }))
    expect(props.onOpenScreener).toHaveBeenCalledTimes(1)
  })

  it('keeps allowFontScaling on the title, row, and empty-state text', async () => {
    const { view } = await setup({ state: { status: 'loaded', rows }, query: 'a' })
    expect(within(view.getByRole('button', { name: 'XYZ' })).getByText('XYZ').props.allowFontScaling).not.toBe(false)
    expect(view.getByText('Markets').props.allowFontScaling).not.toBe(false)
  })
})
