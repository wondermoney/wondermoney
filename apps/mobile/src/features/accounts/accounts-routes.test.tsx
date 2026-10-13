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
jest.mock('./use-account', () => ({ useAccount: (id: number | null) => mockUseAccount(id) }))
jest.mock('@/features/account-insights/use-account-insights', () => ({ useAccountInsights: () => mockUseInsights() }))
jest.mock('@/features/account-insights/use-account-metrics', () => ({ useAccountMetrics: (...args: unknown[]) => mockUseAccountMetrics(...args) }))
jest.mock('@/features/transactions/use-recent-transactions', () => ({ useRecentTransactions: (...args: unknown[]) => mockUseRecentTransactions(...args) }))
jest.mock('./accounts-screen', () => ({
  AccountsScreen: ({ onSelectAccount, onCreateAccount, onViewTransactions, onViewRecurring }: { onSelectAccount: (id: number) => void; onCreateAccount: () => void; onViewTransactions: () => void; onViewRecurring: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Pressable accessibilityRole="button" accessibilityLabel="Account row" onPress={() => onSelectAccount(42)}><Native.Text>Account row</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Create" onPress={onCreateAccount}><Native.Text>Create</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Transactions" onPress={onViewTransactions}><Native.Text>Transactions</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Recurring" onPress={onViewRecurring}><Native.Text>Recurring</Native.Text></Native.Pressable></>
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

  it('opens recurring immediately after Transactions without adding a tab', async () => {
    mockUseAccounts.mockReturnValue({ isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<AccountsRoute />)
    const buttons = view.getAllByRole('button')
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['Account row', 'Create', 'Transactions', 'Recurring'])
    await fireEvent.press(view.getByRole('button', { name: 'Recurring' }))
    expect(mockPush).toHaveBeenCalledWith('/accounts/recurring')
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
