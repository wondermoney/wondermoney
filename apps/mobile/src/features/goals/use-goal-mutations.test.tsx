import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyGoalWriteFailure, useGoalMutations } from './use-goal-mutations'

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

const concurrentMutations = [
  { label: 'metadata', value: { kind: 'metadata', goalId: 3, value: { name: 'Reserve' } } as const },
  { label: 'link', value: { kind: 'link', goalId: 3, accountId: 42 } as const },
  { label: 'unlink', value: { kind: 'unlink', goalId: 3, accountId: 42 } as const },
  { label: 'assign', value: { kind: 'assign', goalId: 3, amount: 10.25 } as const },
  { label: 'move-out', value: { kind: 'move-out', goalId: 3, amount: 10.25 } as const },
  { label: 'archive', value: { kind: 'archive', goalId: 3 } as const },
  { label: 'restore', value: { kind: 'restore', goalId: 3 } as const },
]
const concurrencyCases = concurrentMutations.flatMap((first) => concurrentMutations.map((second) => [first.label, second.label, first.value, second.value] as const))

describe('goal guarded writes', () => {
  beforeEach(() => { mockEpochId = 8; mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it.each([
    [{ kind: 'metadata', goalId: 3, value: { name: 'Reserve' } }, 'PATCH', '/v1/goals/3', { name: 'Reserve' }],
    [{ kind: 'link', goalId: 3, accountId: 42 }, 'POST', '/v1/goals/3/accounts', { accountKey: 42 }],
    [{ kind: 'unlink', goalId: 3, accountId: 42 }, 'DELETE', '/v1/goals/3/accounts/42', undefined],
    [{ kind: 'assign', goalId: 3, amount: 10.25 }, 'POST', '/v1/goals/3/assign', { amount: 10.25 }],
    [{ kind: 'move-out', goalId: 3, amount: 10.25 }, 'POST', '/v1/goals/3/move-out', { amount: 10.25 }],
    [{ kind: 'archive', goalId: 3 }, 'DELETE', '/v1/goals/3', undefined],
    [{ kind: 'restore', goalId: 3 }, 'POST', '/v1/goals/3/restore', undefined],
  ] as const)('uses the exact one-shot contract and only invalidates current goal reads after commit', async (mutation, method, path, body) => {
    const { client, wrapper } = setup()
    client.setQueryData(['goals', 8], { canonical: 'list' })
    client.setQueryData(['goals', 'archived', 8], { canonical: 'archived-list' })
    client.setQueryData(['goal', 8, 3], { canonical: 'detail' })
    client.setQueryData(['goal-activity', 8, 3], { canonical: 'activity' })
    client.setQueryData(['accounts', 8], { canonical: 'accounts' })
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const raw = method === 'DELETE' ? undefined : { raw: 'entity' }
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(raw); return raw })
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync(mutation) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method, path })
    expect(mockWrite.mock.calls[0][1].body).toEqual(body)
    expect(invalidate).toHaveBeenCalledTimes(4)
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ['goals', 8], exact: true },
      { queryKey: ['goals', 'archived', 8], exact: true },
      { queryKey: ['goal', 8, 3], exact: true },
      { queryKey: ['goal-activity', 8, 3], exact: true },
    ])
    expect(client.getQueryData(['accounts', 8])).toEqual({ canonical: 'accounts' })
    expect(client.getQueryData(['goal', 8, 3])).not.toEqual(raw)
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    await hook.unmount(); client.clear()
  })

  it.each(['network', 'invalid-response'] as const)('marks an ambiguous %s reserve outcome unknown and blocks every write kind until explicit recovery', async (code) => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockRejectedValue(new ApiError(code))
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ kind: 'assign', goalId: 3, amount: 10 })).rejects.toMatchObject({ code }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
    expect(hook.result.current.isGoalUnknown(3)).toBe(true)
    expect(hook.result.current.isGoalWriteBlocked(3)).toBe(true)
    for (const { value } of concurrentMutations) {
      await act(async () => { await expect(hook.result.current.mutateAsync(value)).rejects.toThrow('blocked') })
    }
    expect(mockWrite).toHaveBeenCalledTimes(1)
    await act(() => hook.result.current.clearGoalUnknown(3))
    expect(hook.result.current.isGoalWriteBlocked(3)).toBe(false)
    mockWrite.mockResolvedValue(undefined)
    await act(async () => { await hook.result.current.mutateAsync({ kind: 'move-out', goalId: 3, amount: 5 }) })
    expect(mockWrite).toHaveBeenCalledTimes(2)
    await hook.unmount(); client.clear()
  })

  it('rejects an empty metadata write before transport or invalidation and releases the goal lock', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    await act(async () => {
      await expect(hook.result.current.mutateAsync({ kind: 'metadata', goalId: 3, value: {} as never })).rejects.toMatchObject({ name: 'ZodError' })
    })
    expect(mockWrite).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(hook.result.current.isGoalPending(3)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it.each(concurrencyCases)('keeps one authoritative per-goal lock for %s then %s', async (_firstLabel, _secondLabel, firstMutation, secondMutation) => {
    const { client, wrapper } = setup()
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    let first!: Promise<unknown>
    await act(() => { first = hook.result.current.mutateAsync(firstMutation) })
    expect(hook.result.current.isGoalPending(3)).toBe(true)
    await act(async () => {
      await expect(hook.result.current.mutateAsync(secondMutation)).rejects.toThrow('blocked')
    })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(hook.result.current.isGoalPending(3)).toBe(true)
    await act(async () => { resolve(); await first })
    await waitFor(() => expect(hook.result.current.isGoalPending(3)).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('keeps failure categories distinct and transitions access boundaries', async () => {
    expect(classifyGoalWriteFailure(new ApiError('demo-forbidden', 403))).toBe('demo')
    expect(classifyGoalWriteFailure(new ApiError('mfa-required', 401))).toBe('mfa')
    expect(classifyGoalWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyGoalWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyGoalWriteFailure(new ApiError('network'))).toBe('network-ambiguous')
    expect(classifyGoalWriteFailure(new ApiError('invalid-response'))).toBe('invalid-response')
    expect(classifyGoalWriteFailure(new Error('unknown'))).toBe('general')
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('mfa-required'))
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ kind: 'unlink', goalId: 3, accountId: 42 })).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })

  it('does not replay a reserve write after trusted 401 recovery fails', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValue(new ApiError('auth-session', 401))
    const hook = await renderHook(() => useGoalMutations(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ kind: 'assign', goalId: 3, amount: 10 })).rejects.toMatchObject({ code: 'auth-session' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(hook.result.current.isGoalUnknown(3)).toBe(false)
    await hook.unmount(); client.clear()
  })
})
