import { fireEvent, render } from '@testing-library/react-native'

import { AccountDetailRoute } from './account-detail-route'
import { AccountsRoute } from './accounts-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn()
let mockParams: { accountId?: string | string[] } = {}
const mockUseAccounts = jest.fn()
const mockUseAccount = jest.fn()
const mockUseInsights = jest.fn()
const mockUseAccountMetrics = jest.fn()
const mockUseRecentTransactions = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useLocalSearchParams: () => mockParams,
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: jest.fn() }),
}))
jest.mock('./use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-reorder-accounts', () => ({ useReorderAccounts: () => ({ mutateAsync: jest.fn() }) }))
jest.mock('./use-account', () => ({ useAccount: (id: number | null) => mockUseAccount(id) }))
jest.mock('./use-account-recalculation', () => ({ useAccountRecalculation: () => ({ state: { phase: 'idle' }, start: jest.fn(), reset: jest.fn() }) }))
jest.mock('./use-account-forecast', () => ({ useAccountForecast: () => ({ data: undefined, isAccessTransition: false, isLoading: false, refetch: jest.fn() }) }))
jest.mock('./use-credit-card-statements', () => ({ useCreditCardStatements: () => ({ data: undefined, error: null, isAccessTransition: false, isLoading: false, refetch: jest.fn() }) }))
jest.mock('@/features/account-insights/use-account-insights', () => ({ useAccountInsights: () => mockUseInsights() }))
jest.mock('@/features/account-insights/use-account-metrics', () => ({ useAccountMetrics: (...args: unknown[]) => mockUseAccountMetrics(...args) }))
jest.mock('@/features/transactions/use-recent-transactions', () => ({ useRecentTransactions: (...args: unknown[]) => mockUseRecentTransactions(...args) }))
jest.mock('@/features/transactions/use-transactions', () => ({ useTransactions: () => ({ data: { transactions: [] }, isAccessTransition: false, isLoading: false, isRefreshing: false, isRefreshFailure: false, error: null, refetch: jest.fn() }) }))
jest.mock('./accounts-screen', () => ({
  AccountsScreen: ({ onSelectAccount, onCreateAccount, onViewTransactions, onConnectBank, onCreateTransaction, onEditAccount }: { onSelectAccount: (id: number) => void; onCreateAccount: () => void; onViewTransactions: () => void; onConnectBank: () => void; onCreateTransaction: () => void; onEditAccount: (id: number) => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    const item = (label: string, onPress: () => void) => <Native.Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Native.Text>{label}</Native.Text></Native.Pressable>
    return <>{[item('Account row', () => onSelectAccount(42)), item('Create', onCreateAccount), item('Transactions', onViewTransactions), item('Connect', onConnectBank), item('Add transaction', onCreateTransaction), item('Edit', () => onEditAccount(42))]}</>
  },
}))
jest.mock('./account-detail-screen', () => ({
  AccountDetailScreen: ({ state, onBack, onViewTransactions }: { state: { status: string }; onBack: () => void; onViewTransactions: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{state.status}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack}><Native.Text>Back</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Account transactions" onPress={onViewTransactions}><Native.Text>Account transactions</Native.Text></Native.Pressable></>
  },
}))

describe('accounts route adapters', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockReplace.mockReset()
    mockBack.mockReset()
    mockCanGoBack.mockReset()
    mockCanGoBack.mockReturnValue(false)
    mockUseAccounts.mockReset()
    mockUseAccount.mockReset()
    const resource = (data: unknown) => ({ data, isAccessTransition: false, isLoading: false, isRefreshFailure: false, isRefreshing: false, error: null, refetch: jest.fn() })
    mockUseInsights.mockReturnValue({ metrics: resource({ metrics: [] }), cashflow: resource({ cashflow: [] }), categories: resource({ categorySpending: [] }) })
    mockUseAccountMetrics.mockReturnValue({ ...resource({ metrics: [] }), isInvalidId: false })
    mockUseRecentTransactions.mockReturnValue({ ...resource({ transactions: [] }), isInvalidId: false })
    mockParams = {}
  })

  it('pushes numeric account 42 from the list presentation', async () => {
    mockUseAccounts.mockReturnValue({
      isAccessTransition: false,
      isLoading: false,
      data: { accounts: [] },
      isRefreshFailure: false,
      isRefreshing: false,
      refetch: jest.fn(),
      error: null,
    })
    const view = await render(<AccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Account row' }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/accounts/[accountId]',
      params: { accountId: '42' },
    })
  })

  it('passes an invalid parameter as null for a local error with no valid request id', async () => {
    mockParams = { accountId: 'invalid' }
    mockUseAccount.mockReturnValue({ isInvalidId: true, refetch: jest.fn() })
    const view = await render(<AccountDetailRoute />)
    expect(mockUseAccount).toHaveBeenCalledWith(null)
    expect(view.getByText('invalid-id')).toBeOnTheScreen()
  })

  it('opens aggregate transactions from Accounts without a tab', async () => {
    mockUseAccounts.mockReturnValue({ isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Transactions' }))
    expect(mockPush).toHaveBeenCalledWith('/accounts/transactions')
  })

  it('opens guarded manual account creation from Accounts', async () => {
    mockUseAccounts.mockReturnValue({ isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Create' }))
    expect(mockPush).toHaveBeenCalledWith('/accounts/create')
  })

  it('opens nested transactions from account detail', async () => {
    mockParams = { accountId: '42' }
    mockUseAccount.mockReturnValue({ isInvalidId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Account transactions' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/[accountId]/transactions', params: { accountId: '42' } })
  })

  it('opens bank connection, transaction creation and account editing from Accounts', async () => {
    mockUseAccounts.mockReturnValue({ isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Connect' }))
    expect(mockPush).toHaveBeenCalledWith('/more/banking/connect')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(mockPush).toHaveBeenCalledWith('/accounts/transactions/create')
    await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/[accountId]/edit', params: { accountId: '42' } })
  })

  it('maps Back to Accounts rather than exposing a third tab', async () => {
    mockParams = { accountId: '42' }
    mockUseAccount.mockReturnValue({ isInvalidId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('uses router history when Back has a previous route', async () => {
    mockCanGoBack.mockReturnValue(true)
    mockParams = { accountId: '42' }
    mockUseAccount.mockReturnValue({ isInvalidId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
