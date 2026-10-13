import { render } from '@testing-library/react-native'

import { GoalDetailRoute } from './goal-detail-route'
import { goalFixture } from './test-fixtures'

const mockUseGoalDetail = jest.fn()
const mockMutate = jest.fn()
const mockClearUnknown = jest.fn()
const mockReplace = jest.fn()
let mockParams: { goalId?: string | string[] } = { goalId: '3' }
let mockGoalPending = false
let mockGoalUnknown = false
let captured: { state: { status: string }; onBack: () => void; onRefresh: () => Promise<void>; mutationPending: boolean; goalWriteUnknown: boolean; isGoalWriteBlocked: () => boolean; onAssign: (amount: number) => Promise<void>; onMoveOut: (amount: number) => Promise<void>; onArchive: () => Promise<void> } | null = null

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('./use-goal-detail', () => ({ useGoalDetail: (goalId: number | null) => mockUseGoalDetail(goalId) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => ({ data: { accounts: [] }, isLoading: false, isAccessTransition: false, error: null }) }))
jest.mock('./use-goal-mutations', () => ({ useGoalMutations: () => ({ clearGoalUnknown: mockClearUnknown, isGoalPending: () => mockGoalPending, isGoalUnknown: () => mockGoalUnknown, isGoalWriteBlocked: () => mockGoalPending || mockGoalUnknown, mutateAsync: mockMutate }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))
jest.mock('./goal-detail-screen', () => ({
  GoalDetailScreen: (props: { state: { status: string }; onBack: () => void; onRefresh: () => Promise<void>; mutationPending: boolean; goalWriteUnknown: boolean; isGoalWriteBlocked: () => boolean; onAssign: (amount: number) => Promise<void>; onMoveOut: (amount: number) => Promise<void>; onArchive: () => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    captured = props
    return <Native.Text>{props.state.status}</Native.Text>
  },
}))

const { summary, ...goal } = goalFixture
const baseQuery = {
  isInvalidId: false,
  isAccessTransition: false,
  isLoading: false,
  isInvalidResponse: false,
  isNotFound: false,
  isRefreshFailure: false,
  isActivityLoading: false,
  isActivityError: false,
  isLoadingMore: false,
  isLoadMoreError: false,
  isRefreshing: false,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
}

describe('GoalDetailRoute', () => {
  beforeEach(() => {
    mockParams = { goalId: '3' }
    mockUseGoalDetail.mockReset()
    mockReplace.mockReset()
    mockGoalPending = false
    mockGoalUnknown = false
    mockClearUnknown.mockReset()
    baseQuery.refresh.mockReset()
    mockMutate.mockReset()
    captured = null
  })

  it('strictly parses the route id and maps loaded detail/activity state', async () => {
    mockUseGoalDetail.mockReturnValue({
      ...baseQuery,
      data: {
        detail: { goal, summary },
        activities: [{ goalActivityKey: 1, type: 'assigned', amount: 5, occurredAt: '2026-07-19T10:00:00.000Z', currencyCode: undefined }],
        totalActivities: 1,
      },
    })
    const view = await render(<GoalDetailRoute />)
    expect(mockUseGoalDetail).toHaveBeenCalledWith(3)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(captured?.state.status).toBe('loaded')
    expect(captured?.mutationPending).toBe(false)
    captured?.onBack()
    expect(mockReplace).toHaveBeenCalledWith('/goals')
  })

  it('derives control pending state and confirmation checks from the authoritative goal lock', async () => {
    mockGoalPending = true
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, data: { detail: { goal, summary }, activities: [], totalActivities: 0 } })
    await render(<GoalDetailRoute />)
    expect(captured?.mutationPending).toBe(true)
    expect(captured?.isGoalWriteBlocked()).toBe(true)
    mockGoalPending = false
    expect(captured?.isGoalWriteBlocked()).toBe(false)
  })

  it('clears an unknown write gate only after a successful detail and activity refresh', async () => {
    mockGoalUnknown = true
    baseQuery.refresh.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, data: { detail: { goal, summary }, activities: [], totalActivities: 0 } })
    await render(<GoalDetailRoute />)
    expect(captured?.goalWriteUnknown).toBe(true)
    await captured?.onRefresh()
    expect(mockClearUnknown).not.toHaveBeenCalled()
    await captured?.onRefresh()
    expect(mockClearUnknown).toHaveBeenCalledWith(3)
  })

  it('wires assign and move-out through the shared goal mutation context', async () => {
    mockMutate.mockResolvedValue(undefined)
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, data: { detail: { goal, summary }, activities: [], totalActivities: 0 } })
    await render(<GoalDetailRoute />)
    await captured?.onAssign(12.5)
    await captured?.onMoveOut(4)
    expect(mockMutate).toHaveBeenNthCalledWith(1, { kind: 'assign', goalId: 3, amount: 12.5 })
    expect(mockMutate).toHaveBeenNthCalledWith(2, { kind: 'move-out', goalId: 3, amount: 4 })
  })

  it('archives through the shared goal mutation context then returns to the goals list', async () => {
    mockMutate.mockResolvedValue(undefined)
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, data: { detail: { goal, summary }, activities: [], totalActivities: 0 } })
    await render(<GoalDetailRoute />)
    await captured?.onArchive()
    expect(mockMutate).toHaveBeenCalledWith({ kind: 'archive', goalId: 3 })
    expect(mockReplace).toHaveBeenCalledWith('/goals')
  })

  it('does not navigate away when archiving fails', async () => {
    mockMutate.mockRejectedValue(new Error('archive failed'))
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, data: { detail: { goal, summary }, activities: [], totalActivities: 0 } })
    await render(<GoalDetailRoute />)
    await expect(captured?.onArchive()).rejects.toThrow('archive failed')
    expect(mockReplace).not.toHaveBeenCalledWith('/goals')
  })

  it('fails closed for a malformed route id without coercion', async () => {
    mockParams = { goalId: '03' }
    mockUseGoalDetail.mockReturnValue({ ...baseQuery, isInvalidId: true, data: undefined })
    const view = await render(<GoalDetailRoute />)
    expect(mockUseGoalDetail).toHaveBeenCalledWith(null)
    expect(view.getByText('invalid-id')).toBeOnTheScreen()
  })

  it.each([
    [{ ...baseQuery, isAccessTransition: true }, 'access-transition'],
    [{ ...baseQuery, isLoading: true }, 'loading'],
    [{ ...baseQuery, isNotFound: true }, 'not-found'],
    [{ ...baseQuery, isInvalidResponse: true }, 'invalid-response'],
  ])('maps explicit query states', async (query, status) => {
    mockUseGoalDetail.mockReturnValue({ ...query, data: undefined })
    const view = await render(<GoalDetailRoute />)
    expect(view.getByText(status)).toBeOnTheScreen()
  })
})
