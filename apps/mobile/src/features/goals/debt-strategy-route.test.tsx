import { act, render, waitFor } from '@testing-library/react-native'

import { DebtStrategyRoute } from './debt-strategy-route'
import { debtStrategyFixture } from './test-fixtures'

const mockDebtStrategy = jest.fn()
const mockAccounts = jest.fn()
const mockReplace = jest.fn()
let mockScreenProps: Record<string, unknown>
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-debt-strategy', () => ({ useDebtStrategy: () => mockDebtStrategy() }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockAccounts() }))
jest.mock('./debt-strategy-screen', () => ({
  DebtStrategyScreen: (props: Record<string, unknown>) => {
    mockScreenProps = props
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    const state = props.state as { status: string }
    return <Native.Text>{state.status}</Native.Text>
  },
}))

const accountsBase = { data: { accounts: [{ accountKey: 2, accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } } }] }, refetch: jest.fn() }
describe('DebtStrategyRoute', () => {
  beforeEach(() => { mockDebtStrategy.mockReset(); mockAccounts.mockReset(); mockReplace.mockClear(); mockAccounts.mockReturnValue(accountsBase) })

  it('maps loading, access-transition, and invalid-response states', async () => {
    mockDebtStrategy.mockReturnValue({ isAccessTransition: true, isLoading: false, isInvalidResponse: false, data: undefined, refetch: jest.fn() })
    const loading = await render(<DebtStrategyRoute />)
    expect(loading.getByText('access-transition')).toBeOnTheScreen()
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: true, isInvalidResponse: false, data: undefined, refetch: jest.fn() })
    const view2 = await render(<DebtStrategyRoute />)
    expect(view2.getByText('loading')).toBeOnTheScreen()
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: true, data: undefined, refetch: jest.fn() })
    const view3 = await render(<DebtStrategyRoute />)
    expect(view3.getByText('invalid-response')).toBeOnTheScreen()
  })

  it('maps loaded and stale-refresh states, mapping the DTO into the eligible view model', async () => {
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: false, data: debtStrategyFixture, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    const view = await render(<DebtStrategyRoute />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(mockScreenProps.state).toMatchObject({ status: 'loaded', data: { eligible: true } })
    expect(mockScreenProps.currencyCode).toBe('EUR')
  })

  it('falls back to a null currency code when accounts are unavailable', async () => {
    mockAccounts.mockReturnValue({ data: undefined, refetch: jest.fn() })
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: false, data: debtStrategyFixture, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    await render(<DebtStrategyRoute />)
    expect(mockScreenProps.currencyCode).toBeNull()
  })

  it('reports an ordinary error when there is no data and no recognized transition', async () => {
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: false, data: undefined, refetch: jest.fn() })
    const view = await render(<DebtStrategyRoute />)
    expect(view.getByText('error')).toBeOnTheScreen()
  })

  it('navigates back to the Goals list', async () => {
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: false, data: debtStrategyFixture, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    await render(<DebtStrategyRoute />)
    ;(mockScreenProps.onBack as () => void)()
    expect(mockReplace).toHaveBeenCalledWith('/goals')
  })

  it('refreshes both the strategy and accounts queries', async () => {
    const refetchStrategy = jest.fn()
    const refetchAccounts = jest.fn()
    mockDebtStrategy.mockReturnValue({ isAccessTransition: false, isLoading: false, isInvalidResponse: false, data: debtStrategyFixture, isRefreshFailure: false, isRefreshing: false, refetch: refetchStrategy })
    mockAccounts.mockReturnValue({ ...accountsBase, refetch: refetchAccounts })
    await render(<DebtStrategyRoute />)
    await act(async () => { await (mockScreenProps.onRefresh as () => Promise<void>)() })
    await waitFor(() => expect(refetchStrategy).toHaveBeenCalledTimes(1))
    expect(refetchAccounts).toHaveBeenCalledTimes(1)
  })
})
