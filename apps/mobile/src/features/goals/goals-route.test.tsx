import { act, render, waitFor } from '@testing-library/react-native'

import { GoalsRoute } from './goals-route'
import { goalFixture } from './test-fixtures'

const mockUseGoals = jest.fn()
const mockPush = jest.fn()
const mockMutation = { mutateAsync: jest.fn(), isGoalPending: jest.fn(() => false) }
let mockUnknownGate: null | { payload: { name: string; targetAmount: number } } = null
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
let capturedState: { status: string; data?: { goals: { goalId: number }[] } } | null = null
let capturedView: string | null = null
let capturedSelectView: ((view: 'active' | 'archived') => void) | null = null
let capturedViewGoal: ((goalId: number) => void) | null = null
let capturedCreateGoal: (() => void) | null = null
let capturedRestoreGoal: ((goalId: number) => void) | null = null
let capturedViewDebtStrategy: (() => void) | null = null
jest.mock('./use-goals', () => ({ useGoals: (...args: unknown[]) => mockUseGoals(...args) }))
jest.mock('./use-goal-mutations', () => ({ useGoalMutations: () => mockMutation }))
jest.mock('./use-create-goal', () => ({ useGoalCreateUnknownGate: () => mockUnknownGate }))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signOut: jest.fn() }),
}))
jest.mock('./goals-screen', () => ({
  GoalsScreen: ({ state, view, onSelectView, onViewGoal, onCreateGoal, onRestoreGoal, onViewDebtStrategy }: { state: { status: string }; view: string; onSelectView: (view: 'active' | 'archived') => void; onViewGoal: (goalId: number) => void; onCreateGoal: () => void; onRestoreGoal: (goalId: number) => void; onViewDebtStrategy: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    capturedState = state
    capturedView = view
    capturedSelectView = onSelectView
    capturedViewGoal = onViewGoal
    capturedCreateGoal = onCreateGoal
    capturedRestoreGoal = onRestoreGoal
    capturedViewDebtStrategy = onViewDebtStrategy
    return <Native.Text>{state.status}</Native.Text>
  },
}))

describe('GoalsRoute', () => {
  beforeEach(() => { mockUnknownGate = null; mockPush.mockClear(); mockUseGoals.mockReset(); mockMutation.mutateAsync.mockReset() })
  it.each([
    [{ isAccessTransition: true }, 'access-transition'],
    [{ isAccessTransition: false, isLoading: true }, 'loading'],
    [{ isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false }, 'loaded'],
  ])('maps query presentation state', async (query, status) => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, ...query })
    const view = await render(<GoalsRoute />)
    expect(view.getByText(status)).toBeOnTheScreen()
    expect(capturedState?.status).toBe(status)
  })

  it('navigates the dedicated row action to the authenticated dynamic route', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    capturedViewGoal?.(3)
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/goals/[goalId]', params: { goalId: '3' } })
  })

  it('starts creation from the Goals list action', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    capturedCreateGoal?.()
    expect(mockPush).toHaveBeenCalledWith('/goals/create')
  })

  it('rejects the create entry action while the active epoch has an unknown outcome', async () => {
    mockUnknownGate = { payload: { name: 'Reserve', targetAmount: 100 } }
    const refetch = jest.fn()
    mockUseGoals.mockReturnValue({ refetch, error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    capturedCreateGoal?.()
    expect(mockPush).not.toHaveBeenCalledWith('/goals/create')
  })

  it('starts on the active tab, fetching without includeArchived', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    expect(mockUseGoals).toHaveBeenCalledWith(false)
    expect(capturedView).toBe('active')
  })

  it('refetches with includeArchived and filters to archived-status goals once the Archived tab is selected', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [goalFixture, { ...goalFixture, goalKey: 9, status: 'archived' }] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    await act(async () => { capturedSelectView?.('archived') })
    expect(mockUseGoals).toHaveBeenLastCalledWith(true)
    expect(capturedState?.data?.goals.map((goal) => goal.goalId)).toEqual([9])
  })

  it('navigates to the debt payoff strategy screen from the Goals list action', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    capturedViewDebtStrategy?.()
    expect(mockPush).toHaveBeenCalledWith('/goals/debt-strategy')
  })

  it('restores a goal through the mutation and does not navigate away', async () => {
    mockUseGoals.mockReturnValue({ refetch: jest.fn(), error: null, isAccessTransition: false, isLoading: false, data: { goals: [] }, isRefreshFailure: false, isRefreshing: false })
    await render(<GoalsRoute />)
    capturedRestoreGoal?.(9)
    await waitFor(() => expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ kind: 'restore', goalId: 9 }))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
