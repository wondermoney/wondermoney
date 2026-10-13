import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { LoanCreateRoute } from './loan-create-route'

const mockReplace = jest.fn()
const mockUseLoanCurrencies = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-loan-currencies', () => ({ useLoanCurrencies: () => mockUseLoanCurrencies() }))
jest.mock('./use-create-loan', () => ({
  useCreateLoan: () => mockMutation,
  classifyLoanCreateFailure: (error: unknown) => (error as { code?: string } | undefined)?.code ?? 'general',
}))
jest.mock('./loan-create-screen', () => ({
  LoanCreateScreen: ({ currencies, loading, metadataError, outcome, onCreate }: { currencies: { code: string }[]; loading: boolean; metadataError: boolean; outcome: string | null; onCreate: (value: unknown) => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{`${loading}:${metadataError}:${currencies.map((c) => c.code).join(',')}:${outcome ?? '-'}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Create route" onPress={() => void onCreate({ name: 'Home loan' })} />
    </>
  },
}))

describe('loan create route', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseLoanCurrencies.mockReset().mockReturnValue({ data: { currencies: [{ currencyKey: 1, code: 'EUR', description: 'Euro' }] }, isLoading: false })
  })

  it('passes the loaded currency list through to the screen', async () => {
    const view = await render(<LoanCreateRoute />)
    expect(view.getByText('false:false:EUR:-')).toBeOnTheScreen()
  })

  it('surfaces the loading state while currencies are still resolving', async () => {
    mockUseLoanCurrencies.mockReturnValue({ data: undefined, isLoading: true })
    const view = await render(<LoanCreateRoute />)
    expect(view.getByText('true:false::-')).toBeOnTheScreen()
  })

  it('surfaces a metadata error once loading finishes with no data', async () => {
    mockUseLoanCurrencies.mockReturnValue({ data: undefined, isLoading: false })
    const view = await render(<LoanCreateRoute />)
    expect(view.getByText('false:true::-')).toBeOnTheScreen()
  })

  it('creates the loan then navigates back to the loans list', async () => {
    const view = await render(<LoanCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Create route' }))
    await waitFor(() => expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ name: 'Home loan' }))
    expect(mockReplace).toHaveBeenCalledWith('/loans')
  })

  it('surfaces a classified failure and does not navigate away on error', async () => {
    mockMutation.mutateAsync.mockRejectedValue(new ApiError('demo-forbidden'))
    const view = await render(<LoanCreateRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Create route' }))
    await waitFor(() => expect(view.getByText('false:false:EUR:demo-forbidden')).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
