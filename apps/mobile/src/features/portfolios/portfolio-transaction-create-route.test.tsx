import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { ApiError } from '@/lib/api/errors'

import { PortfolioTransactionCreateRoute } from './portfolio-transaction-create-route'

const mockReplace = jest.fn()
const mockUseLocalSearchParams = jest.fn()
const mockUsePortfolioMetadata = jest.fn()
const mockUsePortfolioCurrencies = jest.fn()
const mockUsePortfolioTransactionTypes = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('./use-portfolio-metadata', () => ({ usePortfolioMetadata: () => mockUsePortfolioMetadata() }))
jest.mock('./use-portfolio-currencies', () => ({ usePortfolioCurrencies: () => mockUsePortfolioCurrencies() }))
jest.mock('./use-portfolio-transaction-types', () => ({ usePortfolioTransactionTypes: () => mockUsePortfolioTransactionTypes() }))
jest.mock('./use-create-portfolio-transaction', () => ({
  useCreatePortfolioTransaction: () => mockMutation,
  classifyCreatePortfolioTransactionFailure: (error: unknown) => (error as { code?: string } | undefined)?.code ?? 'general',
}))
jest.mock('./portfolio-transaction-create-screen', () => ({
  PortfolioTransactionCreateScreen: ({ transactionTypes, currencies, defaultCurrencyId, loading, metadataError, outcome, onCreate }: {
    transactionTypes: { name: string }[]; currencies: { code: string }[]; defaultCurrencyId: number | null; loading: boolean; metadataError: boolean; outcome: string | null; onCreate: (value: unknown) => Promise<void>
  }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{`${loading}:${metadataError}:${transactionTypes.map((t) => t.name).join(',')}:${currencies.map((c) => c.code).join(',')}:${defaultCurrencyId ?? '-'}:${outcome ?? '-'}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Create route" onPress={() => void onCreate({ assetSymbol: 'AAPL' })} />
    </>
  },
}))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><PortfolioTransactionCreateRoute /></I18nextProvider>)
}

describe('portfolio transaction create route', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseLocalSearchParams.mockReset().mockReturnValue({ portfolioId: '7' })
    mockUsePortfolioMetadata.mockReset().mockReturnValue({ data: { portfolio: { currencyKey: { code: 'EUR' }, name: 'Broker', portfolioKey: 7 } }, isPending: false })
    mockUsePortfolioCurrencies.mockReset().mockReturnValue({ data: { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }] }, isPending: false })
    mockUsePortfolioTransactionTypes.mockReset().mockReturnValue({ data: { transactionTypes: [{ financialTransactionTypeKey: 1, name: 'BUY' }, { financialTransactionTypeKey: 2, name: 'SELL' }, { financialTransactionTypeKey: 3, name: 'DIVIDEND' }] }, isPending: false })
  })

  it('filters DIVIDEND out before it ever reaches the screen and preselects the portfolio-native currency', async () => {
    const view = await renderRoute()
    expect(view.getByText('false:false:BUY,SELL:EUR,USD:1:-')).toBeOnTheScreen()
  })

  it('surfaces the loading state while metadata is still resolving', async () => {
    mockUsePortfolioCurrencies.mockReturnValue({ data: undefined, isPending: true })
    const view = await renderRoute()
    expect(view.getByText(/^true:false:/)).toBeOnTheScreen()
  })

  it('surfaces a metadata error once loading finishes with no transaction types', async () => {
    mockUsePortfolioTransactionTypes.mockReturnValue({ data: undefined, isPending: false })
    const view = await renderRoute()
    expect(view.getByText(/^false:true:/)).toBeOnTheScreen()
  })

  it('creates the transaction then navigates back to the portfolio activity list', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Create route' }))
    await waitFor(() => expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ assetSymbol: 'AAPL' }))
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/portfolio/[portfolioId]/activity', params: { portfolioId: '7' } })
  })

  it('surfaces a classified failure and does not navigate away on error', async () => {
    mockMutation.mutateAsync.mockRejectedValue(new ApiError('demo-forbidden'))
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Create route' }))
    await waitFor(() => expect(view.getByText(/demo-forbidden$/)).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows an invalid-id failure instead of the form for a malformed portfolioId param', async () => {
    mockUseLocalSearchParams.mockReturnValue({ portfolioId: 'not-a-number' })
    const view = await renderRoute()
    expect(view.getByText('Portfolio not available')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/portfolio')
  })
})
