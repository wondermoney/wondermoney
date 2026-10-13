import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { classifyBudgetCategoryWriteFailure, useBudgetCategoryMutation } from './use-budget-category-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('budget child-category write', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes the exact route/body once and invalidates every current-epoch budget root only after guarded commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetCategoryMutation(), { wrapper })
    const value = { amount: 120, recurrency: 'QUARTERLY' as const, applyToFollowingMonths: true }
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, year: 2026, month: 4, categoryId: 11, value }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/budget/7/2026/4/11' })
    expect(mockWrite.mock.calls[0][1].body).toEqual(value)
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'list', 8] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'month', 8, 7, 2026, 4] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'month', 9, 7, 2026, 4] } as never)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('is pessimistic, pending, no-retry/no-replay, and never invalidates without commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useBudgetCategoryMutation(), { wrapper })
    await act(() => { hook.result.current.mutate({ budgetId: 7, year: 2026, month: 4, categoryId: 11, value: { amount: 1, recurrency: 'MONTHLY', applyToFollowingMonths: false } }) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('retains one-shot failure classification for demo/access/MFA/cancel/404/network/invalid/general', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const hook = await renderHook(() => useBudgetCategoryMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, year: 2026, month: 4, categoryId: 11, value: { amount: 1, recurrency: 'MONTHLY', applyToFollowingMonths: false } })).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(classifyBudgetCategoryWriteFailure(new ApiError('demo-forbidden'))).toBe('demo')
    expect(classifyBudgetCategoryWriteFailure(new ApiError('auth-session'))).toBe('access')
    expect(classifyBudgetCategoryWriteFailure(new ApiError('cancelled'))).toBe('cancelled')
    expect(classifyBudgetCategoryWriteFailure(new ApiError('http', 404))).toBe('not-found')
    expect(classifyBudgetCategoryWriteFailure(new ApiError('invalid-response'))).toBe('invalid-response')
    expect(classifyBudgetCategoryWriteFailure(new ApiError('http', 500))).toBe('general')
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, year: 2026, month: 4, categoryId: 11, value: { amount: 1, recurrency: 'MONTHLY', applyToFollowingMonths: false } })).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})
