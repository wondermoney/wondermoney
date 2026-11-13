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
jest.mock('@/features/household/use-household-members', () => ({ useHouseholdMembers: () => jest.requireActual('@/features/household/member-attribution').NO_HOUSEHOLD_MEMBERS }))
jest.mock('./use-reorder-accounts', () => ({ useReorderAccounts: () => ({ mutateAsync: jest.fn() }) }))
jest.mock('./use-account', () => ({ useAccount: (id: number | null) => mockUseAccount(id) }))
jest.mock('./use-account-recalculation', () => ({ useAccountRecalculation: () => ({ state: { phase: 'idle' }, start: jest.fn(), reset: jest.fn() }) }))
jest.mock('./use-account-forecast', () => ({ useAccountForecast: () => ({ data: undefined, isAccessTransition: false, isLoading: false, refetch: jest.fn() }) }))
jest.mock('./use-credit-card-statements', () => ({ useCreditCardStatements: () => ({ data: undefined, error: null, isAccessTransition: false, isLoading: false, refetch: jest.fn() }) }))
jest.mock('@/features/account-insights/use-account-insights', () => ({ useAccountInsights: () => mockUseInsights() }))
jest.mock('@/features/account-insights/use-account-metrics', () => ({ useAccountMetrics: (...args: unknown[]) => mockUseAccountMetrics(...args) }))
jest.mock('@/features/transactions/use-recent-transactions', () => ({ useRecentTransactions: (...args: unknown[]) => mockUseRecentTransactions(...args) }))
const installmentQuery = (data: unknown) => () => ({ data, error: null, isAccessTransition: false, isLoading: false, refetch: jest.fn() })
jest.mock('@/features/installments/use-installment-plans', () => ({
  useInstallmentPlans: installmentQuery({ installmentPlans: [] }),
  useInstallmentCommitments: installmentQuery({ commitments: [{ accountKey: 42, accountName: 'Card', currency: 'EUR', remainingAmount: 90, remainingCount: 9, activePlanCount: 1, nextInstallment: null }] }),
  useInstallmentSuggestions: installmentQuery({ suggestions: [] }),
}))
jest.mock('@/features/transactions/use-transactions', () => ({ useTransactions: () => ({ data: { transactions: [] }, isAccessTransition: false, isLoading: false, isRefreshing: false, isRefreshFailure: false, error: null, refetch: jest.fn() }) }))
jest.mock('./accounts-screen', () => ({
  AccountsScreen: ({ onSelectAccount, onCreateAccount, onViewTransactions, onConnectBank, onCreateTransaction, onEditAccount }: { onSelectAccount: (id: number) => void; onCreateAccount: () => void; onViewTransactions: () => void; onConnectBank: () => void; onCreateTransaction: () => void; onEditAccount: (id: number) => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    const item = (label: string, onPress: () => void) => <Native.Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Native.Text>{label}</Native.Text></Native.Pressable>
    return <>{[item('Account row', () => onSelectAccount(42)), item('Create', onCreateAccount), item('Transactions', onViewTransactions), item('Connect', onConnectBank), item('Add transaction', onCreateTransaction), item('Edit', () => onEditAccount(42))]}</>
  },
}))
jest.mock('./account-detail-screen', () => ({
  AccountDetailScreen: ({ state, onBack, onViewTransactions, onOpenInstallmentPlan, onAcceptInstallmentSuggestion }: { state: { status: string; data?: { installmentPlans?: { commitment: { status: string; data?: { remainingAmount: number } | null } } } }; onBack: () => void; onViewTransactions: () => void; onOpenInstallmentPlan?: (planId: number) => void; onAcceptInstallmentSuggestion?: (key: string) => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    const commitment = state.data?.installmentPlans?.commitment
    return <><Native.Text>{state.status}</Native.Text>
      {commitment ? <Native.Text>{`commitment ${commitment.status} ${commitment.data?.remainingAmount ?? 'none'}`}</Native.Text> : null}
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Open plan" onPress={() => onOpenInstallmentPlan?.(5)}><Native.Text>Open plan</Native.Text></Native.Pressable>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Accept suggestion" onPress={() => onAcceptInstallmentSuggestion?.('s-1')}><Native.Text>Accept suggestion</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack}><Native.Text>Back</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Account transactions" onPress={onViewTransactions}><Native.Text>Account transactions</Native.Text></Native.Pressable></>
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

  it('gives a card its installment commitment and opens plans and suggestions under the account', async () => {
    mockParams = { accountId: '42' }
    mockUseAccount.mockReturnValue({
      isInvalidId: false, isAccessTransition: false, isLoading: false, isRefreshFailure: false, refetch: jest.fn(),
      data: { account: { accountFinancialInstitutionKey: null, accountKey: 42, accountName: 'Card', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } }, appuserCurrencyBalance: -100, balance: -100, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false, refreshedAt: null, source: 'manual', creditCard: { statementCloseDay: 5, paymentDueDay: 20, creditLimit: 1000 } } },
    })
    const view = await render(<AccountDetailRoute />)
    expect(view.getByText('commitment loaded 90')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Open plan' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/[accountId]/installments/[planId]', params: { accountId: '42', planId: '5' } })
    await fireEvent.press(view.getByRole('button', { name: 'Accept suggestion' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/[accountId]/installments/create', params: { accountId: '42', suggestion: 's-1' } })
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
