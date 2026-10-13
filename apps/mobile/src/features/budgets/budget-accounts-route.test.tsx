import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { BudgetAccountsRoute } from './budget-accounts-route'

let mockParams: { budgetId?: string | string[] } = { budgetId: '7' }
const mockReplace = jest.fn()
const mockUseBudgetAccounts = jest.fn()
const mockUseAccounts = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }), useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }) }))
jest.mock('./use-budget-accounts', () => ({ useBudgetAccounts: (...args: unknown[]) => mockUseBudgetAccounts(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-budget-accounts-mutation', () => {
  const actual = jest.requireActual('./use-budget-accounts-mutation')
  return { ...actual, useBudgetAccountsMutation: () => mockMutation }
})
jest.mock('./budget-accounts-screen', () => ({
  BudgetAccountsScreen: ({ status, accounts, linkedIds, onSubmit }: { status: string; accounts: readonly { id: number; name: string | null }[]; linkedIds: readonly number[]; onSubmit: (keys: readonly number[]) => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{`${status}:${accounts.length}:${linkedIds.join(',')}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Submit route" onPress={() => void onSubmit([9, 11])} />
    </>
  },
}))

describe('BudgetAccountsRoute', () => {
  beforeEach(() => {
    mockParams = { budgetId: '7' }
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseBudgetAccounts.mockReset().mockReturnValue({ data: { accounts: [{ accountKey: 9, accountName: 'Daily account' }] }, isInvalidRoute: false, isAccessTransition: false, isLoading: false, isError: false, refetch: jest.fn() })
    mockUseAccounts.mockReset().mockReturnValue({ data: { accounts: [{ accountKey: 9, accountName: 'Daily account' }, { accountKey: 11, accountName: 'Savings' }] }, isAccessTransition: false, isLoading: false, isError: false, refetch: jest.fn() })
  })

  it('maps loaded linked and available accounts by validated budget id', async () => {
    const view = await render(<BudgetAccountsRoute />)
    expect(mockUseBudgetAccounts).toHaveBeenCalledWith(7)
    expect(view.getByText('ready:2:9')).toBeOnTheScreen()
  })

  it('submits with the validated budget id and navigates back to the list on success', async () => {
    const view = await render(<BudgetAccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit route' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ budgetId: 7, value: { accountKeys: [9, 11] } })
    expect(mockReplace).toHaveBeenCalledWith('/budgets')
  })

  it('does not navigate away on a rejected submission', async () => {
    mockMutation.mutateAsync.mockRejectedValue(new ApiError('network'))
    const view = await render(<BudgetAccountsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Submit route' }))
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows a loading status while either query is still resolving', async () => {
    mockUseAccounts.mockReturnValue({ data: undefined, isAccessTransition: false, isLoading: true, isError: false, refetch: jest.fn() })
    const view = await render(<BudgetAccountsRoute />)
    expect(view.getByText('loading:0:9')).toBeOnTheScreen()
  })

  it('rejects a malformed budget id without a valid request', async () => {
    mockParams = { budgetId: ['7'] }
    const view = await render(<BudgetAccountsRoute />)
    expect(mockUseBudgetAccounts).toHaveBeenCalledWith(null)
    expect(view.getByText(/^loading:/)).toBeOnTheScreen()
  })
})
