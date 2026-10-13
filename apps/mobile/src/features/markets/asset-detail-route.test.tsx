import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { AssetDetailRoute } from './asset-detail-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockRefetch = jest.fn()
const mockAddMutate = jest.fn()
const mockRemoveMutate = jest.fn()
let mockParams: { symbol?: string | string[] } = { symbol: 'AAPL' }

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useLocalSearchParams: () => mockParams,
}))

const quote = {
  change: 1.23,
  changePercent: 0.45,
  currency: 'USD',
  marketState: 'open',
  name: 'Apple Inc',
  price: 232.5,
  source: { asOf: null, provider: 'eodhd' },
  symbol: 'AAPL',
  timestamp: null,
  volume: 1_000_000,
}

let mockQuoteState: {
  data?: unknown
  isInvalidId: boolean
  isAccessTransition: boolean
  isLoading: boolean
  isNotFound: boolean
  isRefreshFailure: boolean
  error: unknown
  refetch: () => void
} = {
  data: undefined,
  isInvalidId: false,
  isAccessTransition: false,
  isLoading: true,
  isNotFound: false,
  isRefreshFailure: false,
  error: null,
  refetch: mockRefetch,
}

let mockWatchlistState: { data?: { symbols: string[] } } = { data: undefined }
let mockAddState: { isPending: boolean } = { isPending: false }
let mockRemoveState: { isPending: boolean } = { isPending: false }
let mockCompanyInfoState: { data?: { companyInformation: unknown } } = { data: undefined }
let mockHistoricalPriceState: { data?: unknown; isPending: boolean; isAccessTransition: boolean } = { data: undefined, isPending: true, isAccessTransition: false }
let mockFundamentalsState: { data?: unknown; isPending: boolean; isAccessTransition: boolean } = { data: undefined, isPending: true, isAccessTransition: false }
let mockFinancialsState: { data?: unknown; isPending: boolean; isAccessTransition: boolean } = { data: undefined, isPending: true, isAccessTransition: false }
let mockEarningsState: { data?: unknown; isPending: boolean; isAccessTransition: boolean } = { data: undefined, isPending: true, isAccessTransition: false }

jest.mock('./use-quote', () => ({
  useQuote: (_symbol: string | null) => mockQuoteState,
}))

jest.mock('./use-company-info', () => ({
  useCompanyInfo: (_symbol: string | null) => mockCompanyInfoState,
}))

jest.mock('./use-historical-price', () => ({
  useHistoricalPrice: (_symbol: string | null, _period: string) => mockHistoricalPriceState,
}))

jest.mock('./use-ticker-fundamentals', () => ({
  useTickerFundamentals: (_symbol: string | null) => mockFundamentalsState,
}))

jest.mock('./use-ticker-financials', () => ({
  useTickerFinancials: (_symbol: string | null) => mockFinancialsState,
}))

jest.mock('./use-ticker-earnings', () => ({
  useTickerEarnings: (_symbol: string | null) => mockEarningsState,
}))

jest.mock('./use-watchlist', () => ({
  useWatchlist: () => mockWatchlistState,
}))

jest.mock('./use-watchlist-mutations', () => ({
  useAddToWatchlist: () => ({ ...mockAddState, mutate: mockAddMutate }),
  useRemoveFromWatchlist: () => ({ ...mockRemoveState, mutate: mockRemoveMutate }),
}))

type CapturedState = { status: string; data?: { name: string | null; currency: string | null } }
let capturedState: CapturedState | null = null
let capturedPriceChart: { state: { status: string }; period: string } | null = null
let capturedFundamentals: { status: string } | null = null
let capturedFinancials: { status: string } | null = null
let capturedEarnings: { status: string } | null = null

jest.mock('./asset-detail-screen', () => ({
  AssetDetailScreen: (props: {
    state: CapturedState
    onBack: () => void
    onRetry: () => void
    watchlistToggle: { status: string; isWatchlisted?: boolean }
    onToggleWatchlist: () => void
    isTogglingWatchlist: boolean
    priceChart: { state: { status: string }; period: string }
    fundamentals: { status: string }
    financials: { status: string }
    earnings: { status: string }
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    capturedState = props.state
    capturedPriceChart = props.priceChart
    capturedFundamentals = props.fundamentals
    capturedFinancials = props.financials
    capturedEarnings = props.earnings
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.Text testID="watchlist-toggle-status">{props.watchlistToggle.status}</Native.Text>
        <Native.Text testID="watchlist-is-watchlisted">{String(props.watchlistToggle.isWatchlisted ?? '')}</Native.Text>
        <Native.Text testID="watchlist-is-toggling">{String(props.isTogglingWatchlist)}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={props.onRetry}><Native.Text>Retry</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ToggleWatchlist" onPress={props.onToggleWatchlist}><Native.Text>Toggle</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('AssetDetailRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear()
    mockAddMutate.mockClear()
    mockRemoveMutate.mockClear()
    mockParams = { symbol: 'AAPL' }
    mockQuoteState = {
      data: undefined,
      isInvalidId: false,
      isAccessTransition: false,
      isLoading: true,
      isNotFound: false,
      isRefreshFailure: false,
      error: null,
      refetch: mockRefetch,
    }
    mockWatchlistState = { data: undefined }
    mockAddState = { isPending: false }
    mockRemoveState = { isPending: false }
    mockCompanyInfoState = { data: undefined }
    mockHistoricalPriceState = { data: undefined, isPending: true, isAccessTransition: false }
    mockFundamentalsState = { data: undefined, isPending: true, isAccessTransition: false }
    mockFinancialsState = { data: undefined, isPending: true, isAccessTransition: false }
    mockEarningsState = { data: undefined, isPending: true, isAccessTransition: false }
    capturedState = null
    capturedPriceChart = null
    capturedFundamentals = null
    capturedFinancials = null
    capturedEarnings = null
  })

  it('shows invalid-id when the route param fails validation', async () => {
    mockParams = { symbol: '' }
    mockQuoteState = { ...mockQuoteState, isInvalidId: true, isLoading: false }
    const view = await render(<AssetDetailRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('invalid-id')
  })

  it('treats an array route param as invalid', async () => {
    mockParams = { symbol: ['AAPL', 'MSFT'] }
    mockQuoteState = { ...mockQuoteState, isInvalidId: true, isLoading: false }
    const view = await render(<AssetDetailRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('invalid-id')
  })

  it('shows access-transition, loading, loaded, not-found, invalid-response, and error states', async () => {
    mockQuoteState = { ...mockQuoteState, isAccessTransition: true, isLoading: false }
    const access = await render(<AssetDetailRoute />)
    expect(access.getByTestId('state')).toHaveTextContent('access-transition')

    mockQuoteState = { ...mockQuoteState, isAccessTransition: false, isLoading: true }
    const loading = await render(<AssetDetailRoute />)
    expect(loading.getByTestId('state')).toHaveTextContent('loading')

    mockQuoteState = { ...mockQuoteState, data: quote, isLoading: false, isRefreshFailure: false }
    const loaded = await render(<AssetDetailRoute />)
    expect(loaded.getByTestId('state')).toHaveTextContent('loaded')

    mockQuoteState = { ...mockQuoteState, data: quote, isLoading: false, isRefreshFailure: true }
    const refreshError = await render(<AssetDetailRoute />)
    expect(refreshError.getByTestId('state')).toHaveTextContent('refresh-error')

    mockQuoteState = { ...mockQuoteState, data: undefined, isLoading: false, isNotFound: true }
    const notFound = await render(<AssetDetailRoute />)
    expect(notFound.getByTestId('state')).toHaveTextContent('not-found')

    mockQuoteState = { ...mockQuoteState, data: undefined, isLoading: false, isNotFound: false, error: new ApiError('invalid-response') }
    const invalid = await render(<AssetDetailRoute />)
    expect(invalid.getByTestId('state')).toHaveTextContent('invalid-response')

    mockQuoteState = { ...mockQuoteState, data: undefined, isLoading: false, isNotFound: false, error: new ApiError('network') }
    const errored = await render(<AssetDetailRoute />)
    expect(errored.getByTestId('state')).toHaveTextContent('error')
  })

  it('refetches on retry', async () => {
    mockQuoteState = { ...mockQuoteState, isLoading: false, error: new ApiError('network') }
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('goes back when possible, otherwise replaces with the search screen', async () => {
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    const other = await render(<AssetDetailRoute />)
    await fireEvent.press(other.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/markets')
  })

  it('reports watchlist membership as unknown while the watchlist query has no data, or the id is invalid', async () => {
    mockWatchlistState = { data: undefined }
    const view = await render(<AssetDetailRoute />)
    expect(view.getByTestId('watchlist-toggle-status')).toHaveTextContent('unknown')

    mockParams = { symbol: '' }
    mockWatchlistState = { data: { symbols: ['AAPL'] } }
    const invalidId = await render(<AssetDetailRoute />)
    expect(invalidId.getByTestId('watchlist-toggle-status')).toHaveTextContent('unknown')
  })

  it('reports membership as known and true when the uppercased symbol is on the list', async () => {
    mockWatchlistState = { data: { symbols: ['AAPL', 'MSFT'] } }
    const view = await render(<AssetDetailRoute />)
    expect(view.getByTestId('watchlist-toggle-status')).toHaveTextContent('known')
    expect(view.getByTestId('watchlist-is-watchlisted')).toHaveTextContent('true')
  })

  it('reports membership as known and false when the symbol is absent from the list', async () => {
    mockWatchlistState = { data: { symbols: ['MSFT'] } }
    const view = await render(<AssetDetailRoute />)
    expect(view.getByTestId('watchlist-toggle-status')).toHaveTextContent('known')
    expect(view.getByTestId('watchlist-is-watchlisted')).toHaveTextContent('false')
  })

  it('calls add when the symbol is not watchlisted and the toggle is pressed', async () => {
    mockWatchlistState = { data: { symbols: [] } }
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ToggleWatchlist' }))
    expect(mockAddMutate).toHaveBeenCalledWith('AAPL')
    expect(mockRemoveMutate).not.toHaveBeenCalled()
  })

  it('calls remove when the symbol is watchlisted and the toggle is pressed', async () => {
    mockWatchlistState = { data: { symbols: ['AAPL'] } }
    const view = await render(<AssetDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ToggleWatchlist' }))
    expect(mockRemoveMutate).toHaveBeenCalledWith('AAPL')
    expect(mockAddMutate).not.toHaveBeenCalled()
  })

  it('reports isTogglingWatchlist true when either mutation is pending', async () => {
    mockWatchlistState = { data: { symbols: [] } }
    mockAddState = { isPending: true }
    const adding = await render(<AssetDetailRoute />)
    expect(adding.getByTestId('watchlist-is-toggling')).toHaveTextContent('true')

    mockAddState = { isPending: false }
    mockRemoveState = { isPending: true }
    const removing = await render(<AssetDetailRoute />)
    expect(removing.getByTestId('watchlist-is-toggling')).toHaveTextContent('true')
  })

  describe('company info merge', () => {
    it('fills in the quote\'s always-null name/currency from company info', async () => {
      mockQuoteState = { ...mockQuoteState, data: quote, isLoading: false }
      mockCompanyInfoState = { data: { companyInformation: { beta: null, ceo: null, changePercentage: null, country: 'US', currency: 'EUR', description: null, employees: null, exchange: 'NASDAQ', image: null, industry: null, name: 'Apple Incorporated', price: null, sector: null, symbol: 'AAPL', website: null } } }
      await render(<AssetDetailRoute />)
      expect(capturedState?.data).toMatchObject({ name: 'Apple Inc', currency: 'USD' })
    })

    it('leaves the quote untouched when company info has not loaded', async () => {
      mockQuoteState = { ...mockQuoteState, data: quote, isLoading: false }
      mockCompanyInfoState = { data: undefined }
      await render(<AssetDetailRoute />)
      expect(capturedState?.data).toMatchObject({ name: 'Apple Inc', currency: 'USD' })
    })
  })

  describe('price chart wiring', () => {
    it('reports loading while the query has no data yet', async () => {
      mockHistoricalPriceState = { data: undefined, isPending: true, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedPriceChart?.state.status).toBe('loading')
    })

    it('reports loaded once the query resolves', async () => {
      mockHistoricalPriceState = { data: { prices: [{ adjClose: null, close: 100, date: '2026-07-01', high: null, low: null, open: null, volume: null }], source: { asOf: null, provider: 'eodhd' }, symbol: 'AAPL' }, isPending: false, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedPriceChart?.state.status).toBe('loaded')
    })

    it('reports error when the query failed without leaving an access transition', async () => {
      mockHistoricalPriceState = { data: undefined, isPending: false, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedPriceChart?.state.status).toBe('error')
    })

    it('defaults to the 1Y period', async () => {
      await render(<AssetDetailRoute />)
      expect(capturedPriceChart?.period).toBe('1Y')
    })
  })

  describe('fundamentals wiring', () => {
    it('reports loading while the query has no data yet', async () => {
      mockFundamentalsState = { data: undefined, isPending: true, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedFundamentals?.status).toBe('loading')
    })

    it('reports loaded once the query resolves', async () => {
      mockFundamentalsState = {
        data: {
          avgVolume: 50_000_000, beta: 1.2, dividendYield: 0.005, earningsPerShare: 6.1,
          fiftyTwoWeekHigh: 250, fiftyTwoWeekLow: 150, marketCap: 3_000_000_000_000,
          nextEarningsDate: '2026-09-15', pegRatio: 2.1, peRatio: 30.5, priceToBook: 40,
          priceToSales: 8, roe: 1.5, source: { asOf: null, provider: 'eodhd' }, symbol: 'AAPL',
        },
        isPending: false,
        isAccessTransition: false,
      }
      await render(<AssetDetailRoute />)
      expect(capturedFundamentals?.status).toBe('loaded')
    })

    it('reports error when the query failed without leaving an access transition', async () => {
      mockFundamentalsState = { data: undefined, isPending: false, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedFundamentals?.status).toBe('error')
    })

    it('reports loading during an access transition rather than a bare error', async () => {
      mockFundamentalsState = { data: undefined, isPending: false, isAccessTransition: true }
      await render(<AssetDetailRoute />)
      expect(capturedFundamentals?.status).toBe('loading')
    })
  })

  describe('financials wiring', () => {
    it('reports loading while the query has no data yet', async () => {
      mockFinancialsState = { data: undefined, isPending: true, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedFinancials?.status).toBe('loading')
    })

    it('reports loaded once the query resolves', async () => {
      mockFinancialsState = {
        data: { financials: [{ grossProfit: null, netIncome: 1, operatingIncome: null, period: 'FY2024', revenue: 2 }], source: { asOf: null, provider: 'eodhd' }, symbol: 'AAPL' },
        isPending: false,
        isAccessTransition: false,
      }
      await render(<AssetDetailRoute />)
      expect(capturedFinancials?.status).toBe('loaded')
    })

    it('reports error when the query failed without leaving an access transition', async () => {
      mockFinancialsState = { data: undefined, isPending: false, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedFinancials?.status).toBe('error')
    })

    it('reports loading during an access transition rather than a bare error', async () => {
      mockFinancialsState = { data: undefined, isPending: false, isAccessTransition: true }
      await render(<AssetDetailRoute />)
      expect(capturedFinancials?.status).toBe('loading')
    })
  })

  describe('earnings wiring', () => {
    it('reports loading while the query has no data yet', async () => {
      mockEarningsState = { data: undefined, isPending: true, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedEarnings?.status).toBe('loading')
    })

    it('reports loaded once the query resolves', async () => {
      mockEarningsState = {
        data: { earnings: [{ date: '2025-07-31', eps: 1.64, epsEstimated: 1.6, revenue: 1, revenueEstimated: 1 }], source: { asOf: null, provider: 'eodhd' }, symbol: 'AAPL' },
        isPending: false,
        isAccessTransition: false,
      }
      await render(<AssetDetailRoute />)
      expect(capturedEarnings?.status).toBe('loaded')
    })

    it('reports error when the query failed without leaving an access transition', async () => {
      mockEarningsState = { data: undefined, isPending: false, isAccessTransition: false }
      await render(<AssetDetailRoute />)
      expect(capturedEarnings?.status).toBe('error')
    })

    it('reports loading during an access transition rather than a bare error', async () => {
      mockEarningsState = { data: undefined, isPending: false, isAccessTransition: true }
      await render(<AssetDetailRoute />)
      expect(capturedEarnings?.status).toBe('loading')
    })
  })
})
