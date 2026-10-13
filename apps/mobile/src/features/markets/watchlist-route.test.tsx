import { fireEvent, render } from '@testing-library/react-native'

import { WatchlistRoute } from './watchlist-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockRefetch = jest.fn()
const mockRemoveMutate = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))

let mockWatchlistState: {
  data?: { symbols: string[] }
  isAccessTransition: boolean
  isLoading: boolean
  isInitialFailure: boolean
  error: unknown
  refetch: () => void
} = {
  data: undefined,
  isAccessTransition: false,
  isLoading: true,
  isInitialFailure: false,
  error: null,
  refetch: mockRefetch,
}

let mockRemoveState: { isPending: boolean; variables: string | undefined } = { isPending: false, variables: undefined }

// Each quote is looked up by symbol so tests can drive per-symbol query state independently.
let mockQuoteResultsBySymbol: Record<string, { data?: unknown; isPending: boolean; isError: boolean }> = {}

jest.mock('./use-watchlist', () => ({
  useWatchlist: () => mockWatchlistState,
}))

jest.mock('./use-watchlist-mutations', () => ({
  useRemoveFromWatchlist: () => ({ ...mockRemoveState, mutate: mockRemoveMutate }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueries: ({ queries }: { queries: { queryKey: readonly unknown[] }[] }) => queries.map((query) => {
    const symbol = query.queryKey[query.queryKey.length - 1] as string
    return mockQuoteResultsBySymbol[symbol] ?? { data: undefined, isPending: true, isError: false }
  }),
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: jest.fn(), write: jest.fn() } }, blockAccess: jest.fn() }),
}))

jest.mock('./watchlist-screen', () => ({
  WatchlistScreen: (props: {
    state: { status: string; rows?: { symbol: string; quoteStatus: string }[] }
    onBack: () => void
    onRetry: () => void
    onSelectSymbol: (symbol: string) => void
    onRemove: (symbol: string) => void
    removingSymbol: string | null
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.Text testID="rows">{(props.state.rows ?? []).map((row) => `${row.symbol}:${row.quoteStatus}`).join(',')}</Native.Text>
        <Native.Text testID="removing-symbol">{props.removingSymbol ?? ''}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={props.onRetry}><Native.Text>Retry</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Select" onPress={() => props.onSelectSymbol('AAPL')}><Native.Text>Select</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => props.onRemove('AAPL')}><Native.Text>Remove</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('WatchlistRoute', () => {
  beforeEach(() => {
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear(); mockRemoveMutate.mockClear()
    mockWatchlistState = { data: undefined, isAccessTransition: false, isLoading: true, isInitialFailure: false, error: null, refetch: mockRefetch }
    mockRemoveState = { isPending: false, variables: undefined }
    mockQuoteResultsBySymbol = {}
  })

  it('shows access-transition, loading, error, and invalid-response states', async () => {
    mockWatchlistState = { ...mockWatchlistState, isAccessTransition: true, isLoading: false }
    const access = await render(<WatchlistRoute />)
    expect(access.getByTestId('state')).toHaveTextContent('access-transition')

    mockWatchlistState = { ...mockWatchlistState, isAccessTransition: false, isLoading: true }
    const loading = await render(<WatchlistRoute />)
    expect(loading.getByTestId('state')).toHaveTextContent('loading')

    mockWatchlistState = { ...mockWatchlistState, isLoading: false, isInitialFailure: true, error: { code: 'invalid-response' } }
    const invalid = await render(<WatchlistRoute />)
    expect(invalid.getByTestId('state')).toHaveTextContent('invalid-response')

    mockWatchlistState = { ...mockWatchlistState, isLoading: false, isInitialFailure: true, error: { code: 'network' } }
    const errored = await render(<WatchlistRoute />)
    expect(errored.getByTestId('state')).toHaveTextContent('error')
  })

  it('shows empty when the list has zero symbols', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: [] }, isLoading: false }
    const view = await render(<WatchlistRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('empty')
  })

  it('shows loaded with a row per symbol, each carrying its own quote status', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL', 'ZZZZ'] }, isLoading: false }
    mockQuoteResultsBySymbol = {
      AAPL: { data: { symbol: 'AAPL', price: 1 }, isPending: false, isError: false },
      ZZZZ: { data: undefined, isPending: false, isError: true },
    }
    const view = await render(<WatchlistRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('loaded')
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL:loaded,ZZZZ:error')
  })

  it('a per-row quote failure does not blank the list: rows stay loaded even when one query errors', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL', 'ZZZZ', 'MSFT'] }, isLoading: false }
    mockQuoteResultsBySymbol = {
      AAPL: { data: { symbol: 'AAPL', price: 1 }, isPending: false, isError: false },
      ZZZZ: { data: undefined, isPending: false, isError: true },
      MSFT: { data: undefined, isPending: true, isError: false },
    }
    const view = await render(<WatchlistRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('loaded')
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL:loaded,ZZZZ:error,MSFT:loading')
  })

  it('navigates to asset detail on row select', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL'] }, isLoading: false }
    const view = await render(<WatchlistRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/markets/[symbol]', params: { symbol: 'AAPL' } })
  })

  it('removes a symbol via the remove mutation', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL'] }, isLoading: false }
    const view = await render(<WatchlistRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Remove' }))
    expect(mockRemoveMutate).toHaveBeenCalledWith('AAPL')
  })

  it('reports the removing symbol only while the remove mutation is pending for that symbol', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL'] }, isLoading: false }
    mockRemoveState = { isPending: true, variables: 'AAPL' }
    const view = await render(<WatchlistRoute />)
    expect(view.getByTestId('removing-symbol')).toHaveTextContent('AAPL')
  })

  it('reports no removing symbol when the mutation is idle', async () => {
    mockWatchlistState = { ...mockWatchlistState, data: { symbols: ['AAPL'] }, isLoading: false }
    const view = await render(<WatchlistRoute />)
    expect(view.getByTestId('removing-symbol')).toHaveTextContent('')
  })

  it('refetches on retry', async () => {
    mockWatchlistState = { ...mockWatchlistState, isLoading: false, isInitialFailure: true, error: { code: 'network' } }
    const view = await render(<WatchlistRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('goes back when possible, otherwise replaces with the search screen', async () => {
    const view = await render(<WatchlistRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    const other = await render(<WatchlistRoute />)
    await fireEvent.press(other.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/markets')
  })
})
