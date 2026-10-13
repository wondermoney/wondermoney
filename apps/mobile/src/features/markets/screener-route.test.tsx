import { fireEvent, render } from '@testing-library/react-native'

import { ScreenerRoute } from './screener-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockRefetch = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}))

const page0 = {
  hasMore: true,
  page: 0,
  pageSize: 25,
  results: [{ marketCap: 1, name: 'Apple Inc', price: 232.5, sector: 'Technology', symbol: 'AAPL' }],
  source: { asOf: null, provider: 'eodhd' },
}
const page1 = {
  hasMore: false,
  page: 1,
  pageSize: 25,
  results: [{ marketCap: 2, name: 'Microsoft Corp', price: 400, sector: 'Technology', symbol: 'MSFT' }],
  source: { asOf: null, provider: 'eodhd' },
}
const emptyPage0 = { hasMore: false, page: 0, pageSize: 25, results: [], source: { asOf: null, provider: 'eodhd' } }

let mockScreenerState: {
  data?: unknown
  isAccessTransition: boolean
  isInitialFailure: boolean
  isFetching: boolean
  error: unknown
  refetch: () => void
} = { data: undefined, isAccessTransition: false, isInitialFailure: false, isFetching: false, error: null, refetch: mockRefetch }

let capturedFilters: unknown

jest.mock('./use-screener', () => ({
  useScreener: (filters: unknown) => { capturedFilters = filters; return mockScreenerState },
}))

jest.mock('./screener-screen', () => ({
  ScreenerScreen: (props: {
    state: { status: string; rows?: { symbol: string }[]; hasMore?: boolean; loadingMore?: boolean; loadMoreError?: boolean }
    form: { isEtf: boolean; isActivelyTrading: boolean; priceMoreThan: string; priceLowerThan: string; marketCapMoreThan: string; marketCapLowerThan: string; sector: string | null }
    onFormChange: (patch: Record<string, boolean | string | null>) => void
    onApplyFilters: () => void
    onLoadMore: () => void
    onSelectSymbol: (symbol: string) => void
    onBack: () => void
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <>
        <Native.Text testID="state">{props.state.status}</Native.Text>
        <Native.Text testID="rows">{(props.state.rows ?? []).map((row) => row.symbol).join(',')}</Native.Text>
        <Native.Text testID="has-more">{String(Boolean(props.state.hasMore))}</Native.Text>
        <Native.Text testID="loading-more">{String(Boolean(props.state.loadingMore))}</Native.Text>
        <Native.Text testID="load-more-error">{String(Boolean(props.state.loadMoreError))}</Native.Text>
        <Native.Text testID="isEtf">{String(props.form.isEtf)}</Native.Text>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="ToggleEtf" onPress={() => props.onFormChange({ isEtf: true })}><Native.Text>ToggleEtf</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="SetSector" onPress={() => props.onFormChange({ sector: 'Technology' })}><Native.Text>SetSector</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Apply" onPress={props.onApplyFilters}><Native.Text>Apply</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="LoadMore" onPress={props.onLoadMore}><Native.Text>LoadMore</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Select" onPress={() => props.onSelectSymbol('AAPL')}><Native.Text>Select</Native.Text></Native.Pressable>
        <Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}><Native.Text>Back</Native.Text></Native.Pressable>
      </>
    )
  },
}))

describe('ScreenerRoute', () => {
  beforeEach(() => {
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockRefetch.mockClear()
    mockScreenerState = { data: undefined, isAccessTransition: false, isInitialFailure: false, isFetching: false, error: null, refetch: mockRefetch }
    capturedFilters = undefined
  })

  it('starts idle and fires no request before filters are applied', async () => {
    const view = await render(<ScreenerRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('idle')
    expect(capturedFilters).toBeNull()
  })

  it('stages form changes without applying them until the apply action fires', async () => {
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ToggleEtf' }))
    expect(view.getByTestId('isEtf')).toHaveTextContent('true')
    expect(view.getByTestId('state')).toHaveTextContent('idle')
  })

  it('applies filters at page 0 on the apply action, showing loading until data arrives', async () => {
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'ToggleEtf' }))
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByTestId('state')).toHaveTextContent('loading')
    expect(capturedFilters).toEqual({ isEtf: true, isActivelyTrading: true, priceMoreThan: undefined, priceLowerThan: undefined, marketCapMoreThan: undefined, marketCapLowerThan: undefined, sector: undefined, industry: undefined, country: undefined, exchange: undefined, page: 0, limit: expect.any(Number) })
  })

  it('includes a selected canonical filter (sector/industry/country/exchange) once applied', async () => {
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'SetSector' }))
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(capturedFilters).toMatchObject({ sector: 'Technology' })
  })

  it('shows loaded rows once page 0 resolves, and empty when it resolves with zero results', async () => {
    mockScreenerState = { ...mockScreenerState, data: page0 }
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByTestId('state')).toHaveTextContent('loaded')
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL')
    expect(view.getByTestId('has-more')).toHaveTextContent('true')

    mockScreenerState = { ...mockScreenerState, data: emptyPage0 }
    const emptyView = await render(<ScreenerRoute />)
    await fireEvent.press(emptyView.getByRole('button', { name: 'Apply' }))
    expect(emptyView.getByTestId('state')).toHaveTextContent('empty')
  })

  it('surfaces the scoped error and invalid-response states on a first-page failure', async () => {
    mockScreenerState = { ...mockScreenerState, isInitialFailure: true, error: { code: 'invalid-response' } }
    const invalid = await render(<ScreenerRoute />)
    await fireEvent.press(invalid.getByRole('button', { name: 'Apply' }))
    expect(invalid.getByTestId('state')).toHaveTextContent('invalid-response')

    mockScreenerState = { ...mockScreenerState, isInitialFailure: true, error: { code: 'network' } }
    const failed = await render(<ScreenerRoute />)
    await fireEvent.press(failed.getByRole('button', { name: 'Apply' }))
    expect(failed.getByTestId('state')).toHaveTextContent('error')
  })

  it('surfaces access transitions', async () => {
    mockScreenerState = { ...mockScreenerState, isAccessTransition: true }
    const view = await render(<ScreenerRoute />)
    expect(view.getByTestId('state')).toHaveTextContent('access-transition')
  })

  it('appends the next page to the existing rows on load-more, without replacing them', async () => {
    mockScreenerState = { ...mockScreenerState, data: page0 }
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL')

    mockScreenerState = { ...mockScreenerState, data: page1 }
    await fireEvent.press(view.getByRole('button', { name: 'LoadMore' }))
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL,MSFT')
    expect(view.getByTestId('has-more')).toHaveTextContent('false')
  })

  it('resets accumulated results and page back to 0 when filters change and are reapplied', async () => {
    mockScreenerState = { ...mockScreenerState, data: page0 }
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL')

    mockScreenerState = { ...mockScreenerState, data: page1 }
    await fireEvent.press(view.getByRole('button', { name: 'LoadMore' }))
    expect(view.getByTestId('rows')).toHaveTextContent('AAPL,MSFT')

    mockScreenerState = { ...mockScreenerState, data: { ...page0, results: [{ marketCap: 3, name: 'Nvidia', price: 900, sector: 'Technology', symbol: 'NVDA' }] } }
    await fireEvent.press(view.getByRole('button', { name: 'ToggleEtf' }))
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    expect(view.getByTestId('rows')).toHaveTextContent('NVDA')
    expect(view.getByTestId('rows')).not.toHaveTextContent('MSFT')
    expect(capturedFilters).toMatchObject({ page: 0 })
  })

  it('navigates to asset detail on row select', async () => {
    mockScreenerState = { ...mockScreenerState, data: page0 }
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Apply' }))
    await fireEvent.press(view.getByRole('button', { name: 'Select' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/markets/[symbol]', params: { symbol: 'AAPL' } })
  })

  it('goes back when possible, otherwise replaces with the markets search screen', async () => {
    const view = await render(<ScreenerRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)

    mockCanGoBack.mockReturnValue(false)
    const other = await render(<ScreenerRoute />)
    await fireEvent.press(other.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/markets')
  })
})
