import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { GoalCreateRoute } from './goal-create-route'
import type { GoalCreateWrite } from './goals-contract'
import { goalFixture } from './test-fixtures'

const payload: GoalCreateWrite = { name: 'Reserve', targetAmount: 100 }
const mockMutation = { isPending: false, mutateAsync: jest.fn(), unknownGate: null as null | { payload: GoalCreateWrite } }
const mockRead = jest.fn()
const mockReplace = jest.fn()
const mockAddListener = jest.fn(() => jest.fn())

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: mockAddListener }),
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } } }),
}))
jest.mock('./use-create-goal', () => {
  const actual = jest.requireActual<typeof import('./use-create-goal')>('./use-create-goal')
  return { ...actual, useCreateGoal: () => mockMutation }
})
jest.mock('./goal-create-screen', () => ({
  GoalCreateScreen: (props: { failure: string | null; unknownPayload: GoalCreateWrite | null; confirmedGoalId: number | null; detailState: string; onSubmit: (payload: GoalCreateWrite) => Promise<void>; onRefreshGoals: () => Promise<void>; onRetryDetails: () => Promise<void>; onBack: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`${props.failure ?? 'none'}:${props.unknownPayload ? 'blocked' : 'open'}:${props.confirmedGoalId ?? 'none'}:${props.detailState}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Submit goal" onPress={() => void props.onSubmit(payload)} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Refresh Goals test" onPress={() => void props.onRefreshGoals()} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Retry details test" onPress={() => void props.onRetryDetails()} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Return Goals test" onPress={props.onBack} /></>
  },
}))

async function renderRoute(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  client.setQueryData(['goals', 8], { goals: [goalFixture] })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, view: await render(<GoalCreateRoute />, { wrapper }) }
}

describe('GoalCreateRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMutation.isPending = false
    mockMutation.unknownGate = null
    mockRead.mockResolvedValue({ goals: [goalFixture] })
  })

  it('renders a remounted epoch gate, refreshes Goals, and rejects another create', async () => {
    mockMutation.unknownGate = { payload }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const first = await renderRoute(client)
    await waitFor(() => expect(first.view.getByText('none:blocked:none:idle')).toBeOnTheScreen())
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/goals' })))
    await fireEvent.press(first.view.getByRole('button', { name: 'Submit goal' }))
    expect(mockMutation.mutateAsync).not.toHaveBeenCalled()
    await first.view.unmount()
    mockRead.mockClear()
    const second = await renderRoute(client)
    expect(second.view.getByText('none:blocked:none:idle')).toBeOnTheScreen()
    await fireEvent.press(second.view.getByRole('button', { name: 'Submit goal' }))
    expect(mockMutation.mutateAsync).not.toHaveBeenCalled()
    expect(second.view.queryByRole('button', { name: /Create another/i })).not.toBeOnTheScreen()
    client.clear()
  })

  it('keeps post-dispatch unknown blocked and performs no repost or clear action', async () => {
    mockMutation.mutateAsync.mockRejectedValue(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))
    const { client, view } = await renderRoute()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(view.getByText('unknown:open:none:idle')).toBeOnTheScreen())
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/goals' }))
    await fireEvent.press(view.getByRole('button', { name: 'Submit goal' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('treats pre-dispatch cancellation as definitive without reconciliation and releases the gate', async () => {
    mockMutation.mutateAsync.mockRejectedValue(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))
    const { client, view } = await renderRoute()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(view.getByText('cancelled:open:none:idle')).toBeOnTheScreen())
    expect(mockRead).not.toHaveBeenCalled()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(2)
    client.clear()
  })

  it('navigates exactly once only after a valid canonical detail read', async () => {
    mockMutation.mutateAsync.mockResolvedValue({ goalId: 42 })
    mockRead.mockResolvedValue({ goal: { goalKey: 42 }, summary: {} })
    const { client, view } = await renderRoute()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/goals/[goalId]', params: { goalId: '42' } }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Retry details test' }))
    expect(mockReplace).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it.each(['network', 'invalid-response'] as const)('retains confirmed ID after %s detail failure and retries GET only', async (code) => {
    mockMutation.mutateAsync.mockResolvedValue({ goalId: 42 })
    mockRead.mockRejectedValueOnce(new ApiError(code)).mockResolvedValueOnce({ goal: { goalKey: 42 }, summary: {} })
    const { client, view } = await renderRoute()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(view.getByText('none:open:42:unavailable')).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Retry details test' })) })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/goals/[goalId]', params: { goalId: '42' } }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(['/v1/goals/42', '/v1/goals/42'])
    expect(mockReplace).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('rejects a runtime-valid detail envelope for the wrong goal ID, then navigates once after a matching GET-only retry', async () => {
    mockMutation.mutateAsync.mockResolvedValue({ goalId: 42 })
    const { summary, ...goal } = goalFixture
    mockRead
      .mockImplementationOnce(async (endpoint: { schema: { parse: (value: unknown) => unknown } }) => endpoint.schema.parse({ goal: { ...goal, goalKey: 41 }, summary }))
      .mockImplementationOnce(async (endpoint: { schema: { parse: (value: unknown) => unknown } }) => endpoint.schema.parse({ goal: { ...goal, goalKey: 42 }, summary }))
    const { client, view } = await renderRoute()

    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(view.getByText('none:open:42:unavailable')).toBeOnTheScreen())
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(['/v1/goals/42'])

    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Retry details test' })) })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/goals/[goalId]', params: { goalId: '42' } }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(['/v1/goals/42', '/v1/goals/42'])
    expect(mockReplace).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('returns to Goals without retrying either POST or detail GET', async () => {
    mockMutation.mutateAsync.mockResolvedValue({ goalId: 42 })
    mockRead.mockRejectedValue(new ApiError('network'))
    const { client, view } = await renderRoute()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit goal' })) })
    await waitFor(() => expect(view.getByText('none:open:42:unavailable')).toBeOnTheScreen())
    await fireEvent.press(view.getByRole('button', { name: 'Return Goals test' }))
    expect(mockReplace).toHaveBeenCalledWith('/goals')
    expect(mockMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledTimes(1)
    client.clear()
  })
})
