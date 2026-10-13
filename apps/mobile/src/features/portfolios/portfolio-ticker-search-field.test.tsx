import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { PortfolioTickerSearchField } from './portfolio-ticker-search-field'

// Debounce + request behavior belongs to useTickerSearch's own test (use-ticker-search.test.tsx);
// this field only needs to render whatever that hook reports, matching how markets-search-route
// mocks the same hook for its own tests.
const mockUseTickerSearch = jest.fn()
jest.mock('@/features/markets/use-ticker-search', () => ({
  useTickerSearch: (term: string) => mockUseTickerSearch(term),
}))

const palette = themeTokens.colors.light
const appleResult = { currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc', symbol: 'AAPL', type: 'stock' }

async function renderField(onSelect: jest.Mock) {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <PortfolioTickerSearchField label="Search for a ticker" palette={palette} onSelect={onSelect} />
    </I18nextProvider>,
  )
}

describe('PortfolioTickerSearchField', () => {
  beforeEach(() => mockUseTickerSearch.mockReset())

  it('queries as the user types and reports the picked result, clearing the field', async () => {
    mockUseTickerSearch.mockReturnValue({ data: { results: [appleResult] }, isFetching: false })
    const onSelect = jest.fn()
    const view = await renderField(onSelect)

    await fireEvent.changeText(view.getByLabelText('Search for a ticker'), 'aapl')
    expect(mockUseTickerSearch).toHaveBeenLastCalledWith('aapl')

    await fireEvent.press(view.getByRole('button', { name: 'Apple Inc, AAPL, NASDAQ' }))
    expect(onSelect).toHaveBeenCalledWith(appleResult)
    expect(view.getByLabelText('Search for a ticker')).toHaveProp('value', '')
  })

  it('shows a loading indicator while a search is in flight', async () => {
    mockUseTickerSearch.mockReturnValue({ data: undefined, isFetching: true })
    const view = await renderField(jest.fn())
    await fireEvent.changeText(view.getByLabelText('Search for a ticker'), 'aapl')
    expect(view.getByRole('progressbar')).toHaveTextContent('Searching…')
  })

  it('shows a no-results message once a search comes back empty', async () => {
    mockUseTickerSearch.mockReturnValue({ data: { results: [] }, isFetching: false })
    const view = await renderField(jest.fn())
    await fireEvent.changeText(view.getByLabelText('Search for a ticker'), 'zzz')
    expect(view.getByText('No matching tickers found')).toBeOnTheScreen()
  })

  it('shows neither loading nor empty state before the user has typed anything', async () => {
    mockUseTickerSearch.mockReturnValue({ data: undefined, isFetching: false })
    const view = await renderField(jest.fn())
    expect(view.queryByText('No matching tickers found')).toBeNull()
    expect(view.queryByRole('progressbar')).toBeNull()
  })
})
