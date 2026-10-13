import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyGoalCreateFailure, useCreateGoal } from './use-create-goal'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 8
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: mockEpochId, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
const payload = { name: 'Reserve', targetAmount: 12.3456 } as const

describe('guarded goal creation', () => {
  beforeEach(() => { mockEpochId = 8; mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('dispatches the exact frozen body once, disables retries, and invalidates only the current list after commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (endpoint, options) => {
      expect(endpoint).toMatchObject({ method: 'POST', path: '/v1/goals', successStatuses: [201] })
      expect(options.body).toEqual(payload)
      expect(Object.isFrozen(options.body)).toBe(true)
      options.commit({ goalId: 42 })
      return { goalId: 42 }
    })
    const hook = await renderHook(() => useCreateGoal(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).resolves.toEqual({ goalId: 42 }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['goals', 8], exact: true })
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })

  it('blocks a double tap while the first dispatch is pending', async () => {
    const { client, wrapper } = setup()
    let resolve!: (value: { goalId: number }) => void
    mockWrite.mockReturnValue(new Promise((done) => { resolve = done }))
    const hook = await renderHook(() => useCreateGoal(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync(payload) })
    await act(async () => { await expect(hook.result.current.mutateAsync(payload)).rejects.toThrow('already pending') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ goalId: 42 }); await first })
    await hook.unmount(); client.clear()
  })

  it('persists an unknown gate across route-hook remount, rejects repost, and purges it on epoch change', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('network'))
    const first = await renderHook(() => useCreateGoal(), { wrapper })
    await act(async () => { await expect(first.result.current.mutateAsync(payload)).rejects.toMatchObject({ code: 'network' }) })
    await waitFor(() => expect(first.result.current.unknownGate?.payload).toEqual(payload))
    await first.unmount()

    const remounted = await renderHook(() => useCreateGoal(), { wrapper })
    expect(remounted.result.current.unknownGate?.payload).toEqual(payload)
    await act(async () => { await expect(remounted.result.current.mutateAsync(payload)).rejects.toThrow('blocked after an unknown outcome') })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await remounted.unmount()

    mockEpochId = 9
    mockWrite.mockResolvedValue({ goalId: 42 })
    const nextEpoch = await renderHook(() => useCreateGoal(), { wrapper })
    expect(nextEpoch.result.current.unknownGate).toBeNull()
    await waitFor(() => expect(client.getQueryData(['goal-create-unknown', 8])).toBeUndefined())
    await act(async () => { await expect(nextEpoch.result.current.mutateAsync(payload)).resolves.toEqual({ goalId: 42 }) })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await nextEpoch.unmount(); client.clear()
  })

  it('distinguishes pre-dispatch cancellation from post-dispatch and other unknown outcomes', () => {
    expect(classifyGoalCreateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'pre-dispatch' }))).toBe('cancelled')
    expect(classifyGoalCreateFailure(new ApiError('cancelled', undefined, { writeDispatchState: 'post-dispatch' }))).toBe('unknown')
    expect(classifyGoalCreateFailure(new ApiError('network'))).toBe('unknown')
    expect(classifyGoalCreateFailure(new ApiError('invalid-response'))).toBe('unknown')
    expect(classifyGoalCreateFailure(new ApiError('http', 500))).toBe('unknown')
    expect(classifyGoalCreateFailure(new ApiError('http', 422))).toBe('request')
    expect(classifyGoalCreateFailure(new ApiError('http', 404))).toBe('request')
    expect(classifyGoalCreateFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyGoalCreateFailure(new ApiError('mfa-required'))).toBe('mfa')
  })
})
