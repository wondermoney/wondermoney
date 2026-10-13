import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useBudgetMetadataMutation } from './use-budget-metadata-mutation'

const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { write: mockWrite } }, blockAccess: mockBlockAccess }) }))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('budget metadata write', () => {
  beforeEach(() => { mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes only metadata and invalidates all current-epoch budget roots after guarded commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    mockWrite.mockImplementation(async (_endpoint, options) => { options.commit(undefined); return undefined })
    const hook = await renderHook(() => useBudgetMetadataMutation(), { wrapper })
    await act(async () => { await hook.result.current.mutateAsync({ budgetId: 7, value: { name: ' Home ', description: '' } }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ method: 'PATCH', path: '/v1/budget/7' })
    expect(mockWrite.mock.calls[0][1].body).toEqual({ name: ' Home ', description: '' })
    const predicate = invalidate.mock.calls[0][0]?.predicate
    expect(predicate?.({ queryKey: ['budgets', 'list', 8] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 8, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'month', 8, 7, 2026, 7] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['budgets', 'detail', 9, 7] } as never)).toBe(false)
    await hook.unmount(); client.clear()
  })

  it('locks pending, never retries/replays, and does not invalidate without commit', async () => {
    const { client, wrapper } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    let resolve!: () => void
    mockWrite.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const hook = await renderHook(() => useBudgetMetadataMutation(), { wrapper })
    await act(() => { hook.result.current.mutate({ budgetId: 7, value: { name: 'Plan' } }) })
    await waitFor(() => expect(hook.result.current.isPending).toBe(true))
    expect(client.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    await hook.unmount(); client.clear()
  })

  it('does not retry ambiguous failures and transitions classified access', async () => {
    const { client, wrapper } = setup()
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    const hook = await renderHook(() => useBudgetMetadataMutation(), { wrapper })
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, value: { name: 'Plan' } })).rejects.toMatchObject({ code: 'network' }) })
    expect(mockWrite).toHaveBeenCalledTimes(1)
    mockWrite.mockRejectedValueOnce(new ApiError('mfa-required', 403))
    await act(async () => { await expect(hook.result.current.mutateAsync({ budgetId: 7, value: { name: 'Plan' } })).rejects.toBeInstanceOf(ApiError) })
    expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required')
    await hook.unmount(); client.clear()
  })
})
