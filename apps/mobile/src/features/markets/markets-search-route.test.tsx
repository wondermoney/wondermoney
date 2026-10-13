import { fireEvent, render } from '@testing-library/react-native'

import { MarketsSearchRoute } from './markets-search-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))

let mockSearchState: {
  data?: unknown
  isAccessTransition: boolean
  isInitialFailure: boolean
  error: unknown
} = { data: undefined, isAccessTransition: false, isInitialFailure: false, error: null }

jest.mock('./use-ticker-search', () => ({
  useTickerSearch: (_term: string) => mockSearchState,
}))

jest.mock('./markets-search-screen', () => ({
  MarketsSearchScreen: (props: {
    state: { status: string }
    query: string
    onQueryChange: (value: string) => void
    onSelectSymbol: (symbol: string) => void
    onBack: () => void
    onOpenWatchlist: () => void
    onOpenScreener: () => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.TextInput
          testID="query-input"
          value={props.query}
          onChangeText={props.onQueryChange}
        />
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Select" onPress={() => props.onSelectSymbol('AAPL')}><Native.Text>Select</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Watchlist" onPress={props.onOpenWatchlist}><Native.Text>Watchlist</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Screener" onPress={props.onOpenScreener}><Native.Text>Screener</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('MarketsSearchRoute', () => {
  beforeEach(() => {
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockSearchState = { data: undefined, isAccessTransition: false, isInitialFailure: false, error: null }
  })

  it('starts idle before any query is typed', async () => {
    const view = await render(<MarketsSearchRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('idle')
  })

  it('shows loading once a query is typed but no data has arrived yet', async () => {
    const view = await render(<MarketsSearchRoute />)
    await fireEvent.changeText(view.getByTestId('query-input'), 'aapl')
    expect(view.getByTestId('state')).toHaveTextContent('loading')
  })

  it('shows loaded rows when results arrive, empty when they are zero', async () => {
    mockSearchState = {
      data: { results: [{ currency: null, exchange: null, name: 'Apple Inc', symbol: 'AAPL', type: null }], source: { asOf: null, provider: 'eodhd' } },
      isAccessTransition: false,
      isInitialFailure: false,
      error: null,
    }
    const view = await render(<MarketsSearchRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('loaded')

    mockSearchState = { data: { results: [], source: { asOf: null, provider: 'eodhd' } }, isAccessTransition: false, isInitialFailure: false, error: null }
    const empty = await render(<MarketsSearchRoute />)
    expect(empty.getByTestId('state')).toHaveTextContent('empty')
  })

  it('surfaces access transitions and classified failures', async () => {
    mockSearchState = { data: undefined, isAccessTransition: true, isInitialFailure: false, error: null }
    const access = await render(<MarketsSearchRoute />)
    expect(access.getByTestId('state')).toHaveTextContent('access-transition')

    mockSearchState = { data: undefined, isAccessTransition: false, isInitialFailure: true, error: { code: 'invalid-response' } }
    const invalid = await render(<MarketsSearchRoute />)
    expect(invalid.getByTestId('state')).toHaveTextContent('invalid-response')

    mockSearchState = { data: undefined, isAccessTransition: false, isInitialFailure: true, error: { code: 'network' } }
    const failed = await render(<MarketsSearchRoute />)
    expect(failed.getByTestId('state')).toHaveTextContent('error')
  })

  it('navigates to the asset-detail route on row press', async () => {
    mockSearchState = {
      data: { results: [{ currency: null, exchange: null, name: 'Apple Inc', symbol: 'AAPL', type: null }], source: { asOf: null, provider: 'eodhd' } },
      isAccessTransition: false,
      isInitialFailure: false,
      error: null,
    }
    const view = await render(<MarketsSearchRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/markets/[symbol]', params: { symbol: 'AAPL' } })
  })

  it('navigates to the watchlist route from the entry-point action', async () => {
    const view = await render(<MarketsSearchRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Watchlist' }))
    expect(mockPush).toHaveBeenCalledWith('/markets/watchlist')
  })

  it('navigates to the screener route from the entry-point action', async () => {
    const view = await render(<MarketsSearchRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Screener' }))
    expect(mockPush).toHaveBeenCalledWith('/markets/screener')
  })

  it('goes back when possible, otherwise replaces with more', async () => {
    const view = await render(<MarketsSearchRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    const other = await render(<MarketsSearchRoute />)
    await fireEvent.press(other.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/more')
  })
})
