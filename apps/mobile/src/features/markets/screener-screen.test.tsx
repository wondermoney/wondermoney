import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ScreenerScreen, type ScreenerFilterFormValues, type ScreenerScreenProps } from './screener-screen'

const emptyForm: ScreenerFilterFormValues = {
  isEtf: false,
  isActivelyTrading: true,
  priceMoreThan: '',
  priceLowerThan: '',
  marketCapMoreThan: '',
  marketCapLowerThan: '',
  sector: null,
  industry: null,
  country: null,
  exchange: null,
}

const rows = [
  { marketCap: 3_000_000_000_000, name: 'Apple Inc', price: 232.5, sector: 'Technology', symbol: 'AAPL' },
  { marketCap: null, name: null, price: null, sector: null, symbol: 'XYZ' },
]

async function setup(overrides: Partial<ScreenerScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: ScreenerScreenProps = {
    state: { status: 'idle' },
    form: emptyForm,
    onFormChange: jest.fn(),
    onApplyFilters: jest.fn(),
    onLoadMore: jest.fn(),
    onSelectSymbol: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><ScreenerScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('ScreenerScreen', () => {
  it('renders nothing during an access transition', async () => {
    const { view } = await setup({ state: { status: 'access-transition' } })
    expect(view.toJSON()).toBeNull()
  })

  it('shows an idle prompt before filters are applied', async () => {
    const { view } = await setup()
    expect(view.getByText('Set your filters and tap Apply filters to search')).toBeOnTheScreen()
  })

  it('shows a loading state', async () => {
    const { view } = await setup({ state: { status: 'loading' } })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('shows a scoped error state', async () => {
    const { view } = await setup({ state: { status: 'error' } })
    expect(view.getByRole('header', { name: 'Could not load the screener' })).toBeOnTheScreen()
  })

  it('shows an invalid-response state', async () => {
    const { view } = await setup({ state: { status: 'invalid-response' } })
    expect(view.getByRole('header', { name: 'Could not verify screener data' })).toBeOnTheScreen()
  })

  it('shows a distinct empty state, not the idle prompt', async () => {
    const { view } = await setup({ state: { status: 'empty' } })
    expect(view.getByText('No stocks match your filters')).toBeOnTheScreen()
    expect(view.queryByText('Set your filters and tap Apply filters to search')).not.toBeOnTheScreen()
  })

  it('reports controlled field changes without firing a request itself', async () => {
    const { view, props } = await setup()
    await fireEvent(view.getByLabelText('Include ETFs'), 'valueChange', true)
    expect(props.onFormChange).toHaveBeenCalledWith({ isEtf: true })
    await fireEvent(view.getByLabelText('Only actively trading'), 'valueChange', false)
    expect(props.onFormChange).toHaveBeenCalledWith({ isActivelyTrading: false })
    await fireEvent.changeText(view.getByLabelText('Min price'), '10')
    expect(props.onFormChange).toHaveBeenCalledWith({ priceMoreThan: '10' })
    await fireEvent.changeText(view.getByLabelText('Max price'), '500')
    expect(props.onFormChange).toHaveBeenCalledWith({ priceLowerThan: '500' })
    await fireEvent.changeText(view.getByLabelText('Min market cap'), '1000000')
    expect(props.onFormChange).toHaveBeenCalledWith({ marketCapMoreThan: '1000000' })
    await fireEvent.changeText(view.getByLabelText('Max market cap'), '5000000000')
    expect(props.onFormChange).toHaveBeenCalledWith({ marketCapLowerThan: '5000000000' })
    expect(props.onApplyFilters).not.toHaveBeenCalled()
  })

  it('only fires a search on the explicit apply action, not per keystroke', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Apply filters' }))
    expect(props.onApplyFilters).toHaveBeenCalledTimes(1)
  })

  it('lists every loaded row with price and sector', async () => {
    const { view } = await setup({ state: { status: 'loaded', rows, hasMore: false, loadingMore: false, loadMoreError: false } })
    expect(view.getByRole('button', { name: /Apple Inc.*AAPL.*Technology.*232\.50/ })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'XYZ' })).toBeOnTheScreen()
  })

  it('selects a symbol when its row is pressed', async () => {
    const { view, props } = await setup({ state: { status: 'loaded', rows, hasMore: false, loadingMore: false, loadMoreError: false } })
    await fireEvent.press(view.getByRole('button', { name: /AAPL/ }))
    expect(props.onSelectSymbol).toHaveBeenCalledWith('AAPL')
  })

  it('shows a load-more action only when hasMore is true', async () => {
    const loaded = await setup({ state: { status: 'loaded', rows, hasMore: true, loadingMore: false, loadMoreError: false } })
    expect(loaded.view.getByRole('button', { name: 'Load more' })).toBeOnTheScreen()

    const noMore = await setup({ state: { status: 'loaded', rows, hasMore: false, loadingMore: false, loadMoreError: false } })
    expect(noMore.view.queryByRole('button', { name: 'Load more' })).not.toBeOnTheScreen()
  })

  it('invokes onLoadMore from the load-more action and disables it while loading more', async () => {
    const { view, props } = await setup({ state: { status: 'loaded', rows, hasMore: true, loadingMore: false, loadMoreError: false } })
    await fireEvent.press(view.getByRole('button', { name: 'Load more' }))
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)

    const loadingMore = await setup({ state: { status: 'loaded', rows, hasMore: true, loadingMore: true, loadMoreError: false } })
    expect(loadingMore.view.getByRole('button', { name: 'Loading more…' })).toBeDisabled()
  })

  it('shows a load-more error note distinct from the results', async () => {
    const { view } = await setup({ state: { status: 'loaded', rows, hasMore: true, loadingMore: false, loadMoreError: true } })
    expect(view.getByRole('alert')).toHaveTextContent('Could not load more results. Try again.')
  })

  it('invokes onBack from the back action', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('keeps allowFontScaling on the title and row text', async () => {
    const { view } = await setup({ state: { status: 'loaded', rows, hasMore: false, loadingMore: false, loadMoreError: false } })
    expect(view.getByText('Screener').props.allowFontScaling).not.toBe(false)
    expect(within(view.getByRole('button', { name: 'XYZ' })).getByText('XYZ').props.allowFontScaling).not.toBe(false)
  })
})
